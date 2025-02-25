// src/routes/admin/sku.route.ts
import { Router } from 'express';
import { skuController } from '../../controllers/admin/sku.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { authMiddleware } from '../../middlewares/auth.middleware';
import {
    createSkusSchema,
    updateStockSchema,
    updatePricesSchema,
    updatePromotionPricesSchema,
    getSkuListSchema,
    cancelPromotionSchema
} from '../../validators/admin/sku.validator';

const router = Router();

// 所有路由都需要认证
router.use(authMiddleware);

// 新增SKU基础信息
router.post(
    '/:productId/skus',
    validateRequest(createSkusSchema),
    skuController.createSkus
);

// 批量设置SKU价格
router.put(
    '/:productId/skus/prices',
    validateRequest(updatePricesSchema),
    skuController.updatePrices
);

// 批量设置SKU库存
router.put(
    '/:productId/skus/stock',
    validateRequest(updateStockSchema),
    skuController.updateStock
);

// 批量设置SKU促销价
router.put(
    '/:productId/skus/promotion-prices',
    validateRequest(updatePromotionPricesSchema),
    skuController.updatePromotionPrices
);

// 获取商品SKU列表
router.get(
    '/:productId/skus',
    validateRequest(getSkuListSchema),
    skuController.getSkuList
);

// 取消商品促销
router.post(
    '/:productId/skus/cancel-promotion',
    validateRequest(cancelPromotionSchema),
    skuController.cancelPromotion
);

export default router;