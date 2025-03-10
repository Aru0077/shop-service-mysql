// src/controllers/shop/order.controller.ts
import { Request, Response } from 'express';
import { prisma, redisClient } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { v4 as uuidv4 } from 'uuid';
import { OrderStatus, PaymentStatus } from '../../constants/orderStatus.enum';
import { StockChangeType } from '../../constants/stock.constants';
import { ProductStatus } from '@prisma/client';
import { orderQueue } from '../../queues/order.queue';
import { inventoryService } from '../../services/inventory.service';

// 生成订单号
function generateOrderNo(): string {
      const now = new Date();
      const year = now.getFullYear().toString().substr(-2);
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hour = String(now.getHours()).padStart(2, '0');
      const minute = String(now.getMinutes()).padStart(2, '0');
      const second = String(now.getSeconds()).padStart(2, '0');
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');

      return `${year}${month}${day}${hour}${minute}${second}${random}`;
}


export const orderController = {
      // 创建订单  - 优化后的创建订单方法 - 插入到order.controller.ts中 
      createOrder: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { addressId, cartItemIds, remark } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 1. 幂等性控制 - 防止重复下单
            const idempotencyKey = `order:idempotency:${userId}:${cartItemIds.join('_')}`;
            const existingOrderId = await redisClient.get(idempotencyKey);

            if (existingOrderId) {
                  // 返回已创建的订单信息
                  const existingOrder = await prisma.order.findUnique({
                        where: { id: existingOrderId },
                        select: {
                              id: true,
                              orderNo: true,
                              orderStatus: true,
                              paymentStatus: true,
                              paymentAmount: true
                        }
                  });

                  if (existingOrder) {
                        return res.sendSuccess(existingOrder, '订单已存在，请勿重复提交');
                  }
            }

            // 2. 用唯一锁限制同一用户并发下单请求
            const userOrderLockKey = `order:lock:${userId}`;
            const acquireLock = await redisClient.set(userOrderLockKey, '1', {
                  EX: 10, // 10秒过期
                  NX: true // 只有不存在时才设置
            });

            if (!acquireLock) {
                  throw new AppError(429, 'fail', '操作太频繁，请稍后再试');
            }

            const orderNo = generateOrderNo();
            const orderId = uuidv4();
            let inventoryUpdates = [];

            try {
                  // 3. 并行查询关键数据
                  const [address, cartItems] = await Promise.all([
                        // 查询地址
                        prisma.userAddress.findFirst({
                              where: { id: addressId, userId },
                              select: {
                                    receiverName: true,
                                    receiverPhone: true,
                                    province: true,
                                    city: true,
                                    detailAddress: true
                              }
                        }),
                        // 查询购物车项
                        prisma.userCartItem.findMany({
                              where: {
                                    id: { in: cartItemIds },
                                    userId
                              },
                              include: {
                                    product: {
                                          select: {
                                                id: true,
                                                name: true,
                                                mainImage: true,
                                                status: true
                                          }
                                    }
                              }
                        })
                  ]);

                  // 4. 基础验证
                  if (!address) {
                        throw new AppError(404, 'fail', '收货地址不存在');
                  }

                  if (cartItems.length === 0) {
                        throw new AppError(400, 'fail', '购物车为空');
                  }

                  // 检查商品状态
                  const offlineProducts = cartItems.filter(item =>
                        item.product.status !== ProductStatus.ONLINE);

                  if (offlineProducts.length > 0) {
                        throw new AppError(400, 'fail',
                              `商品 ${offlineProducts.map(p => p.product.name).join(', ')} 已下架`);
                  }

                  // 5. 获取SKU信息和预检查库存
                  const skuIds = cartItems.map(item => item.skuId);
                  const skus = await prisma.sku.findMany({
                        where: { id: { in: skuIds } },
                        select: {
                              id: true,
                              productId: true,
                              price: true,
                              promotion_price: true,
                              stock: true,
                              sku_specs: {
                                    select: {
                                          spec: { select: { name: true } },
                                          specValue: { select: { value: true } }
                                    }
                              }
                        }
                  });

                  // 创建SKU映射
                  const skuMap = new Map(skus.map(sku => [sku.id, sku]));

                  // 6. 计算订单金额和准备订单项
                  let totalAmount = 0;
                  const orderItems: { skuId: number; productName: string; mainImage: string; skuSpecs: { specName: string; specValue: string; }[]; quantity: number; unitPrice: number; totalPrice: number; }[] = [];
                  const insufficientItems = [];

                  for (const cartItem of cartItems) {
                        const sku = skuMap.get(cartItem.skuId);

                        if (!sku) {
                              insufficientItems.push({
                                    name: cartItem.product.name,
                                    reason: 'SKU不存在'
                              });
                              continue;
                        }

                        // 库存不足检查
                        if ((sku.stock || 0) < cartItem.quantity) {
                              insufficientItems.push({
                                    name: cartItem.product.name,
                                    available: sku.stock || 0,
                                    requested: cartItem.quantity,
                                    reason: '库存不足'
                              });
                              continue;
                        }

                        // 计算商品价格
                        const unitPrice = sku.promotion_price || sku.price;
                        const itemTotalPrice = unitPrice * cartItem.quantity;
                        totalAmount += itemTotalPrice;

                        // 获取SKU规格信息
                        const skuSpecsInfo = sku.sku_specs.map(spec => ({
                              specName: spec.spec.name,
                              specValue: spec.specValue.value
                        }));

                        // 构建订单项
                        orderItems.push({
                              skuId: sku.id,
                              productName: cartItem.product.name,
                              mainImage: cartItem.product.mainImage || '',
                              skuSpecs: skuSpecsInfo,
                              quantity: cartItem.quantity,
                              unitPrice,
                              totalPrice: itemTotalPrice
                        });

                        // 记录需要更新的库存
                        inventoryUpdates.push({
                              skuId: sku.id,
                              quantity: cartItem.quantity,
                              productId: sku.productId,
                              productName: cartItem.product.name
                        });
                  }

                  // 如果有库存不足的商品，不创建订单
                  if (insufficientItems.length > 0) {
                        throw new AppError(400, 'fail',
                              `以下商品库存不足: ${JSON.stringify(insufficientItems)}`);
                  }

                  // 7. 查询可用的满减规则
                  const now = new Date();
                  const applicablePromotion = await prisma.promotion.findFirst({
                        where: {
                              isActive: true,
                              startTime: { lte: now },
                              endTime: { gte: now },
                              thresholdAmount: { lte: totalAmount }
                        },
                        orderBy: { thresholdAmount: 'desc' }
                  });

                  // 8. 计算折扣金额
                  let discountAmount = 0;
                  let promotionId = null;

                  if (applicablePromotion) {
                        promotionId = applicablePromotion.id;

                        if (applicablePromotion.type === 'AMOUNT_OFF') {
                              discountAmount = applicablePromotion.discountAmount;
                        } else if (applicablePromotion.type === 'PERCENT_OFF') {
                              discountAmount = Math.floor(totalAmount * (applicablePromotion.discountAmount / 100));
                        }

                        discountAmount = Math.min(discountAmount, totalAmount);
                  }

                  // 计算实际支付金额
                  const paymentAmount = totalAmount - discountAmount;

                  // 9. 创建订单记录
                  await prisma.$transaction(async (tx) => {
                        // 创建订单基本信息
                        await tx.order.create({
                              data: {
                                    id: orderId,
                                    orderNo,
                                    userId,
                                    orderStatus: OrderStatus.PENDING_PAYMENT,
                                    paymentStatus: PaymentStatus.UNPAID,
                                    shippingAddress: {
                                          receiverName: address.receiverName,
                                          receiverPhone: address.receiverPhone,
                                          province: address.province,
                                          city: address.city,
                                          detailAddress: address.detailAddress
                                    },
                                    totalAmount,
                                    discountAmount,
                                    promotionId,
                                    paymentAmount
                              }
                        });

                        // 直接创建订单项（小批量可以直接在事务中处理）
                        if (orderItems.length <= 5) {
                              await tx.orderItem.createMany({
                                    data: orderItems.map(item => ({
                                          orderId,
                                          ...item
                                    }))
                              });
                        }
                  }, { timeout: 10000 });

                  // 为幂等性控制存储订单ID
                  await redisClient.setEx(idempotencyKey, 3600, orderId); // 1小时有效期

                  // 10. 处理库存预占和订单项创建
                  await orderQueue.add('processOrderItems', {
                        orderId,
                        orderItems,
                        orderNo,
                        inventoryUpdates,
                        cartItemIds
                  }, {
                        attempts: 3,
                        backoff: 2000,
                        removeOnComplete: true
                  });

                  // 11. 设置订单超时自动取消（10分钟）
                  const cancelOrderKey = `order:${orderId}:auto_cancel`;
                  await redisClient.setEx(cancelOrderKey, 600, '1');

                  // 12. 返回订单基本信息
                  res.sendSuccess({
                        id: orderId,
                        orderNo,
                        totalAmount,
                        discountAmount,
                        paymentAmount,
                        orderStatus: OrderStatus.PENDING_PAYMENT,
                        paymentStatus: PaymentStatus.UNPAID,
                        createdAt: new Date(),
                        timeoutSeconds: 600, // 10分钟支付期限
                        promotion: applicablePromotion ? {
                              id: applicablePromotion.id,
                              name: applicablePromotion.name,
                              type: applicablePromotion.type,
                              discountAmount: applicablePromotion.discountAmount
                        } : null
                  }, '订单创建成功，请在10分钟内完成支付');
            } catch (error) {
                  // 发生错误时释放已预占的库存
                  if (inventoryUpdates.length > 0) {
                        for (const update of inventoryUpdates) {
                              try {
                                    await inventoryService.releasePreOccupied(
                                          update.skuId,
                                          update.quantity,
                                          orderNo
                                    );
                              } catch (releaseError) {
                                    console.error(`释放库存失败 (${update.skuId}):`, releaseError);
                              }
                        }
                  }

                  if (error instanceof AppError) {
                        throw error;
                  }
                  throw new AppError(500, 'fail', '创建订单失败，请稍后重试');
            } finally {
                  // 释放用户下单锁
                  await redisClient.del(userOrderLockKey);
            }
      }),

      // 获取订单列表
      getOrderList: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { page = '1', limit = '10', status } = req.query;
            const pageNumber = parseInt(page as string);
            const limitNumber = parseInt(limit as string);
            const skip = (pageNumber - 1) * limitNumber;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 构建查询条件
            const where: any = { userId };
            if (status) {
                  where.orderStatus = parseInt(status as string);
            }

            // 查询订单总数
            const total = await prisma.order.count({ where });

            // 查询订单列表
            const orders = await prisma.order.findMany({
                  where,
                  include: {
                        orderItems: {
                              include: {
                                    sku: {
                                          select: {
                                                id: true,
                                                skuCode: true,
                                                sku_specs: {
                                                      include: {
                                                            spec: true,
                                                            specValue: true
                                                      }
                                                }
                                          }
                                    }
                              }
                        },
                        paymentLogs: {
                              orderBy: {
                                    createdAt: 'desc'
                              },
                              take: 1
                        }
                  },
                  orderBy: {
                        createdAt: 'desc'
                  },
                  skip,
                  take: limitNumber
            });

            // 检查是否有即将超时的订单
            const ordersWithTimeout = await Promise.all(
                  orders.map(async (order) => {
                        if (order.orderStatus === OrderStatus.PENDING_PAYMENT) {
                              const cancelOrderKey = `order:${order.id}:auto_cancel`;
                              const ttl = await redisClient.ttl(cancelOrderKey);
                              return {
                                    ...order,
                                    timeoutSeconds: ttl > 0 ? ttl : 0
                              };
                        }
                        return {
                              ...order,
                              timeoutSeconds: null
                        };
                  })
            );

            res.sendSuccess({
                  total,
                  page: pageNumber,
                  limit: limitNumber,
                  data: ordersWithTimeout
            });
      }),

      // 获取订单详情
      getOrderDetail: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 查询订单
            const order = await prisma.order.findFirst({
                  where: {
                        id,
                        userId
                  },
                  include: {
                        orderItems: {
                              include: {
                                    sku: {
                                          select: {
                                                id: true,
                                                skuCode: true,
                                                sku_specs: {
                                                      include: {
                                                            spec: true,
                                                            specValue: true
                                                      }
                                                }
                                          }
                                    }
                              }
                        },
                        paymentLogs: {
                              orderBy: {
                                    createdAt: 'desc'
                              }
                        }
                  }
            });

            if (!order) {
                  throw new AppError(404, 'fail', '订单不存在');
            }

            // 检查是否有超时信息
            let timeoutSeconds = null;
            if (order.orderStatus === OrderStatus.PENDING_PAYMENT) {
                  const cancelOrderKey = `order:${order.id}:auto_cancel`;
                  const ttl = await redisClient.ttl(cancelOrderKey);
                  timeoutSeconds = ttl > 0 ? ttl : 0;
            }

            res.sendSuccess({
                  ...order,
                  timeoutSeconds
            });
      }),

      // 支付订单  - 优化后的支付订单方法 - 插入到order.controller.ts中 
      payOrder: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;
            const { paymentType, transactionId = uuidv4() } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 1. 幂等性控制 - 避免重复支付
            const paymentIdempotencyKey = `payment:idempotency:${id}:${transactionId}`;
            const hasProcessed = await redisClient.exists(paymentIdempotencyKey);

            if (hasProcessed) {
                  // 返回已处理的支付状态
                  return res.sendSuccess({ orderId: id, status: 'processed' }, '订单已处理，请勿重复支付');
            }

            // 设置幂等键，5分钟内有效
            await redisClient.setEx(paymentIdempotencyKey, 300, '1');

            // 2. 并发控制锁，确保同一订单不会并发处理
            const orderPayLockKey = `order:pay:lock:${id}`;
            const acquireLock = await redisClient.set(orderPayLockKey, '1', {
                  EX: 30, // 30秒过期
                  NX: true // 只有不存在时才设置
            });

            if (!acquireLock) {
                  throw new AppError(429, 'fail', '订单正在处理中，请稍后再试');
            }

            // 3. 启用失败自动重试机制
            const retryKey = `payment:retry:${id}`;
            const retryCount = await redisClient.get(retryKey);

            try {
                  // 4. 查询订单并验证状态
                  const order = await prisma.order.findFirst({
                        where: { id, userId },
                        select: {
                              id: true,
                              orderNo: true,
                              orderStatus: true,
                              paymentStatus: true,
                              paymentAmount: true,
                              orderItems: {
                                    select: {
                                          id: true,
                                          skuId: true,
                                          quantity: true
                                    }
                              }
                        }
                  });

                  if (!order) {
                        throw new AppError(404, 'fail', '订单不存在');
                  }

                  if (order.orderStatus !== OrderStatus.PENDING_PAYMENT) {
                        throw new AppError(400, 'fail', '订单状态不正确，无法支付');
                  }

                  if (order.paymentStatus === PaymentStatus.PAID) {
                        // 已支付的订单清理幂等键
                        await redisClient.del(paymentIdempotencyKey);
                        return res.sendSuccess({ orderId: order.id }, '订单已支付，请勿重复支付');
                  }

                  // 5. 检查订单是否已超时
                  const cancelOrderKey = `order:${order.id}:auto_cancel`;
                  const isOrderValid = await redisClient.exists(cancelOrderKey);

                  if (isOrderValid === 0 && !retryCount) {
                        throw new AppError(400, 'fail', '订单已超时，请重新下单');
                  }

                  // 6. 模拟外部支付调用
                  // 此处应调用实际支付网关，处理实际支付逻辑
                  // 简化示例，仅作为概念演示

                  // 7. 更新订单状态和创建支付记录
                  await prisma.$transaction(async (tx) => {
                        // 创建支付记录
                        await tx.paymentLog.create({
                              data: {
                                    orderId: order.id,
                                    amount: order.paymentAmount,
                                    paymentType,
                                    transactionId,
                                    status: 1 // 支付成功
                              }
                        });

                        // 更新订单状态
                        await tx.order.update({
                              where: { id: order.id },
                              data: {
                                    orderStatus: OrderStatus.PENDING_SHIPMENT,
                                    paymentStatus: PaymentStatus.PAID
                              }
                        });
                  });

                  // 8. 支付成功后的操作
                  // 删除订单超时任务
                  await redisClient.del(cancelOrderKey);

                  // 设置12小时后自动完成订单
                  const autoCompleteKey = `order:${order.id}:auto_complete`;
                  await redisClient.setEx(autoCompleteKey, 12 * 60 * 60, '1');

                  // 清理重试计数
                  await redisClient.del(retryKey);

                  // 9. 将库存实际扣减操作异步处理
                  await orderQueue.add('processOrderPayment', {
                        orderId: order.id,
                        orderNo: order.orderNo,
                        orderItems: order.orderItems
                  }, {
                        attempts: 5, // 提高重试次数
                        backoff: {
                              type: 'exponential',
                              delay: 2000
                        },
                        removeOnComplete: true
                  });

                  // 10. 添加到支付完成事件流
                  await orderQueue.add('processPaymentEvent', {
                        orderId: order.id,
                        orderNo: order.orderNo,
                        paymentAmount: order.paymentAmount,
                        paymentType,
                        transactionId,
                        timestamp: new Date().toISOString()
                  }, {
                        attempts: 3,
                        removeOnComplete: true
                  });

                  // 响应客户端
                  res.sendSuccess({
                        orderId: order.id,
                        orderNo: order.orderNo,
                        paymentStatus: PaymentStatus.PAID,
                        orderStatus: OrderStatus.PENDING_SHIPMENT,
                        transactionId
                  }, '订单支付成功');

            } catch (error) {
                  // 记录失败并设置重试机制
                  const currentRetry = retryCount ? parseInt(retryCount) : 0;

                  if (currentRetry < 3) { // 最多重试3次
                        await redisClient.setEx(retryKey, 300, (currentRetry + 1).toString());
                  }

                  // 记录支付失败日志（实际项目应记录到持久化存储）
                  console.error('支付处理失败:', error);

                  throw error;
            } finally {
                  // 释放支付处理锁
                  await redisClient.del(orderPayLockKey);
            }
      }),
};