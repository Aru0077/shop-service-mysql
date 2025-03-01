// src/routes/shop/user.ts
// src/routes/shop/user.ts
import { Router } from 'express';
import { userController } from '../../controllers/shop/user.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { registerSchema, loginSchema, deleteAccountSchema } from '../../validators/shop/user.validator';
import { rateLimit } from 'express-rate-limit';
import { verify } from 'jsonwebtoken';
import { prisma, redisClient } from '../../config';
import { AppError } from '../../utils/http.utils';
import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../../utils/http.utils';

const router = Router();

// 创建商城用户认证中间件
const shopAuthMiddleware = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        throw new AppError(401, 'fail', '请先登录');
    }

    try {
        const decoded = verify(token, process.env.JWT_SECRET as string) as { id: string };
        
        // 验证Redis中是否存在相同令牌
        const redisToken = await redisClient.get(`shop:user:${decoded.id}:token`);
        if (!redisToken || redisToken !== token) {
            throw new AppError(401, 'fail', '登录已过期，请重新登录');
        }
        
        const user = await prisma.user.findUnique({
            where: { id: decoded.id }
        });

        if (!user || user.isBlacklist === 1) {
            throw new AppError(401, 'fail', '用户不存在或已被禁用');
        }

        req.shopUser = {
            id: user.id,
            username: user.username
        };
        
        next();
    } catch (error) {
        if (error instanceof AppError) {
            throw error;
        }
        throw new AppError(401, 'fail', '登录已过期，请重新登录');
    }
});

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