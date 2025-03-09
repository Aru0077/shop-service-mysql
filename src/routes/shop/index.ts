// src/routes/shop/index.ts
import { Router } from 'express';
import userRoutes from './user';
import productRoutes from './product';
import favoriteRoutes from './favorite';
import addressRoutes from './address';
import cartRoutes from './cart';
import orderRoutes from './order';
import promotionRoutes from './promotion';

const router = Router();

// 用户相关路由
router.use('/user', userRoutes);

// 商品相关路由
router.use('/products', productRoutes);

// 收藏相关路由
router.use('/favorites', favoriteRoutes);

// 地址相关路由
router.use('/addresses', addressRoutes);

// 购物车相关路由
router.use('/cart', cartRoutes);

// 订单相关路由
router.use('/orders', orderRoutes);

// 满减规则路由
router.use('/promotions', promotionRoutes);

export default router;