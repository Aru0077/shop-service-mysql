// src/routes/shop/order.ts
import { Router } from 'express';
import { orderController } from '../../controllers/shop/order.controller';
import { validateRequest } from '../../middlewares/validateResult';
import {
      createOrderSchema,
      getOrderListSchema,
      getOrderDetailSchema,
      payOrderSchema,
      quickBuySchema,
      cancelOrderSchema,
      confirmReceiptSchema,
} from '../../validators/shop/order.validator';
import { shopAuthMiddleware } from '../../middlewares/shopAuth.middleware';

const router = Router();

// 所有订单路由都需要用户认证
router.use(shopAuthMiddleware);

// 创建订单
router.post(
      '/',
      validateRequest(createOrderSchema),
      orderController.createOrder
);

router.post(
      '/quick-buy',
      validateRequest(quickBuySchema),
      orderController.quickBuy
);

// 获取订单列表
router.get(
      '/',
      validateRequest(getOrderListSchema),
      orderController.getOrderList
);

// 获取订单详情
router.get(
      '/:id',
      validateRequest(getOrderDetailSchema),
      orderController.getOrderDetail
);

// 支付订单
router.post(
      '/:id/pay',
      validateRequest(payOrderSchema),
      orderController.payOrder
);

// 取消订单
router.post(
      '/:id/cancel', 
      validateRequest(cancelOrderSchema), 
      orderController.cancelOrder
);

// 确认收货
router.post(
      '/:id/confirm', 
      validateRequest(confirmReceiptSchema), 
      orderController.confirmReceipt
);

export default router;