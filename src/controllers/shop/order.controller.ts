// src/controllers/shop/order.controller.ts
import { Request, Response } from 'express';
import { prisma, redisClient } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { v4 as uuidv4 } from 'uuid';
import { OrderStatus, PaymentStatus } from '../../constants/orderStatus.enum';
import { StockChangeType } from '../../constants/stock.constants';
import { ProductStatus } from '@prisma/client';

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

            // 检查收货地址是否存在且属于用户
            const address = await prisma.userAddress.findFirst({
                  where: {
                        id: addressId,
                        userId
                  }
            });

            if (!address) {
                  throw new AppError(404, 'fail', '收货地址不存在');
            }

            // 直接获取指定ID的购物车项
            const cartItems = await prisma.userCartItem.findMany({
                  where: {
                        id: { in: cartItemIds },
                        userId
                  },
                  include: {
                        product: true
                  }
            });

            if (cartItems.length === 0) {
                  throw new AppError(400, 'fail', '购物车为空');
            }

            // 验证商品是否可购买
            const skuIds = cartItems.map(item => item.skuId);
            const skus = await prisma.sku.findMany({
                  where: {
                        id: { in: skuIds }
                  },
                  include: {
                        product: true,
                        sku_specs: {
                              include: {
                                    spec: true,
                                    specValue: true
                              }
                        }
                  }
            });

            // 检查商品状态和库存
            const skuMap = new Map(skus.map(sku => [sku.id, sku]));
            let totalAmount = 0;

            // 定义订单项接口
            interface OrderItemCreate {
                  skuId: number;
                  productName: string;
                  mainImage: string;
                  skuSpecs: { specName: string; specValue: string }[];
                  quantity: number;
                  unitPrice: number;
                  totalPrice: number;
            }

            const orderItems: OrderItemCreate[] = [];

            for (const cartItem of cartItems) {
                  const sku = skuMap.get(cartItem.skuId);

                  if (!sku) {
                        throw new AppError(400, 'fail', `商品 ${cartItem.product.name} 的SKU不存在`);
                  }

                  if (sku.product.status !== ProductStatus.ONLINE) {
                        throw new AppError(400, 'fail', `商品 ${cartItem.product.name} 已下架`);
                  }

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
                        productName: sku.product.name,
                        mainImage: sku.product.mainImage || '',
                        skuSpecs: skuSpecsInfo,
                        quantity: cartItem.quantity,
                        unitPrice,
                        totalPrice: itemTotalPrice
                  });
            }

            // 使用事务创建订单和处理库存
            const orderId = uuidv4();
            const orderNo = generateOrderNo();

            await prisma.$transaction(async (tx) => {
                  // 创建订单
                  const order = await tx.order.create({
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
                              paymentAmount: totalAmount, // 目前没有折扣等，所以支付金额等于总金额
                              orderItems: {
                                    create: orderItems
                              }
                        }
                  });

                  // 锁定库存
                  for (const item of orderItems) {
                        await tx.sku.update({
                              where: { id: item.skuId },
                              data: {
                                    lockedStock: {
                                          increment: item.quantity
                                    }
                              }
                        });

                        // 记录库存变更日志
                        await tx.stockLog.create({
                              data: {
                                    skuId: item.skuId,
                                    changeQuantity: -item.quantity, // 负数表示锁定
                                    currentStock: skuMap.get(item.skuId)!.stock || 0,
                                    type: StockChangeType.ORDER_LOCK,
                                    orderNo,
                                    remark: `创建订单锁定库存 ${orderNo}`,
                                    operator: 'user'
                              }
                        });
                  }

                  // 删除购物车中已下单的商品
                  await tx.userCartItem.deleteMany({
                        where: {
                              id: { in: cartItemIds }
                        }
                  });
            });


            // 设置订单超时自动取消（10分钟）
            const cancelOrderKey = `order:${orderId}:auto_cancel`;
            await redisClient.setEx(cancelOrderKey, 600, '1');

            // 获取创建的订单详情
            const createdOrder = await prisma.order.findUnique({
                  where: { id: orderId },
                  include: {
                        orderItems: true
                  }
            });

            res.sendSuccess(createdOrder, '订单创建成功');
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
      payOrder: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;
            const { paymentType, transactionId = uuidv4() } = req.body;

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
                        orderItems: true
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

            // 使用事务处理支付
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

                  // 扣减库存（从锁定库存转为实际扣减）
                  for (const item of order.orderItems) {
                        const sku = await tx.sku.findUnique({
                              where: { id: item.skuId }
                        });

                        if (sku) {
                              await tx.sku.update({
                                    where: { id: item.skuId },
                                    data: {
                                          lockedStock: {
                                                decrement: item.quantity
                                          },
                                          stock: {
                                                decrement: item.quantity
                                          },
                                          // 更新商品销量
                                          product: {
                                                update: {
                                                      salesCount: {
                                                            increment: item.quantity
                                                      }
                                                }
                                          }
                                    }
                              });

                              // 记录库存变更日志
                              await tx.stockLog.create({
                                    data: {
                                          skuId: item.skuId,
                                          changeQuantity: -item.quantity,
                                          currentStock: (sku.stock || 0) - item.quantity,
                                          type: StockChangeType.STOCK_OUT,
                                          orderNo: order.orderNo,
                                          remark: `订单支付扣减库存 ${order.orderNo}`,
                                          operator: 'user'
                                    }
                              });
                        }
                  }
            });

            // 删除订单超时任务
            await redisClient.del(cancelOrderKey);

            // 设置12小时后自动完成订单
            const autoCompleteKey = `order:${order.id}:auto_complete`;
            await redisClient.setEx(autoCompleteKey, 12 * 60 * 60, '1');

            res.sendSuccess({ orderId: order.id }, '订单支付成功');
      })
};