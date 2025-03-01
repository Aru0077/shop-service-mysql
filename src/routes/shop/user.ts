// src/routes/shop/user.ts
// src/routes/shop/user.ts
import { Router } from 'express';
import { userController } from '../../controllers/shop/user.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { registerSchema, loginSchema, deleteAccountSchema } from '../../validators/shop/user.validator';
import { rateLimit } from 'express-rate-limit';
import { shopAuthMiddleware } from '../../middlewares/shopAuth.middleware';

const router = Router();
 

// 创建登录限流中间件
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟窗口期
    max: 5, // 限制每个IP在15分钟内最多5次尝试
    message: { success: false, message: '尝试登录次数过多，请稍后再试' },
    standardHeaders: true,
    legacyHeaders: false,
});

// 公开路由
router.post('/register', validateRequest(registerSchema), userController.register);
router.post('/login', loginLimiter, validateRequest(loginSchema), userController.login);

// 需要认证的路由
router.use(shopAuthMiddleware);
router.post('/logout', userController.logout);
router.delete('/account', validateRequest(deleteAccountSchema), userController.deleteAccount);

export default router;