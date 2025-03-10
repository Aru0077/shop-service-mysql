// src/services/order.service.ts
import { prisma, redisClient } from '../config';
import { AppError } from '../utils/http.utils';
import { OrderStatus, PaymentStatus } from '../constants/orderStatus.enum';
import { ProductStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { orderQueue } from '../queues/order.queue';
import { StockChangeType } from '../constants/stock.constants';

// 订单数据接口
interface OrderData {
      id: string;
      orderNo: string;
      userId: string;
      addressData: any;
      totalAmount: number;
      discountAmount: number;
      paymentAmount: number;
      promotionId?: number | null;
      orderItems: any[];
}

// 订单服务类
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

      // 获取SKU信息
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

      // 计算订单金额
      calculateOrderAmount(cartItems: any[], skuMap: Map<any, any>) {
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

      // 创建订单记录
      async createOrderRecord(orderData: OrderData) {
            try {
                  await prisma.$transaction(async (tx) => {
                        // 创建订单基本信息
                        await tx.order.create({
                              data: {
                                    id: orderData.id,
                                    orderNo: orderData.orderNo,
                                    userId: orderData.userId,
                                    orderStatus: OrderStatus.PENDING_PAYMENT,
                                    paymentStatus: PaymentStatus.UNPAID,
                                    shippingAddress: orderData.addressData,
                                    totalAmount: orderData.totalAmount,
                                    discountAmount: orderData.discountAmount,
                                    promotionId: orderData.promotionId,
                                    paymentAmount: orderData.paymentAmount
                              }
                        });

                        // 创建订单项
                        if (orderData.orderItems.length <= 5) {
                              await tx.orderItem.createMany({
                                    data: orderData.orderItems.map(item => ({
                                          orderId: orderData.id,
                                          ...item
                                    }))
                              });
                        }
                  });

                  return true;
            } catch (error) {
                  console.error('创建订单记录失败:', error);
                  throw new AppError(500, 'fail', '创建订单失败，请稍后重试');
            }
      }

      // 准备库存更新
      prepareInventoryUpdates(cartItems: any[], skuMap: Map<any, any>) {
            return cartItems.map(item => {
                  const sku = skuMap.get(item.skuId);
                  return {
                        skuId: sku.id,
                        quantity: item.quantity,
                        productId: sku.productId,
                        productName: item.product.name
                  };
            });
      }

      // 处理订单后续任务
      async processOrderAfterCreation(
            orderId: string,
            orderNo: string,
            orderItems: any[],
            inventoryUpdates: any[],
            cartItemIds: number[]
      ) {
            try {
                  // 添加订单处理任务到队列
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

                  // 设置订单超时自动取消
                  const cancelOrderKey = `order:${orderId}:auto_cancel`;
                  await redisClient.setEx(cancelOrderKey, 600, '1');

                  return true;
            } catch (error) {
                  console.error('处理订单后续任务失败:', error);
                  throw error;
            }
      }

      // 批量更新库存（用于库存服务）
      async batchUpdateInventory(updates: Array<{ skuId: number, quantity: number, type: StockChangeType, orderNo: string }>) {
            // 按SKU ID对更新进行分组
            const updatesBySkuId = new Map();

            for (const update of updates) {
                  if (!updatesBySkuId.has(update.skuId)) {
                        updatesBySkuId.set(update.skuId, {
                              totalQuantity: 0,
                              details: []
                        });
                  }

                  const entry = updatesBySkuId.get(update.skuId);
                  entry.totalQuantity += update.quantity;
                  entry.details.push(update);
            }

            // 批量处理库存更新
            await prisma.$transaction(async (tx) => {
                  for (const [skuId, data] of updatesBySkuId.entries()) {
                        const { totalQuantity, details } = data;

                        // 一次性更新SKU库存
                        const sku = await tx.sku.update({
                              where: { id: skuId },
                              data: { stock: { decrement: Math.abs(totalQuantity) } },
                              select: { id: true, stock: true }
                        });

                        // 批量创建库存日志
                        await tx.stockLog.createMany({
                              data: details.map((detail: { quantity: any; type: any; orderNo: any; }) => ({
                                    skuId,
                                    changeQuantity: detail.quantity,
                                    currentStock: sku.stock,
                                    type: detail.type,
                                    orderNo: detail.orderNo,
                                    remark: `批量库存更新`,
                                    operator: 'system'
                              }))
                        });
                  }
            });

            return true;
      }
}

export const orderService = new OrderService();