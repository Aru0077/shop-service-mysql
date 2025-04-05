// src/controllers/shop/qpay.controller.ts
import { Request, Response } from 'express';
import { asyncHandler, AppError } from '../../utils/http.utils';
import { qpayService } from '../../services/qpay.service';
import { logger } from '../../utils/logger';
import { prisma } from '../../config';

export const qpayController = {
      /**
       * 为订单创建QPay支付
       */
      createPayment: asyncHandler(async (req: Request, res: Response) => {
            const { orderId } = req.body;
            const userId = req.shopUser?.id;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 验证订单是否属于当前用户
            const order = await prisma.order.findFirst({
                  where: {
                        id: orderId,
                        userId
                  }
            });

            if (!order) {
                  throw new AppError(404, 'fail', '订单不存在');
            }

            // 创建QPay发票
            const invoiceData = await qpayService.createInvoice(orderId);

            res.sendSuccess(invoiceData, '支付链接创建成功');
      }),

      /**
       * 检查订单的支付状态
       */
      checkPaymentStatus: asyncHandler(async (req: Request, res: Response) => {
            const { orderId } = req.params;
            const userId = req.shopUser?.id;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 验证订单是否属于当前用户
            const order = await prisma.order.findFirst({
                  where: {
                        id: orderId,
                        userId
                  }
            });

            if (!order) {
                  throw new AppError(404, 'fail', '订单不存在');
            }

            // 检查支付状态
            const paymentStatus = await qpayService.checkPaymentStatus(orderId);

            res.sendSuccess(paymentStatus);
      }),

      /**
       * 处理QPay支付回调
       * 注意：必须返回HTTP状态码200和SUCCESS消息
       */
      handleCallback: asyncHandler(async (req: Request, res: Response) => {
            try {
                  const orderId = req.query.order_id as string;
                  const callbackData = req.body;

                  logger.info('QPay回调内容', { orderId, callbackData });

                  if (!orderId) {
                        logger.error('QPay回调缺少order_id参数', { query: req.query });
                        return res.status(200).send('SUCCESS'); // 仍然返回成功以确认收到
                  }

                  // 提取支付ID
                  const paymentId = callbackData?.payment_id || callbackData?.objectId || 'unknown';

                  // 异步处理回调以快速响应
                  setTimeout(async () => {
                        try {
                              await qpayService.processCallback(orderId, paymentId, callbackData);
                              logger.info('QPay回调处理成功', { orderId, paymentId });
                        } catch (error) {
                              logger.error('QPay回调处理失败', {
                                    error: error instanceof Error ? error.message : 'Unknown error',
                                    orderId,
                                    paymentId
                              });
                        }
                  }, 0);

                  // 立即以SUCCESS响应，这是QPay要求的
                  return res.status(200).send('SUCCESS');
            } catch (error) {
                  logger.error('处理QPay回调时发生错误', {
                        error: error instanceof Error ? error.message : 'Unknown error'
                  });
                  // 始终返回成功以避免重试
                  return res.status(200).send('SUCCESS');
            }
      })
};