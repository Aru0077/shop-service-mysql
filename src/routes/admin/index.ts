// src/routes/index.ts   管理系统路由
import { Router } from 'express';
import adminUserRoutes from './adminUser.routes'
import categoryRoutes from './category.routes'
import imageRoutes from './image.route'
import bannerRoutes from './banner.routes'
import specRoutes from './spec.routes'
import productRoutes from './product.route'
import skuRoutes from './sku.route'
import userRoutes from './user.routes'
import orderRoutes from './order.routes'
import statisticsRoutes from './statistics.routes'
import promotionRoutes from './promotion.routes' // 新增

const router = Router();

// 管理员路由
router.use('/admin-user', adminUserRoutes)

// 分类路由
router.use('/categories', categoryRoutes)

// 图片相关
router.use('/images', imageRoutes)

// banner
router.use('/banner' , bannerRoutes)

// 规格相关
router.use('/specs', specRoutes)

// 商品相关
router.use('/products', productRoutes)

// 设置商品sku
router.use('/skus', skuRoutes)

// 用户管理路由
router.use('/users', userRoutes)

// 订单管理路由
router.use('/orders', orderRoutes) 

// 数据统计路由
router.use('/statistics', statisticsRoutes)

// 添加满减规则路由
router.use('/promotions', promotionRoutes)



export default router;