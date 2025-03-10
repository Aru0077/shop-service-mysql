// src/controllers/shop/order.controller.ts
import { Request, Response } from 'express';
import { prisma, redisClient } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { OrderStatus, PaymentStatus } from '../../constants/orderStatus.enum';
import { orderService } from '../../services/order.service';
import { inventoryService } from '../../services/inventory.service';
import { cacheUtils } from '../../utils/cache.utils';


interface OrderCalculationResult {
      totalAmount: number;
      orderItems: Array<{
            skuId: number;
            productName: string;
            mainImage: string;
            skuSpecs: any[];
            quantity: number;
            unitPrice: number;
            totalPrice: number;
      }>;
}


export const orderController = {
      // 创建订单
      createOrder: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { addressId, cartItemIds, remark } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 幂等性控制
            const idempotencyKey = await orderService.getIdempotencyKey(userId, cartItemIds);
            const existingOrderId = await redisClient.get(idempotencyKey);

            if (existingOrderId) {
                  const existingOrder = await orderService.getOrderBasicInfo(existingOrderId);
                  if (existingOrder) {
                        return res.sendSuccess(existingOrder, '订单已存在，请勿重复提交');
                  }
            }

            // 并发控制 - 使用可重入锁
            const lockResult = await orderService.acquireOrderLock(userId, cartItemIds);
            if (!lockResult.success) {
                  throw new AppError(429, 'fail', '订单处理中，请稍后再试');
            }

            try {
                  // 并行执行数据获取和验证
                  const [address, cartItems, orderNo] = await Promise.all([
                        orderService.getAddress(userId, addressId),
                        orderService.getCartItems(userId, cartItemIds),
                        orderService.generateOrderNo(),
                  ]);

                  // 获取SKU信息和验证库存
                  const skuMap = await orderService.getSKUInfo(cartItems);
                  orderService.validateStock(cartItems, skuMap);

                  // 并行执行订单金额计算和促销规则查询
                  const [orderData, promotion] = await Promise.all([
                        orderService.calculateOrderAmount(cartItems, skuMap),
                        orderService.findPromotion(orderData.totalAmount),
                  ]);

                  // 计算折扣和最终支付金额
                  const discountAmount = orderService.calculateDiscount(orderData.totalAmount, promotion);
                  const paymentAmount = orderData.totalAmount - discountAmount;

                  // 创建订单记录
                  const orderId = await orderService.createOrder({
                        userId,
                        orderNo,
                        addressData: address,
                        totalAmount: orderData.totalAmount,
                        discountAmount,
                        paymentAmount,
                        promotionId: promotion?.id || null,
                        orderItems: orderData.orderItems,
                        remark
                  });

                  // 设置幂等键
                  await redisClient.setEx(idempotencyKey, 3600, orderId);

                  // 异步处理库存锁定和购物车清理
                  await orderService.processInventoryAndCart(orderId, orderNo, cartItems, skuMap, cartItemIds);

                  // 返回订单信息
                  res.sendSuccess({
                        id: orderId,
                        orderNo,
                        totalAmount: orderData.totalAmount,
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
                  }, '订单创建成功，请在10分钟内完成支付');
            } catch (error) {
                  // 发生错误时自动回滚
                  await orderService.handleOrderError(orderId, orderNo, error);
                  throw error;
            } finally {
                  // 释放并发锁
                  await orderService.releaseOrderLock(lockResult.lockKey);
            }
      }),

      // 直接购买商品
      quickBuy: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { productId, skuId, quantity, addressId, remark } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 使用优化后的订单服务执行快速购买
            const result = await orderService.executeQuickBuy(
                  userId,
                  productId,
                  skuId,
                  quantity,
                  addressId,
                  remark
            );

            res.sendSuccess(result, '订单创建成功，请在10分钟内完成支付');
      }),

      // 获取订单列表 - 使用缓存和数据库优化
      getOrderList: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { page = '1', limit = '10', status } = req.query;
            const pageNumber = parseInt(page as string);
            const limitNumber = parseInt(limit as string);

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 使用缓存获取订单列表
            const cacheKey = `orders:${userId}:${status || 'all'}:${page}:${limit}`;

            const orderListData = await cacheUtils.multiLevelCache(cacheKey, async () => {
                  return await orderService.getOrderList(userId, pageNumber, limitNumber, status ? parseInt(status as string) : undefined);
            }, 60); // 60秒缓存，订单数据变化频繁

            res.sendSuccess(orderListData);
      }),

      // 获取订单详情 - 分离查询与减少连接
      getOrderDetail: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 检查订单是否属于当前用户
            const hasAccess = await orderService.checkOrderAccess(id, userId);
            if (!hasAccess) {
                  throw new AppError(403, 'fail', '无权访问此订单');
            }

            // 并行获取订单数据
            const [orderBasic, orderItems, paymentLogs, timeoutSeconds] = await Promise.all([
                  orderService.getOrderBasicInfo(id),
                  orderService.getOrderItems(id),
                  orderService.getOrderPayments(id),
                  orderService.getOrderTimeout(id)
            ]);

            if (!orderBasic) {
                  throw new AppError(404, 'fail', '订单不存在');
            }

            // 返回组合后的数据
            res.sendSuccess({
                  ...orderBasic,
                  timeoutSeconds,
                  orderItems,
                  paymentLogs
            });
      }),

      // 支付订单 - 改进并发控制和事务处理
      payOrder: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;
            const { paymentType, transactionId = orderService.generateTransactionId() } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 幂等性控制
            const paymentKey = `payment:${id}:${transactionId}`;
            const hasProcessed = await redisClient.exists(paymentKey);
            if (hasProcessed) {
                  return res.sendSuccess({ orderId: id, status: 'processed' }, '订单已处理，请勿重复支付');
            }

            // 获取分布式锁
            const lockKey = `order:pay:lock:${id}`;
            const lockAcquired = await orderService.acquireDistributedLock(lockKey, 30);
            if (!lockAcquired) {
                  throw new AppError(429, 'fail', '订单正在处理中，请稍后再试');
            }

            try {
                  // 验证订单状态
                  const paymentResult = await orderService.processOrderPayment(id, userId, paymentType, transactionId);

                  // 设置幂等键
                  await redisClient.setEx(paymentKey, 86400, '1'); // 24小时有效期

                  res.sendSuccess(paymentResult, '订单支付成功');
            } finally {
                  // 释放锁
                  await orderService.releaseDistributedLock(lockKey);
            }
      }),

      // 取消订单
      cancelOrder: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            const result = await orderService.cancelOrder(id, userId);
            res.sendSuccess(result, '订单取消成功');
      }),

      // 确认收货
      confirmReceipt: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            const result = await orderService.confirmOrderReceipt(id, userId);
            res.sendSuccess(result, '确认收货成功');
      })
};