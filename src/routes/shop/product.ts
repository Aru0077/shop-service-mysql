// src/routes/shop/product.ts
import { Router } from 'express';
import { productController } from '../../controllers/shop/product.controller';
import { validateRequest } from '../../middlewares/validateResult';
import {
      paginationSchema,
      categoryProductsSchema,
      productDetailSchema
} from '../../validators/shop/product.validator';

const router = Router();

// 获取分类树
router.get('/categories/tree', productController.getCategoryTree);

// 获取最新上架商品
router.get(
      '/latest',
      validateRequest(paginationSchema),
      productController.getLatestProducts
);

// 获取销量最高商品
router.get(
      '/top-selling',
      validateRequest(paginationSchema),
      productController.getTopSellingProducts
);

// 获取首页数据路由
router.get('/home-data', productController.getHomePageData);

// 分页获取促销商品
router.get(
      '/promotion',
      validateRequest(paginationSchema),
      productController.getPromotionProducts
);

// 分页获取分类下的商品
router.get(
      '/category/:categoryId',
      validateRequest(categoryProductsSchema),
      productController.getCategoryProducts
);

// 获取商品详情
router.get(
      '/:id',
      validateRequest(productDetailSchema),
      productController.getProductDetail
);

export default router;