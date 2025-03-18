// src/services/order.service.ts
import { prisma, redisClient } from '../config';
import { AppError } from '../utils/http.utils';
import { OrderStatus, PaymentStatus } from '../constants/orderStatus.enum';
import { ProductStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { orderQueue } from '../queues/order.queue';
import { StockChangeType } from '../constants/stock.constants';
import { inventoryService } from './inventory.service';

// 增强的订单服务
class OrderService {
      // 生成订单号
      generateOrderNo(): string {
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

      // 生成交易ID
      generateTransactionId(): string {
            return uuidv4();
      }

      // 获取幂等性键
      async getIdempotencyKey(userId: string, cartItemIds: number[]): Promise<string> {
            const sortedIds = [...cartItemIds].sort().join('_');
            return `order:idempotency:${userId}:${sortedIds}`;
      }

      // 获取订单基本信息
      async getOrderBasicInfo(orderId: string) {
            return await prisma.order.findUnique({
                  where: { id: orderId },
                  select: {
                        id: true,
                        orderNo: true,
                        orderStatus: true,
                        paymentStatus: true,
                        shippingAddress: true,
                        totalAmount: true,
                        paymentAmount: true,
                        discountAmount: true,
                        createdAt: true,
                        updatedAt: true,
                        promotionId: true
                  }
            });
      }

      // 获取订单项
      async getOrderItems(orderId: string) {
            return await prisma.orderItem.findMany({
                  where: { orderId },
                  select: {
                        id: true,
                        productName: true,
                        mainImage: true,
                        skuSpecs: true,
                        quantity: true,
                        unitPrice: true,
                        totalPrice: true,
                        skuId: true
                  }
            });
      }

      // 获取订单支付记录
      async getOrderPayments(orderId: string) {
            return await prisma.paymentLog.findMany({
                  where: { orderId },
                  orderBy: { createdAt: 'desc' },
                  select: {
                        id: true,
                        amount: true,
                        paymentType: true,
                        transactionId: true,
                        status: true,
                        createdAt: true
                  }
            });
      }

      // 获取订单超时时间
      async getOrderTimeout(orderId: string): Promise<number | null> {
            const cancelOrderKey = `order:${orderId}:auto_cancel`;
            const ttl = await redisClient.ttl(cancelOrderKey);
            return ttl > 0 ? ttl : null;
      }

      // 检查订单访问权限
      async checkOrderAccess(orderId: string, userId: string): Promise<boolean> {
            const count = await prisma.order.count({
                  where: {
                        id: orderId,
                        userId
                  }
            });
            return count > 0;
      }

      // 获取用户地址
      async getAddress(userId: string, addressId: number) {
            const address = await prisma.userAddress.findFirst({
                  where: { id: addressId, userId },
                  select: {
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

            return address;
      }

      // 获取购物车项
      async getCartItems(userId: string, cartItemIds: number[]) {
            const cartItems = await prisma.userCartItem.findMany({
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
            });

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

            return cartItems;
      }

      // 获取SKU信息 - 使用批量查询优化
      async getSKUInfo(cartItems: any[]) {
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
            return skuMap;
      }

      // 验证商品库存
      validateStock(cartItems: any[], skuMap: Map<any, any>) {
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
                  }
            }

            if (insufficientItems.length > 0) {
                  throw new AppError(400, 'fail',
                        `以下商品库存不足: ${JSON.stringify(insufficientItems)}`);
            }
      }

      // 计算订单金额和订单项
      async calculateOrderAmount(cartItems: any[], skuMap: Map<any, any>) {
            let totalAmount = 0;
            const orderItems = [];

            for (const cartItem of cartItems) {
                  const sku = skuMap.get(cartItem.skuId);

                  // 计算商品价格
                  const unitPrice = sku.promotion_price || sku.price;
                  const itemTotalPrice = unitPrice * cartItem.quantity;
                  totalAmount += itemTotalPrice;

                  // 获取SKU规格信息
                  const skuSpecsInfo = sku.sku_specs.map((spec: any) => ({
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
            }

            return { totalAmount, orderItems };
      }

      // 查找适用促销规则
      async findPromotion(totalAmount: number) {
            const now = new Date();
            const promotion = await prisma.promotion.findFirst({
                  where: {
                        isActive: true,
                        startTime: { lte: now },
                        endTime: { gte: now },
                        thresholdAmount: { lte: totalAmount }
                  },
                  orderBy: { thresholdAmount: 'desc' }
            });

            return promotion;
      }

      // 计算折扣金额
      calculateDiscount(totalAmount: number, promotion: any) {
            if (!promotion) return 0;

            let discountAmount = 0;

            if (promotion.type === 'AMOUNT_OFF') {
                  discountAmount = promotion.discountAmount;
            } else if (promotion.type === 'PERCENT_OFF') {
                  discountAmount = Math.floor(totalAmount * (promotion.discountAmount / 100));
            }

            // 确保折扣金额不超过订单总金额
            return Math.min(discountAmount, totalAmount);
      }

      // 创建订单 - 使用事务
      async createOrder(orderData: {
            userId: string;
            orderNo: string;
            addressData: any;
            totalAmount: number;
            discountAmount: number;
            paymentAmount: number;
            promotionId: number | null;
            orderItems: any[];
            remark?: string;
      }) {
            const orderId = uuidv4();

            try {
                  await prisma.$transaction(async (tx) => {
                        // 创建订单基本信息
                        await tx.order.create({
                              data: {
                                    id: orderId,
                                    orderNo: orderData.orderNo,
                                    userId: orderData.userId,
                                    orderStatus: OrderStatus.PENDING_PAYMENT,
                                    paymentStatus: PaymentStatus.UNPAID,
                                    shippingAddress: orderData.addressData,
                                    totalAmount: orderData.totalAmount,
                                    discountAmount: orderData.discountAmount,
                                    promotionId: orderData.promotionId,
                                    paymentAmount: orderData.paymentAmount,
                              }
                        });

                        // 批量创建订单项
                        if (orderData.orderItems.length > 0) {
                              await tx.orderItem.createMany({
                                    data: orderData.orderItems.map(item => ({
                                          orderId,
                                          ...item
                                    }))
                              });
                        }
                  });

                  return orderId;
            } catch (error) {
                  console.error('创建订单记录失败:', error);
                  throw new AppError(500, 'fail', '创建订单失败，请稍后重试');
            }
      }

      // 异步处理库存和购物车
      async processInventoryAndCart(
            orderId: string,
            orderNo: string,
            cartItems: any[],
            skuMap: Map<any, any>,
            cartItemIds: number[]
      ) {
            // 准备库存更新
            const inventoryUpdates = cartItems.map(item => {
                  const sku = skuMap.get(item.skuId);
                  return {
                        skuId: sku.id,
                        quantity: item.quantity,
                        type: StockChangeType.ORDER_LOCK,
                        orderNo
                  };
            });

            // 使用更可靠的分布式锁处理库存锁定
            await Promise.all(inventoryUpdates.map(async (update) => {
                  const lockKey = `inventory:lock:${update.skuId}`;
                  try {
                        // 获取锁
                        const acquired = await this.acquireDistributedLock(lockKey, 5);
                        if (!acquired) {
                              throw new Error('无法获取库存锁');
                        }

                        // 锁定库存
                        await inventoryService.preOccupyInventory(
                              update.skuId,
                              update.quantity,
                              orderNo,
                              600 // 10分钟超时
                        );
                  } finally {
                        // 释放锁
                        await this.releaseDistributedLock(lockKey);
                  }
            }));

            // 删除购物车项
            if (cartItemIds.length > 0) {
                  await prisma.userCartItem.deleteMany({
                        where: { id: { in: cartItemIds } }
                  });
            }

            // 设置订单超时自动取消 - 使用更可靠的机制
            const cancelOrderKey = `order:${orderId}:auto_cancel`;
            await redisClient.setEx(cancelOrderKey, 600, orderNo);

            // 添加到订单取消队列，确保即使Redis出现问题也能取消
            await orderQueue.add('monitorOrderExpiry', {
                  orderId,
                  orderNo,
                  expiryTime: Date.now() + 600000 // 10分钟后
            }, {
                  delay: 600000, // 10分钟后执行
                  attempts: 3,
                  removeOnComplete: true
            });
      }

      // 订单错误处理
      async handleOrderError(orderId: string | undefined, orderNo: string | undefined, error: any) {
            try {
                  // 确保 orderId 存在后再使用
                  if (orderId) {
                        await prisma.order.update({
                              where: { id: orderId },
                              data: { orderStatus: OrderStatus.CANCELLED }
                        });
                  }

                  // 记录错误日志
                  console.error('订单创建失败:', error);
            } catch (e) {
                  console.error('订单错误处理失败:', e);
            }
      }

      // 获取订单列表 - 优化分页查询
      async getOrderList(userId: string, page: number, limit: number, status?: number) {
            const skip = (page - 1) * limit;

            // 构建查询条件
            const where: any = { userId };
            if (status !== undefined) {
                  where.orderStatus = status;
            }

            // 使用计数查询优化分页
            const [total, orders] = await Promise.all([
                  prisma.order.count({ where }),
                  prisma.order.findMany({
                        where,
                        select: {
                              id: true,
                              orderNo: true,
                              orderStatus: true,
                              paymentStatus: true,
                              totalAmount: true,
                              paymentAmount: true,
                              discountAmount: true,
                              createdAt: true,
                              updatedAt: true,
                              shippingAddress: true,
                              orderItems: {
                                    select: {
                                          productName: true,
                                          mainImage: true,
                                          quantity: true,
                                          unitPrice: true
                                    },
                                    take: 5 // 限制最多返回5个订单项
                              }
                        },
                        orderBy: {
                              createdAt: 'desc'
                        },
                        skip,
                        take: limit
                  })
            ]);

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

            return {
                  total,
                  page,
                  limit,
                  data: ordersWithTimeout
            };
      }

      // 处理订单支付
      async processOrderPayment(orderId: string, userId: string, paymentType: string, transactionId: string) {
            // 验证订单
            const order = await prisma.order.findFirst({
                  where: { id: orderId, userId },
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
                  return { orderId: order.id };
            }

            // 检查订单是否已超时
            const cancelOrderKey = `order:${order.id}:auto_cancel`;
            const isOrderValid = await redisClient.exists(cancelOrderKey);

            if (isOrderValid === 0) {
                  throw new AppError(400, 'fail', '订单已超时，请重新下单');
            }

            // 实际支付流程 - 在真实环境中应调用支付网关
            try {
                  // 使用事务保证数据一致性
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

                  // 支付成功后的操作
                  // 删除订单超时任务
                  await redisClient.del(cancelOrderKey);

                  // 从延迟队列中移除自动取消任务
                  await orderQueue.removeJobs(`orderExpiry:${orderId}`);

                  // 设置12小时后自动完成订单
                  const autoCompleteKey = `order:${order.id}:auto_complete`;
                  await redisClient.setEx(autoCompleteKey, 12 * 60 * 60, '1');

                  // 异步处理库存实际扣减
                  await this.processPostPaymentTasks(order);

                  return {
                        orderId: order.id,
                        orderNo: order.orderNo,
                        paymentStatus: PaymentStatus.PAID,
                        orderStatus: OrderStatus.PENDING_SHIPMENT,
                        transactionId
                  };
            } catch (error) {
                  console.error('支付处理失败:', error);
                  throw new AppError(500, 'fail', '支付处理失败，请稍后重试');
            }
      }

      // 支付后的异步任务处理
      async processPostPaymentTasks(order: any) {
            try {
                  // 1. 库存从预占状态转为实际扣减
                  const inventoryTasks = order.orderItems.map((item: any) =>
                        inventoryService.confirmPreOccupied(
                              item.skuId,
                              item.quantity,
                              order.orderNo
                        )
                  );
                  await Promise.all(inventoryTasks);

                  // 2. 更新商品销量
                  const productQuantities: Record<number, number> = {};

                  // 获取产品ID与数量映射
                  for (const item of order.orderItems) {
                        const sku = await prisma.sku.findUnique({
                              where: { id: item.skuId },
                              select: { productId: true }
                        });

                        if (sku?.productId) {
                              productQuantities[sku.productId] = (productQuantities[sku.productId] || 0) + item.quantity;
                        }
                  }

                  // 批量更新产品销量
                  const updatePromises = Object.entries(productQuantities).map(
                        ([productId, quantity]) =>
                              prisma.product.update({
                                    where: { id: parseInt(productId) },
                                    data: { salesCount: { increment: quantity } }
                              })
                  );

                  await Promise.all(updatePromises);
            } catch (error) {
                  // 记录错误但不终止流程，避免影响用户体验
                  console.error('支付后处理任务失败:', error);
            }
      }

      // 取消订单
      async cancelOrder(orderId: string, userId: string) {
            const order = await prisma.order.findFirst({
                  where: {
                        id: orderId,
                        userId,
                        orderStatus: OrderStatus.PENDING_PAYMENT
                  },
                  include: {
                        orderItems: {
                              select: {
                                    skuId: true,
                                    quantity: true
                              }
                        }
                  }
            });

            if (!order) {
                  throw new AppError(404, 'fail', '订单不存在或无法取消');
            }

            // 使用事务确保原子性
            await prisma.$transaction(async (tx) => {
                  // 更新订单状态
                  await tx.order.update({
                        where: { id: orderId },
                        data: { orderStatus: OrderStatus.CANCELLED }
                  });

                  // 释放预占库存
                  for (const item of order.orderItems) {
                        await inventoryService.releasePreOccupied(
                              item.skuId,
                              item.quantity,
                              order.orderNo
                        );
                  }
            });

            // 删除订单超时键
            await redisClient.del(`order:${orderId}:auto_cancel`);

            return { orderId, orderStatus: OrderStatus.CANCELLED };
      }

      // 确认收货
      async confirmOrderReceipt(orderId: string, userId: string) {
            const order = await prisma.order.findFirst({
                  where: {
                        id: orderId,
                        userId,
                        orderStatus: OrderStatus.SHIPPED
                  }
            });

            if (!order) {
                  throw new AppError(404, 'fail', '订单不存在或无法确认收货');
            }

            await prisma.order.update({
                  where: { id: orderId },
                  data: { orderStatus: OrderStatus.COMPLETED }
            });

            return { orderId, orderStatus: OrderStatus.COMPLETED };
      }

      // 快速购买流程
      async executeQuickBuy(
            userId: string,
            productId: number,
            skuId: number,
            quantity: number,
            addressId: number,
            remark?: string
      ) {
            // 幂等性控制
            const idempotencyKey = `order:quick:${userId}:${productId}:${skuId}:${quantity}`;
            const existingOrderId = await redisClient.get(idempotencyKey);

            if (existingOrderId) {
                  const existingOrder = await this.getOrderBasicInfo(existingOrderId);
                  if (existingOrder) {
                        return existingOrder;
                  }
            }

            // 并发控制
            const lockKey = `order:quick:lock:${userId}:${skuId}`;
            const acquired = await this.acquireDistributedLock(lockKey, 10);

            if (!acquired) {
                  throw new AppError(429, 'fail', '订单处理中，请稍后再试');
            }

            try {
                  // 并行获取所需数据
                  const [product, sku, address, orderNo] = await Promise.all([
                        prisma.product.findFirst({
                              where: {
                                    id: productId,
                                    status: ProductStatus.ONLINE
                              },
                              select: {
                                    id: true,
                                    name: true,
                                    mainImage: true,
                                    is_promotion: true
                              }
                        }),
                        prisma.sku.findFirst({
                              where: {
                                    id: skuId,
                                    productId
                              },
                              select: {
                                    id: true,
                                    stock: true,
                                    price: true,
                                    promotion_price: true,
                                    sku_specs: {
                                          include: {
                                                spec: true,
                                                specValue: true
                                          }
                                    }
                              }
                        }),
                        this.getAddress(userId, addressId),
                        this.generateOrderNo()
                  ]);

                  // 验证数据
                  if (!product) {
                        throw new AppError(404, 'fail', '商品不存在或已下架');
                  }

                  if (!sku) {
                        throw new AppError(404, 'fail', '商品规格不存在');
                  }

                  if ((sku.stock || 0) < quantity) {
                        throw new AppError(400, 'fail', '商品库存不足');
                  }

                  // 计算订单金额
                  const unitPrice = sku.promotion_price || sku.price;
                  const totalAmount = unitPrice * quantity;

                  // 查找促销规则
                  const promotion = await this.findPromotion(totalAmount);
                  const discountAmount = this.calculateDiscount(totalAmount, promotion);
                  const paymentAmount = totalAmount - discountAmount;

                  // 准备SKU规格信息
                  const skuSpecsInfo = sku.sku_specs.map(spec => ({
                        specName: spec.spec.name,
                        specValue: spec.specValue.value
                  }));

                  // 创建订单
                  const orderId = uuidv4();

                  await prisma.$transaction(async (tx) => {
                        // 创建订单基本信息
                        await tx.order.create({
                              data: {
                                    id: orderId,
                                    orderNo,
                                    userId,
                                    orderStatus: OrderStatus.PENDING_PAYMENT,
                                    paymentStatus: PaymentStatus.UNPAID,
                                    shippingAddress: address,
                                    totalAmount,
                                    discountAmount,
                                    promotionId: promotion?.id || null,
                                    paymentAmount,
                              }
                        });

                        // 创建订单项
                        await tx.orderItem.create({
                              data: {
                                    orderId,
                                    skuId,
                                    productName: product.name,
                                    mainImage: product.mainImage || '',
                                    skuSpecs: skuSpecsInfo,
                                    quantity,
                                    unitPrice,
                                    totalPrice: totalAmount
                              }
                        });
                  });

                  // 设置幂等键
                  await redisClient.setEx(idempotencyKey, 3600, orderId);

                  // 异步处理库存预占
                  await inventoryService.preOccupyInventory(
                        skuId,
                        quantity,
                        orderNo,
                        600 // 10分钟超时
                  );

                  // 设置订单超时自动取消
                  const cancelOrderKey = `order:${orderId}:auto_cancel`;
                  await redisClient.setEx(cancelOrderKey, 600, orderNo);

                  // 添加到订单取消队列
                  await orderQueue.add('monitorOrderExpiry', {
                        orderId,
                        orderNo,
                        expiryTime: Date.now() + 600000 // 10分钟后
                  }, {
                        delay: 600000, // 10分钟后执行
                        attempts: 3,
                        removeOnComplete: true
                  });

                  return {
                        id: orderId,
                        orderNo,
                        totalAmount,
                        discountAmount,
                        paymentAmount,
                        orderStatus: OrderStatus.PENDING_PAYMENT,
                        paymentStatus: PaymentStatus.UNPAID,
                        createdAt: new Date(),
                        timeoutSeconds: 600,
                        promotion: promotion ? {
                              id: promotion.id,
                              name: promotion.name,
                              type: promotion.type,
                              discountAmount: promotion.discountAmount
                        } : null
                  };
            } finally {
                  // 释放锁
                  await this.releaseDistributedLock(lockKey);
            }
      }

      // 获取可重入分布式锁
      async acquireOrderLock(userId: string, cartItemIds: number[]) {
            const cartItemsKey = cartItemIds.sort().join('_');
            const lockKey = `order:lock:${userId}:${cartItemsKey}`;

            const acquireLock = await redisClient.set(lockKey, '1', {
                  EX: 30, // 30秒锁超时
                  NX: true // 只在键不存在时设置
            });

            if (!acquireLock) {
                  return { success: false, lockKey };
            }

            // 设置锁续期定时器
            const lockExtender = setInterval(async () => {
                  try {
                        // 检查锁是否仍然存在
                        const exists = await redisClient.exists(lockKey);
                        if (exists) {
                              await redisClient.expire(lockKey, 30);
                        } else {
                              // 如果锁不存在了，清除定时器
                              clearInterval(lockExtender);
                        }
                  } catch (error) {
                        console.error('锁续期失败:', error);
                        // 出错时也清除定时器
                        clearInterval(lockExtender);
                  }
            }, 10000); // 每10秒续期一次

            return { success: true, lockKey, lockExtender };
      }

      // 释放订单锁
      async releaseOrderLock(lockKey: string, lockExtender?: NodeJS.Timeout) {
            try {
                  if (lockExtender) {
                        clearInterval(lockExtender);
                  }
                  await redisClient.del(lockKey);
            } catch (error) {
                  console.error('释放锁失败:', error);
                  // 确保定时器被清理
                  if (lockExtender) {
                        clearInterval(lockExtender);
                  }
            }
      }

      // 获取分布式锁
      async acquireDistributedLock(key: string, expirySeconds: number): Promise<boolean> {
            const value = Date.now().toString();
            const acquired = await redisClient.set(key, value, {
                  EX: expirySeconds,
                  NX: true
            });
            return !!acquired;
      }

      // 释放分布式锁
      async releaseDistributedLock(key: string): Promise<void> {
            await redisClient.del(key);
      }
}

export const orderService = new OrderService();