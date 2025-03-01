// src/routes/index.ts  // 总路由
import { Router } from 'express';
import adminRoutes from './admin'
import shopRoutes from './shop'

const router = Router();

// 管理系统路由
router.use('/admin', adminRoutes )

// 购物网站路由
router.use('/shop', shopRoutes)


export default router;