// src/routes/shop/promotion.ts
import { Router } from 'express';
import { promotionController } from '../../controllers/shop/promotion.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { checkEligiblePromotionSchema } from '../../validators/shop/promotion.validator';

const router = Router();

// 获取当前可用的满减规则
router.get('/', promotionController.getAvailablePromotions);

// 检查特定金额可用的满减规则
router.get(
  '/check',
  validateRequest(checkEligiblePromotionSchema),
  promotionController.checkEligiblePromotion
);

export default router;