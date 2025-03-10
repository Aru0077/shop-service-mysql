// src/routes/shop/checkout.ts
import { Router } from 'express';
import { checkoutController } from '../../controllers/shop/checkout.controller';
import { shopAuthMiddleware } from '../../middlewares/shopAuth.middleware';

const router = Router();

// 所有结算路由都需要用户认证
router.use(shopAuthMiddleware);

// 获取结算页面所需信息
router.get('/info', checkoutController.getCheckoutInfo);

export default router;