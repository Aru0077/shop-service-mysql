// src/routes/admin/order.routes.ts
import { Router } from 'express';
import { orderController } from '../../controllers/admin/order.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { authMiddleware } from '../../middlewares/auth.middleware';
import {
    getOrdersSchema,
    getOrderDetailSchema,
    updateOrderStatusSchema
} from '../../validators/admin/order.validator';

const router = Router();

// 所有路由都需要管理员认证
router.use(authMiddleware);

// 获取订单列表
router.get(
    '/',
    validateRequest(getOrdersSchema),
    orderController.getOrders
);

// 获取订单详情
router.get(
    '/:id',
    validateRequest(getOrderDetailSchema),
    orderController.getOrderDetail
);

// 更新订单状态（特别是发货）
router.put(
    '/:id/status',
    validateRequest(updateOrderStatusSchema),
    orderController.updateOrderStatus
);

export default router;