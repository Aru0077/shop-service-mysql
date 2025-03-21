// src/routes/shop/qpay.ts
import { Router } from 'express';
import { qpayController } from '../../controllers/shop/qpay.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { shopAuthMiddleware } from '../../middlewares/shopAuth.middleware';
import { createQPayPaymentSchema, checkQPayStatusSchema } from '../../validators/shop/qpay.validator';

const router = Router();

// 需要认证的路由
router.use('/create', shopAuthMiddleware);
router.use('/status', shopAuthMiddleware);

// 创建QPay支付
router.post(
      '/create',
      validateRequest(createQPayPaymentSchema),
      qpayController.createPayment
);

// 检查支付状态
router.get(
      '/status/:orderId',
      validateRequest(checkQPayStatusSchema),
      qpayController.checkPaymentStatus
);

// 处理QPay回调 - 公开路由，不需要认证
router.get(
      '/callback',
      qpayController.handleCallback
);

export default router;