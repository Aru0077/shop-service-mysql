// src/routes/shop/index.ts
import { Router } from 'express';
import userRoutes from './user';
import productRoutes from './product';
import favoriteRoutes from './favorite';
import addressRoutes from './address';

const router = Router();

// 用户相关路由
router.use('/user', userRoutes);

// 商品相关路由
router.use('/products', productRoutes);

// 收藏相关路由
router.use('/favorites', favoriteRoutes);

// 地址相关路由
router.use('/addresses', addressRoutes);

export default router;