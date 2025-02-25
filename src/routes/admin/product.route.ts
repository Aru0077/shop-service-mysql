// src/routes/admin/product.route.ts
import { Router } from 'express';
import { productController } from '../../controllers/admin/product.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { authMiddleware } from '../../middlewares/auth.middleware';
import {
    createProductSchema,
    updateProductSchema,
    updateStatusSchema,
    getListSchema, 
    getStockLogsSchema,
} from '../../validators/admin/product.validator';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Create product
router.post(
    '/',
    validateRequest(createProductSchema),
    productController.create
);

// Update product
router.put(
    '/:id',
    validateRequest(updateProductSchema),
    productController.update
);

// Update product status
router.patch(
    '/:id/status',
    validateRequest(updateStatusSchema),
    productController.updateStatus
);

// Get product list with filters and sorting
router.get(
    '/',
    validateRequest(getListSchema),
    productController.getList
);

// Get product statistics
router.get('/stats', productController.getStats);

// 获取商品库存记录
router.get(
    '/:id/stock-logs',
    validateRequest(getStockLogsSchema),
    productController.getStockLogs
);


export default router;