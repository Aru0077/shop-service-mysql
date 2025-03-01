// src/routes/shop/index.ts
import { Router } from 'express';
import userRoutes from './user';
import productRoutes from './product';

const router = Router();

// 用户相关路由
router.use('/user', userRoutes);

// 商品相关路由
router.use('/products', productRoutes);

export default router;