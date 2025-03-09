// src/routes/admin/promotion.routes.ts
import { Router } from 'express';
import { promotionController } from '../../controllers/admin/promotion.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { authMiddleware } from '../../middlewares/auth.middleware';
import {
  createPromotionSchema,
  updatePromotionSchema,
  getPromotionListSchema,
  getPromotionDetailSchema,
  deletePromotionSchema,
  togglePromotionStatusSchema
} from '../../validators/admin/promotion.validator';

const router = Router();

// 所有路由都需要管理员认证
router.use(authMiddleware);

// 创建满减规则
router.post(
  '/',
  validateRequest(createPromotionSchema),
  promotionController.create
);

// 获取满减规则列表
router.get(
  '/',
  validateRequest(getPromotionListSchema),
  promotionController.getList
);

// 获取单个满减规则
router.get(
  '/:id',
  validateRequest(getPromotionDetailSchema),
  promotionController.getDetail
);

// 更新满减规则
router.put(
  '/:id',
  validateRequest(updatePromotionSchema),
  promotionController.update
);

// 删除满减规则
router.delete(
  '/:id',
  validateRequest(deletePromotionSchema),
  promotionController.delete
);

// 启用/禁用满减规则
router.patch(
  '/:id/status',
  validateRequest(togglePromotionStatusSchema),
  promotionController.toggleStatus
);

export default router;