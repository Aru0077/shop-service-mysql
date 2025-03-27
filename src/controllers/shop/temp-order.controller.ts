// src/controllers/shop/temp-order.controller.ts
import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { tempOrderService } from '../../services/temp-order.service';
import { cacheUtils } from '../../utils/cache.utils';

export const tempOrderController = {
      // 获取结账页面所需的所有信息（从 checkout.controller.ts 移过来）
      getCheckoutInfo: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 使用 tempOrderService 获取结账信息
            const checkoutInfo = await tempOrderService.getCheckoutInfo(userId);
            res.sendSuccess(checkoutInfo);
      }),

      // 创建临时订单
      createTempOrder: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { mode, cartItemIds, productInfo } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 添加限流控制
            const rateKey = `rate:temp_order:create:${userId}`;
            const allowed = await cacheUtils.rateLimit(rateKey, 5, 60); // 每分钟最多5次请求
            if (!allowed) {
                  throw new AppError(429, 'fail', '请求过于频繁，请稍后再试');
            }

            // 创建临时订单
            const tempOrder = await tempOrderService.createTempOrder(
                  userId,
                  mode,
                  cartItemIds,
                  productInfo
            );

            res.sendSuccess(tempOrder, '临时订单创建成功');
      }),

      // 获取临时订单详情
      getTempOrder: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 获取临时订单
            const tempOrder = await tempOrderService.getTempOrder(id, userId);

            // 检查订单是否过期
            if (new Date(tempOrder.expireTime) < new Date()) {
                  throw new AppError(400, 'fail', '临时订单已过期，请重新下单');
            }

            res.sendSuccess(tempOrder);
      }),

      // 更新临时订单
      updateTempOrder: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;
            const { addressId, paymentType, remark } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 验证临时订单并更新
            const updatedOrder = await tempOrderService.updateTempOrder(
                  id,
                  userId,
                  { addressId, paymentType, remark }
            );

            res.sendSuccess(updatedOrder, '临时订单更新成功');
      }),

      // 确认临时订单并创建正式订单
      confirmTempOrder: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 添加幂等控制
            const idempotencyKey = `confirm_temp_order:${id}:${userId}`;
            const existingOrderId = await cacheUtils.getOrSet(idempotencyKey, async () => null, 600);

            if (existingOrderId) {
                  throw new AppError(400, 'fail', '此临时订单已被处理，请勿重复操作');
            }

            // 从临时订单创建正式订单
            const order = await tempOrderService.createOrderFromTemp(id, userId);

            // 设置幂等键，防止重复提交
            await cacheUtils.getOrSet(idempotencyKey, async () => order.id, 3600);

            res.sendSuccess(order, '订单创建成功，请在10分钟内完成支付');
      }),

      // 更新并确认临时订单（一步操作）
      updateAndConfirmTempOrder: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;
            const { addressId, paymentType, remark } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 添加幂等控制
            const idempotencyKey = `confirm_temp_order:${id}:${userId}`;
            const existingOrderId = await cacheUtils.getOrSet(idempotencyKey, async () => null, 600);

            if (existingOrderId) {
                  throw new AppError(400, 'fail', '此临时订单已被处理，请勿重复操作');
            }

            // 一步完成更新和确认
            const order = await tempOrderService.updateAndConfirmTempOrder(
                  id,
                  userId,
                  { addressId, paymentType, remark }
            );

            // 设置幂等键，防止重复提交
            await cacheUtils.getOrSet(idempotencyKey, async () => order.id, 3600);

            res.sendSuccess(order, '订单创建成功，请在10分钟内完成支付');
      }),

      // 扩展：刷新临时订单有效期
      refreshTempOrder: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 刷新临时订单有效期
            const refreshedOrder = await tempOrderService.refreshTempOrder(id, userId);

            res.sendSuccess(refreshedOrder, '临时订单有效期已刷新');
      })
};