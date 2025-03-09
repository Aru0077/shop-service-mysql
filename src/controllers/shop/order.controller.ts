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
      // 创建订单
      createOrder: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { addressId, cartItemIds, remark } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 1. 快速验证 - 只检查基本条件
            // 检查收货地址是否存在且属于用户（保留，因为这是必要验证）
            const address = await prisma.userAddress.findFirst({
                  where: {
                        id: addressId,
                        userId
                  },
                  select: {  // 只选择需要的字段
                        id: true,
                        receiverName: true,
                        receiverPhone: true,
                        province: true,
                        city: true,
                        detailAddress: true
                  }
            });

            if (!address) {
                  throw new AppError(404, 'fail', '收货地址不存在');
            }

            // 2. 验证购物车项是否存在 - 优化查询，只获取必要信息
            const cartItems = await prisma.userCartItem.findMany({
                  where: {
                        id: { in: cartItemIds },
                        userId
                  },
                  select: {
                        id: true,
                        skuId: true,
                        quantity: true,
                        product: {
                              select: {
                                    id: true,
                                    name: true,
                                    mainImage: true,
                                    status: true
                              }
                        }
                  }
            });

            if (cartItems.length === 0) {
                  throw new AppError(400, 'fail', '购物车为空');
            }

            // 快速筛查商品状态 - 确保所有商品都在线
            const offlineProducts = cartItems.filter(item => item.product.status !== ProductStatus.ONLINE);
            if (offlineProducts.length > 0) {
                  throw new AppError(400, 'fail', `商品 ${offlineProducts.map(p => p.product.name).join(', ')} 已下架`);
            }

            // 3. 获取SKU信息 - 优化查询，只获取关键字段
            const skuIds = cartItems.map(item => item.skuId);
            const skus = await prisma.sku.findMany({
                  where: {
                        id: { in: skuIds }
                  },
                  select: {
                        id: true,
                        price: true,
                        promotion_price: true,
                        stock: true,
                        productId: true,
                        sku_specs: {
                              select: {
                                    spec: {
                                          select: {
                                                name: true
                                          }
                                    },
                                    specValue: {
                                          select: {
                                                value: true
                                          }
                                    }
                              }
                        }
                  }
            });

            // 创建SKU映射以提高查找效率
            const skuMap = new Map(skus.map(sku => [sku.id, sku]));

            // 4. 计算订单金额和准备订单项
            let totalAmount = 0;
            const orderItems = [];
            const inventoryUpdates = [];

            for (const cartItem of cartItems) {
                  const sku = skuMap.get(cartItem.skuId);

                  if (!sku) {
                        throw new AppError(400, 'fail', `商品 ${cartItem.product.name} 的SKU不存在`);
                  }

                  // 库存初步检查（详细检查将在事务中进行）
                  if ((sku.stock || 0) < cartItem.quantity) {
                        throw new AppError(400, 'fail', `商品 ${cartItem.product.name} 库存不足`);
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
                        productName: cartItem.product.name
                  });
            }

            // 5. 创建订单 - 分两个阶段处理
            const orderId = uuidv4();
            const orderNo = generateOrderNo();

            // 第一阶段：快速创建订单记录（仅包含最基本信息）
            const order = await prisma.order.create({
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
                        paymentAmount: totalAmount
                  }
            });

            // 6. 将库存锁定和订单项创建任务添加到队列
            await orderQueue.add('processOrderInventory', {
                  orderId,
                  orderNo,
                  orderItems,
                  inventoryUpdates,
                  cartItemIds
            }, {
                  attempts: 3,
                  backoff: 2000,
                  removeOnComplete: true
            });

            // 7. 设置订单超时自动取消（10分钟）
            const cancelOrderKey = `order:${orderId}:auto_cancel`;
            await redisClient.setEx(cancelOrderKey, 600, '1');

            // 8. 返回订单基本信息（不等待订单项处理完成）
            res.sendSuccess({
                  id: order.id,
                  orderNo: order.orderNo,
                  totalAmount: order.totalAmount,
                  orderStatus: order.orderStatus,
                  paymentStatus: order.paymentStatus,
                  createdAt: order.createdAt
            }, '订单创建成功，正在处理中');
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

      // 支付订单
      // 优化后的支付方法 - 插入到order.controller.ts中
      payOrder: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;
            const { paymentType, transactionId = uuidv4() } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 查询订单基本信息（不包含详细订单项）
            const order = await prisma.order.findFirst({
                  where: {
                        id,
                        userId
                  },
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
                  throw new AppError(400, 'fail', '订单已支付，请勿重复支付');
            }

            // 检查订单是否已超时
            const cancelOrderKey = `order:${order.id}:auto_cancel`;
            const isOrderValid = await redisClient.exists(cancelOrderKey);

            if (isOrderValid === 0) {
                  throw new AppError(400, 'fail', '订单已超时，请重新下单');
            }

            // 创建支付记录和更新订单状态（核心操作）
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

            // 删除订单超时任务
            await redisClient.del(cancelOrderKey);

            // 设置12小时后自动完成订单
            const autoCompleteKey = `order:${order.id}:auto_complete`;
            await redisClient.setEx(autoCompleteKey, 12 * 60 * 60, '1');

            // 将库存实际扣减操作放入队列（异步处理）
            await orderQueue.add('processOrderPayment', {
                  orderId: order.id,
                  orderNo: order.orderNo,
                  orderItems: order.orderItems.map(item => ({
                        ...item,
                        // 这里可能需要查询productId，或者在订单项中添加productId字段
                        productId: null // 需要根据实际情况设置
                  }))
            }, {
                  attempts: 3,
                  backoff: 2000,
                  removeOnComplete: true
            });

            res.sendSuccess({ orderId: order.id }, '订单支付成功');
      })
};