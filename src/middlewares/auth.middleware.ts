// src/middlewares/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config';
import { verify } from 'jsonwebtoken';
import { asyncHandler } from '../utils/http.utils';
import { AppError } from '../utils/http.utils';

// 扩展 Express Request 类型
declare global {
      namespace Express {
            interface Request {
                  user?: {
                        id: number;  // 修改为 number 类型
                        username: string;
                        password: string;
                        status: number;
                        isSuper: boolean;
                        lastLoginTime: Date | null;
                        createdAt: Date;
                        updatedAt: Date;
                  };
            }
      }
}

// 认证中间件
export const authMiddleware = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
            throw new AppError(401, 'fail', 'Authentication required');
      }

      try {
            const decoded = verify(token, process.env.JWT_SECRET as string) as { id: string };
            const admin = await prisma.adminUser.findUnique({
                  where: { id: parseInt(decoded.id) }  // 修改为 parseInt
            });

            if (!admin || admin.status !== 1) {
                  throw new AppError(401, 'fail', 'Invalid or inactive account');
            }

            req.user = admin;
            next();
      } catch (error) {
            if (error instanceof AppError) {
                  throw error;
            }
            throw new AppError(401, 'fail', 'Invalid token');
      }
});

// 超级管理员中间件
export const superAdminMiddleware = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
      const admin = req.user;
      if (!admin?.isSuper) {
            throw new AppError(403, 'fail', 'Super admin privileges required');
      }
      next();
});