// src/services/orderSchedule.service.ts
import { prisma } from '../config';
import { OrderStatus, PaymentStatus } from '../constants/orderStatus.enum';
import { StockChangeType } from '../constants/stock.constants';

class OrderScheduleService {
      // 处理超时未支付订单
      async cancelUnpaidOrders() {
            try {
                  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

                  // 查找超过10分钟未支付的订单
                  const unpaidOrders = await prisma.order.findMany({
                        where: {
                              orderStatus: OrderStatus.PENDING_PAYMENT,
                              paymentStatus: PaymentStatus.UNPAID,
                              createdAt: {
                                    lt: tenMinutesAgo
                              }
                        },
                        include: {
                              orderItems: true
                        }
                  });

                  if (unpaidOrders.length === 0) {
                        return;
                  }

                  console.log(`找到 ${unpaidOrders.length} 个超时未支付订单，正在取消...`);

                  // 使用事务处理每个订单取消
                  for (const order of unpaidOrders) {
                        await prisma.$transaction(async (tx) => {
                              // 更新订单状态为取消
                              await tx.order.update({
                                    where: { id: order.id },
                                    data: {
                                          orderStatus: OrderStatus.CANCELLED
                                    }
                              });

                              // 释放被锁定的库存
                              for (const item of order.orderItems) {
                                    const sku = await tx.sku.findUnique({
                                          where: { id: item.skuId }
                                    });

                                    if (sku) {
                                          // 释放锁定库存
                                          await tx.sku.update({
                                                where: { id: item.skuId },
                                                data: {
                                                      lockedStock: {
                                                            decrement: item.quantity
                                                      }
                                                }
                                          });

                                          // 记录库存变更日志
                                          await tx.stockLog.create({
                                                data: {
                                                      skuId: item.skuId,
                                                      changeQuantity: item.quantity,
                                                      currentStock: sku.stock || 0,
                                                      type: StockChangeType.ORDER_RELEASE,
                                                      orderNo: order.orderNo,
                                                      remark: `取消超时未支付订单 ${order.orderNo}`,
                                                      operator: 'system'
                                                }
                                          });
                                    }
                              }
                        });
                  }

                  console.log(`成功取消 ${unpaidOrders.length} 个超时未支付订单`);
            } catch (error) {
                  console.error('取消超时未支付订单失败:', error);
            }
      }

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
      }

      // 启动定时任务
      startScheduleTasks() {
            // 每分钟检查一次超时未支付订单
            setInterval(() => this.cancelUnpaidOrders(), 60 * 1000);

            // 每5分钟检查一次需要自动完成的订单
            setInterval(() => this.completeOrders(), 5 * 60 * 1000);

            console.log('✅ 订单定时任务已启动');
      }
}

export const orderScheduleService = new OrderScheduleService();