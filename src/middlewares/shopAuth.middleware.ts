// src/middlewares/shopAuth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { verify } from 'jsonwebtoken';
import { prisma, redisClient } from '../config';
import { AppError } from '../utils/http.utils';
import { asyncHandler } from '../utils/http.utils';

// 商城用户认证中间件
export const shopAuthMiddleware = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
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