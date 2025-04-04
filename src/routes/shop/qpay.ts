// src/routes/shop/qpay.ts
import { Router } from 'express';
import { qpayController } from '../../controllers/shop/qpay.controller';
import { validateRequest } from '../../middlewares/validateResult';
import {
      createQPaySchema,
      checkPaymentStatusSchema,
      qpayCallbackSchema
} from '../../validators/shop/qpay.validator';
import { shopAuthMiddleware } from '../../middlewares/shopAuth.middleware';

const router = Router();

// 对callback以外的所有路由应用认证中间件
router.use(/^(?!.*\/callback).+$/, shopAuthMiddleware);

// 创建QPay支付
router.post(
      '/create',
      validateRequest(createQPaySchema),
      qpayController.createPayment
);

// 检查支付状态
router.get(
      '/status/:orderId',
      validateRequest(checkPaymentStatusSchema),
      qpayController.checkPaymentStatus
);

// QPay回调端点 - 必须公开访问
router.get(
      '/callback',
      validateRequest(qpayCallbackSchema),
      qpayController.handleCallback
);

export default router;