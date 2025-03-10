// src/services/orderSchedule.service.ts
import { prisma } from '../config';
import { OrderStatus, PaymentStatus } from '../constants/orderStatus.enum';
import { StockChangeType } from '../constants/stock.constants';

class OrderScheduleService {
      // 处理超时未支付订单 
      async cancelUnpaidOrders() {
            try {
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

                  console.log(`成功取消 ${unpaidOrders.length} 个超时未支付订单`);
            } catch (error) {
                  console.error('取消超时未支付订单失败:', error);
            }
      };

      // 处理已支付订单自动完成
      async completeOrders() {
            try {
                  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

                  // 查找超过12小时已支付未完成的订单
                  const paidOrders = await prisma.order.findMany({
                        where: {
                              orderStatus: {
                                    in: [OrderStatus.PENDING_SHIPMENT, OrderStatus.SHIPPED]
                              },
                              paymentStatus: PaymentStatus.PAID,
                              updatedAt: {
                                    lt: twelveHoursAgo
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
            } catch (error) {
                  console.error('自动完成订单失败:', error);
            }
      };

      // 启动定时任务
      startScheduleTasks() {
            // 每分钟检查一次超时未支付订单
            setInterval(() => this.cancelUnpaidOrders(), 60 * 1000);

            // 每5分钟检查一次需要自动完成的订单
            setInterval(() => this.completeOrders(), 5 * 60 * 1000);

            console.log('✅ 订单定时任务已启动');
      };
}

export const orderScheduleService = new OrderScheduleService();