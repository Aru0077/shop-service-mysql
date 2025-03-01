// s// src/routes/shop/favorite.ts
import { Router } from 'express';
import { favoriteController } from '../../controllers/shop/favorite.controller';
import { validateRequest } from '../../middlewares/validateResult';
import {
      addFavoriteSchema,
      removeFavoriteSchema,
      batchRemoveFavoritesSchema,
      getFavoritesSchema
} from '../../validators/shop/favorite.validator';
import { shopAuthMiddleware } from '../../middlewares/shopAuth.middleware';

const router = Router();

// 所有收藏路由都需要认证
router.use(shopAuthMiddleware);

// 收藏商品
router.post(
      '/',
      validateRequest(addFavoriteSchema),
      favoriteController.addFavorite
);

// 取消收藏
router.delete(
      '/:productId',
      validateRequest(removeFavoriteSchema),
      favoriteController.removeFavorite
);

// 批量取消收藏
router.post(
      '/batch-remove',
      validateRequest(batchRemoveFavoritesSchema),
      favoriteController.batchRemoveFavorites
);

// 获取收藏列表
router.get(
      '/',
      validateRequest(getFavoritesSchema),
      favoriteController.getFavorites
);

export default router;