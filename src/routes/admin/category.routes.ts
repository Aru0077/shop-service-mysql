// src/routes/category.routes.ts
import { Router } from 'express';
import { categoryController } from '../../controllers/admin/category.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { authMiddleware, superAdminMiddleware } from '../../middlewares/auth.middleware';
import {
    createCategorySchema,
    updateCategorySchema,
    deleteCategorySchema
} from '../../validators/admin/category.validator';

const router = Router();

// 所有路由都需要认证和超级管理员权限
router.use(authMiddleware, superAdminMiddleware);

// 创建分类
router.post(
    '/',
    validateRequest(createCategorySchema),
    categoryController.create
);

// 更新分类
router.put(
    '/:id',
    validateRequest(updateCategorySchema),
    categoryController.update
);

// 删除分类
router.delete(
    '/:id',
    validateRequest(deleteCategorySchema),
    categoryController.delete
);

// 获取分类树
router.get('/tree', categoryController.getTree);

export default router;