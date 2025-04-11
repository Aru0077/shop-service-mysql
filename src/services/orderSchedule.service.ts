// src/services/orderSchedule.service.ts
import cron from 'node-cron';
import { prisma } from '../config';
import { OrderStatus, PaymentStatus } from '../constants/orderStatus.enum';
import { StockChangeType } from '../constants/stock.constants';
import { logger } from '../utils/logger';
import { inventoryService } from './inventory.service';
import { qpayService } from './qpay.service';

class OrderScheduleService {
      private taskRegistry: Record<string, cron.ScheduledTask> = {};
      private retryCount: Record<string, number> = {};
      private maxRetries = 3;

      // 处理超时未支付订单 
      async cancelUnpaidOrders() {
            const taskName = 'cancelUnpaidOrders';
            try {
                  logger.info(`开始执行任务: ${taskName}`);
                  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

                  // 查找超时订单及其订单项（一次性获取所有数据）
                  const unpaidOrders = await prisma.order.findMany({
                        where: {
                              orderStatus: OrderStatus.PENDING_PAYMENT,
                              paymentStatus: PaymentStatus.UNPAID,
                              createdAt: { lt: tenMinutesAgo }
                        },
                        include: {
                              orderItems: {
                                    select: { id: true, skuId: true, quantity: true }
                              }
                        }
                  });

                  if (unpaidOrders.length === 0) return;
                  console.log(`找到 ${unpaidOrders.length} 个超时未支付订单，正在取消...`);

                  // 收集所有需要处理的SKU ID
                  const skuIds = [...new Set(unpaidOrders.flatMap(order =>
                        order.orderItems.map(item => item.skuId)
                  ))];

                  // 一次性获取所有相关SKU信息
                  const skus = await prisma.sku.findMany({
                        where: { id: { in: skuIds } }
                  });
                  const skuMap = new Map(skus.map(sku => [sku.id, sku]));

                  // 为每个订单创建单独的事务，并增加超时时间
                  for (const order of unpaidOrders) {
                        await prisma.$transaction(async (tx) => {
                              // 1. 更新订单状态
                              await tx.order.update({
                                    where: { id: order.id },
                                    data: { orderStatus: OrderStatus.CANCELLED }
                              });

                              // 2. 批量准备库存更新数据
                              const stockUpdates = [];
                              const stockLogs = [];

                              for (const item of order.orderItems) {
                                    const sku = skuMap.get(item.skuId);
                                    if (!sku) continue;

                                    stockUpdates.push({
                                          id: item.skuId,
                                          lockedStock: { decrement: item.quantity }
                                    });

                                    stockLogs.push({
                                          skuId: item.skuId,
                                          changeQuantity: item.quantity,
                                          currentStock: sku.stock || 0,
                                          type: StockChangeType.ORDER_RELEASE,
                                          orderNo: order.orderNo,
                                          remark: `取消超时未支付订单 ${order.orderNo}`,
                                          operator: 'system'
                                    });
                              }

                              // 3. 使用事务批量更新库存
                              for (const update of stockUpdates) {
                                    await tx.sku.update({
                                          where: { id: update.id },
                                          data: { lockedStock: update.lockedStock }
                                    });
                              }

                              // 4. 批量创建库存日志
                              await tx.stockLog.createMany({
                                    data: stockLogs
                              });
                        }, { timeout: 10000 }); // 增加事务超时时间
                  }

                  logger.info(`成功取消 ${unpaidOrders?.length || 0} 个超时未支付订单`);
                  console.log(`成功取消 ${unpaidOrders.length} 个超时未支付订单`);

                  // 重置重试计数
                  this.retryCount[taskName] = 0;
            } catch (error) {
                  logger.error(`任务执行失败: ${taskName}`, { error });
                  // 实现重试逻辑
                  this.handleTaskError(taskName, this.cancelUnpaidOrders.bind(this));
            }
      };

      // 处理已支付订单自动完成
      async completeOrders() {
            const taskName = 'completeOrders';
            try {
                  logger.info(`开始执行任务: ${taskName}`);
                  const fifteenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

                  // 查找超过12小时已支付未完成的订单
                  const paidOrders = await prisma.order.findMany({
                        where: {
                              orderStatus: {
                                    in: [OrderStatus.PENDING_SHIPMENT, OrderStatus.SHIPPED]
                              },
                              paymentStatus: PaymentStatus.PAID,
                              updatedAt: {
                                    lt: fifteenDaysAgo
                              }
                        }
                  });

                  if (paidOrders.length === 0) {
                        return;
                  }

                  console.log(`找到 ${paidOrders.length} 个已支付订单需要自动完成`);

                  // 批量更新订单状态为完成
                  await prisma.order.updateMany({
                        where: {
                              id: {
                                    in: paidOrders.map(order => order.id)
                              }
                        },
                        data: {
                              orderStatus: OrderStatus.COMPLETED
                        }
                  });

                  console.log(`成功完成 ${paidOrders.length} 个订单`);
                  logger.info(`成功完成 ${paidOrders?.length || 0} 个订单`);
                  // 重置重试计数
                  this.retryCount[taskName] = 0;

            } catch (error) {
                  console.error('自动完成订单失败:', error);
                  logger.error(`任务执行失败: ${taskName}`, { error });
                  // 实现重试逻辑
                  this.handleTaskError(taskName, this.completeOrders.bind(this));
            }
      };

      // 错误处理与重试机制
      private handleTaskError(taskName: string, taskFn: () => Promise<void>) {
            if (!this.retryCount[taskName]) {
                  this.retryCount[taskName] = 0;
            }

            if (this.retryCount[taskName] < this.maxRetries) {
                  this.retryCount[taskName]++;
                  const delay = this.retryCount[taskName] * 30000; // 30秒、60秒、90秒递增重试
                  logger.info(`计划任务 ${taskName} 重试 ${this.retryCount[taskName]}/${this.maxRetries}, 延迟 ${delay / 1000} 秒`);

                  setTimeout(() => {
                        taskFn().catch(err => {
                              logger.error(`任务重试失败: ${taskName}`, { error: err });
                        });
                  }, delay);
            } else {
                  logger.error(`任务 ${taskName} 达到最大重试次数 ${this.maxRetries}, 放弃执行`);
                  // 可以在这里发送告警通知
                  this.retryCount[taskName] = 0;
            }
      };

      // 处理过期QPay发票
      async cleanupExpiredQPayInvoices() {
            const taskName = 'cleanupExpiredQPayInvoices';
            try {
                  logger.info(`开始执行任务: ${taskName}`);
                  const now = new Date();

                  // 查找过期发票
                  const expiredInvoices = await prisma.qPayInvoice.findMany({
                        where: {
                              status: 'PENDING',
                              expiresAt: { lt: now },
                              // 只处理失败尝试次数少于3次的发票
                              failedAttempts: { lt: 3 }
                        },
                        include: {
                              order: true
                        }
                  });

                  if (expiredInvoices.length === 0) return;
                  logger.info(`找到 ${expiredInvoices.length} 个过期QPay发票`);

                  // 处理过期发票
                  for (const invoice of expiredInvoices) {
                        try {
                              // 尝试取消QPay发票
                              await qpayService.cancelInvoice(invoice.invoiceId);

                              // 更新发票状态
                              await prisma.qPayInvoice.update({
                                    where: { id: invoice.id },
                                    data: {
                                          status: 'EXPIRED',
                                          failedAttempts: 0  // 成功后重置失败计数
                                    }
                              });

                              logger.info(`已过期QPay发票: ${invoice.invoiceId}, 订单: ${invoice.orderId}`);
                        } catch (error) {
                              // 更新失败尝试次数
                              await prisma.qPayInvoice.update({
                                    where: { id: invoice.id },
                                    data: {
                                          failedAttempts: { increment: 1 }  // 失败次数加1
                                    }
                              });

                              const updatedInvoice = await prisma.qPayInvoice.findUnique({
                                    where: { id: invoice.id },
                                    select: { failedAttempts: true }
                              });

                              // 记录详细的失败信息，包括当前失败次数
                              logger.error(`处理过期QPay发票失败`, {
                                    error: error instanceof Error ? error.message : '未知错误',
                                    invoiceId: invoice.invoiceId,
                                    failedAttempts: updatedInvoice?.failedAttempts || 0,
                                    maxAttempts: 3
                              });

                              // 如果已达到最大尝试次数，记录特别的警告日志
                              if (updatedInvoice && updatedInvoice.failedAttempts >= 3) {
                                    logger.warn(`QPay发票 ${invoice.invoiceId} 已达到最大处理尝试次数，将在后续任务中被跳过`, {
                                          orderId: invoice.orderId,
                                          failedAttempts: updatedInvoice.failedAttempts
                                    });
                              }

                        }
                  }

                  this.retryCount[taskName] = 0;
            } catch (error) {
                  logger.error(`任务执行失败: ${taskName}`, { error });
                  this.handleTaskError(taskName, this.cleanupExpiredQPayInvoices.bind(this));
            }
      }

      // 添加分批处理方法
      async cancelUnpaidOrdersWithBatch() {
            const batchSize = 50; // 每批处理50个订单
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

            let processedCount = 0;
            let hasMore = true;

            while (hasMore) {
                  // 分页查询超时订单
                  const unpaidOrders = await prisma.order.findMany({
                        where: {
                              orderStatus: OrderStatus.PENDING_PAYMENT,
                              paymentStatus: PaymentStatus.UNPAID,
                              createdAt: { lt: tenMinutesAgo }
                        },
                        include: {
                              orderItems: {
                                    select: { id: true, skuId: true, quantity: true }
                              }
                        },
                        take: batchSize,
                        skip: processedCount
                  });

                  if (unpaidOrders.length === 0) {
                        hasMore = false;
                        break;
                  }

                  // 处理这一批订单
                  for (const order of unpaidOrders) {
                        try {
                              await prisma.$transaction(async (tx) => {
                                    // 更新订单状态
                                    await tx.order.update({
                                          where: { id: order.id },
                                          data: { orderStatus: OrderStatus.CANCELLED }
                                    });

                                    // 处理库存...
                              });
                        } catch (error) {
                              logger.error(`处理订单 ${order.id} 失败`, { error });
                        }
                  }

                  processedCount += unpaidOrders.length;
                  console.log(`已处理 ${processedCount} 个超时订单`);
            }

            return processedCount;
      }


      // 启动定时任务
      startScheduleTasks() {
            // 使用cron表达式替代setInterval
            // 每分钟执行一次取消超时订单任务
            this.taskRegistry.cancelUnpaid = cron.schedule('*/5 * * * *', async () => {
                  try {
                        // 添加内存使用情况日志
                        const memBefore = process.memoryUsage().heapUsed / 1024 / 1024;
                        console.log(`取消超时订单任务开始, 内存使用: ${memBefore.toFixed(2)}MB`);

                        await this.cancelUnpaidOrdersWithBatch();

                        // 执行完成后手动触发垃圾回收
                        if (global.gc) {
                              global.gc();
                        }

                        const memAfter = process.memoryUsage().heapUsed / 1024 / 1024;
                        console.log(`取消超时订单任务完成, 内存使用: ${memAfter.toFixed(2)}MB, 差异: ${(memAfter - memBefore).toFixed(2)}MB`);
                  } catch (error) {
                        logger.error('取消超时订单任务异常', { error });
                  }
            }); 1

            // 每5分钟执行一次自动完成订单任务
            this.taskRegistry.autoComplete = cron.schedule('*/15 * * * *', () => {
                  this.completeOrders().catch(error => {
                        logger.error('自动完成订单任务异常', { error });
                  });
            });

            // 每天凌晨3点执行库存审计任务
            this.taskRegistry.inventoryAudit = cron.schedule('0 3 * * *', () => {
                  logger.info('开始执行库存审计任务');
                  inventoryService.auditInventory().catch(error => {
                        logger.error('库存审计任务异常', { error });
                  });
            });

            // 每10分钟执行一次清理过期QPay发票任务
            this.taskRegistry.qpayInvoiceCleanup = cron.schedule('*/10 * * * *', () => {
                  this.cleanupExpiredQPayInvoices().catch(error => {
                        logger.error('清理过期QPay发票任务异常', { error });
                  });
            });

            logger.info('✅ 所有订单定时任务已启动');
      };

      // 停止所有任务
      stopAllTasks() {
            Object.values(this.taskRegistry).forEach(task => task.stop());
            logger.info('所有定时任务已停止');
      };


}

export const orderScheduleService = new OrderScheduleService();