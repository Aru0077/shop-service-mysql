// src/routes/shop/temp-order.ts
import { Router } from 'express';
import { tempOrderController } from '../../controllers/shop/temp-order.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { 
    createTempOrderSchema, 
    updateTempOrderSchema, 
    confirmTempOrderSchema,
    getTempOrderSchema,
    refreshTempOrderSchema,
    updateAndConfirmTempOrderSchema
} from '../../validators/shop/temp-order.validator';
import { shopAuthMiddleware } from '../../middlewares/shopAuth.middleware';

const router = Router();

// 所有临时订单路由都需要用户认证
router.use(shopAuthMiddleware);

// 创建临时订单
router.post(
    '/',
    validateRequest(createTempOrderSchema),
    tempOrderController.createTempOrder
);

// 获取临时订单
router.get(
    '/:id',
    validateRequest(getTempOrderSchema),
    tempOrderController.getTempOrder
);

// 更新临时订单
router.put(
    '/:id',
    validateRequest(updateTempOrderSchema),
    tempOrderController.updateTempOrder
);

// 确认临时订单并创建正式订单
router.post(
    '/:id/confirm',
    validateRequest(confirmTempOrderSchema),
    tempOrderController.confirmTempOrder
);

// 更新并确认临时订单（一步操作）
router.post(
    '/:id/update-confirm',
    validateRequest(updateAndConfirmTempOrderSchema),
    tempOrderController.updateAndConfirmTempOrder
);

// 刷新临时订单有效期
router.post(
    '/:id/refresh',
    validateRequest(refreshTempOrderSchema),
    tempOrderController.refreshTempOrder
);

export default router;