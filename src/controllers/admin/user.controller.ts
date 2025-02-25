// src/controllers/admin/user.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';

export const userController = {
      // 分页获取用户列表，支持用户名搜索
      getUsers: asyncHandler(async (req: Request, res: Response) => {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const username = req.query.username as string | undefined;
            const skip = (page - 1) * limit;

            // 构建查询条件
            const whereClause = username
                  ? {
                        username: {
                              contains: username
                        }
                  }
                  : {};

            // 执行查询
            const [total, users] = await Promise.all([
                  prisma.user.count({
                        where: whereClause
                  }),
                  prisma.user.findMany({
                        where: whereClause,
                        skip,
                        take: limit,
                        select: {
                              id: true,
                              username: true,
                              facebookId: true,
                              isBlacklist: true,
                              createdAt: true,
                              updatedAt: true,
                              _count: {
                                    select: {
                                          orders: true,
                                          addresses: true,
                                          cartItems: true,
                                          favorites: true
                                    }
                              }
                        },
                        orderBy: {
                              createdAt: 'desc'
                        }
                  })
            ]);

            res.sendSuccess({
                  total,
                  page,
                  limit,
                  data: users
            });
      }),

      // 获取单个用户详情
      getUserDetails: asyncHandler(async (req: Request, res: Response) => {
            const { id } = req.params;

            const user = await prisma.user.findUnique({
                  where: { id },
                  select: {
                        id: true,
                        username: true,
                        facebookId: true,
                        isBlacklist: true,
                        createdAt: true,
                        updatedAt: true,
                        _count: {
                              select: {
                                    orders: true,
                                    addresses: true,
                                    cartItems: true,
                                    favorites: true
                              }
                        }
                  }
            });

            if (!user) {
                  throw new AppError(404, 'fail', '用户不存在');
            }

            res.sendSuccess(user);
      }),

      // 设置用户黑名单状态
      setBlacklistStatus: asyncHandler(async (req: Request, res: Response) => {
            const { id } = req.params;
            const { isBlacklist } = req.body;

            // 确认用户存在
            const user = await prisma.user.findUnique({
                  where: { id }
            });

            if (!user) {
                  throw new AppError(404, 'fail', '用户不存在');
            }

            // 更新黑名单状态
            const updatedUser = await prisma.user.update({
                  where: { id },
                  data: { isBlacklist },
                  select: {
                        id: true,
                        username: true,
                        facebookId: true,
                        isBlacklist: true,
                        createdAt: true,
                        updatedAt: true
                  }
            });

            const statusMessage = isBlacklist === 1 ? '用户已加入黑名单' : '用户已从黑名单移除';
            res.sendSuccess(updatedUser, statusMessage);
      })
};