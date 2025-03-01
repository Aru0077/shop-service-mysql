// src/routes/shop/cart.ts
import { Router } from 'express';
import { cartController } from '../../controllers/shop/cart.controller';
import { validateRequest } from '../../middlewares/validateResult';
import {
      addCartItemSchema,
      updateCartItemSchema,
      deleteCartItemSchema,
      getCartListSchema,
} from '../../validators/shop/cart.validator';
import { shopAuthMiddleware } from '../../middlewares/shopAuth.middleware';

const router = Router();

// 所有购物车路由都需要用户认证
router.use(shopAuthMiddleware);

// 添加商品到购物车
router.post(
      '/',
      validateRequest(addCartItemSchema),
      cartController.addToCart
);

// 更新购物车商品数量
router.put(
      '/:id',
      validateRequest(updateCartItemSchema),
      cartController.updateCartItem
);

// 删除购物车商品
router.delete(
      '/:id',
      validateRequest(deleteCartItemSchema),
      cartController.deleteCartItem
);

// 获取购物车列表
router.get(
      '/',
      validateRequest(getCartListSchema),
      cartController.getCartList
);

// 清空购物车
router.delete(
      '/clear',
      cartController.clearCart
);


export default router;