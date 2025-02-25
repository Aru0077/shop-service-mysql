// src/routes/admin.routes.ts
import { Router } from 'express';
import {
    login,
    createAdmin,
    updateAdminStatus,
    resetPassword,
    deleteAdmin,
    getAdminList,
    logout,
} from '../../controllers/admin/adminUser.controller';
import { authMiddleware, superAdminMiddleware } from '../../middlewares/auth.middleware';
import { validateRequest } from '../../middlewares/validateResult';
import {
    loginSchema,
    createAdminSchema,
    updateStatusSchema,
    resetPasswordSchema,
    paginationSchema
} from '../../validators/admin/adminUser.validator';
import { rateLimit } from 'express-rate-limit';

const router = Router();

// 创建限流中间件
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟窗口期
    max: 115, // 限制每个 IP 15分钟内最多 5 次尝试
    message: { success: false, message: 'Too many login attempts, please try again later' },
    standardHeaders: true, // 返回速率限制信息到 `RateLimit-*` 头
    legacyHeaders: false, // 禁用 `X-RateLimit-*` 头
});

// Public routes
router.post('/login', loginLimiter, validateRequest(loginSchema), login);

// Protected routes
router.use(authMiddleware);
router.post('/logout', logout);

// Super admin routes
router.use(superAdminMiddleware);
router.get('/list', validateRequest(paginationSchema), getAdminList);
router.post('/create', validateRequest(createAdminSchema), createAdmin);
router.put('/:id/status', validateRequest(updateStatusSchema), updateAdminStatus);
router.put('/:id/reset-password', validateRequest(resetPasswordSchema), resetPassword);
router.delete('/:id', deleteAdmin);

export default router;