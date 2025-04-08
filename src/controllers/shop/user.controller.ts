// src/controllers/shop/user.controller.ts
import { Request, Response } from 'express';
import { prisma, redisClient } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { hash, compare } from 'bcrypt';
import { sign } from 'jsonwebtoken';

const SALT_ROUNDS = 10;
const TOKEN_EXPIRE_TIME = 24 * 60 * 60; // 24小时，单位秒

// 扩展Express的Request类型来包含商城用户信息
declare global {
      namespace Express {
            interface Request {
                  shopUser?: {
                        id: string;
                        username: string;
                  };
            }
      }
}

export const userController = {
      // 用户注册
      register: asyncHandler(async (req: Request, res: Response) => {
            const { username, password } = req.body;

            // 检查用户名是否已存在
            const existingUser = await prisma.user.findUnique({
                  where: { username }
            });

            if (existingUser) {
                  throw new AppError(400, 'fail', '用户名已被注册');
            }

            // 加密密码
            const hashedPassword = await hash(password, SALT_ROUNDS);

            // 创建用户
            const user = await prisma.user.create({
                  data: {
                        username,
                        password: hashedPassword,
                  }
            });

            // 不返回密码字段
            const userData = {
                  id: user.id,
                  username: user.username,
                  createdAt: user.createdAt
            };

            res.sendSuccess(userData, '注册成功');
      }),

      // 用户登录
      login: asyncHandler(async (req: Request, res: Response) => {
            const { username, password } = req.body;

            // 查找用户
            const user = await prisma.user.findUnique({
                  where: { username }
            });

            if (!user || !user.password) {
                  throw new AppError(401, 'fail', '用户名或密码错误');
            }

            if (user.isBlacklist === 1) {
                  throw new AppError(403, 'fail', '账号已被禁用');
            }

            // 验证密码
            const isPasswordValid = await compare(password, user.password);
            if (!isPasswordValid) {
                  throw new AppError(401, 'fail', '用户名或密码错误');
            }

            // 生成JWT令牌
            const token = sign({ id: user.id }, process.env.JWT_SECRET as string, {
                  expiresIn: TOKEN_EXPIRE_TIME
            });

            // 将令牌存储到Redis，用于验证和登出
            await redisClient.setEx(`shop:user:${user.id}:token`, TOKEN_EXPIRE_TIME, token);

            // 计算过期时间戳
            const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_EXPIRE_TIME;

            // 返回用户信息和令牌
            const userData = {
                  id: user.id,
                  username: user.username
            };

            res.sendSuccess({ token, user: userData, expiresAt }, '登录成功');
      }),

      // 退出登录
      logout: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;

            if (userId) {
                  // 从Redis中删除令牌
                  await redisClient.del(`shop:user:${userId}:token`);
            }

            res.sendSuccess(null, '已成功退出登录');
      }),

      // 删除账号
      deleteAccount: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { password } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 查找用户
            const user = await prisma.user.findUnique({
                  where: { id: userId }
            });
            // 检查用户是否存在 || !user.password
            if (!user ) {
                  throw new AppError(404, 'fail', '用户不存在');
            }

            // 验证密码
            // const isPasswordValid = await compare(password, user.password);
            // if (!isPasswordValid) {
            //       throw new AppError(401, 'fail', '密码错误');
            // }

            // 检查是否有未完成的订单
            const pendingOrders = await prisma.order.findFirst({
                  where: {
                        userId,
                        orderStatus: {
                              in: [1, 2, 3] // 待付款、待发货、已发货的订单
                        }
                  }
            });

            if (pendingOrders) {
                  throw new AppError(400, 'fail', '您有未完成的订单，暂时无法删除账号');
            }

            // 事务删除用户相关数据
            await prisma.$transaction([
                  prisma.userCartItem.deleteMany({ where: { userId } }),
                  prisma.userFavorite.deleteMany({ where: { userId } }),
                  prisma.userAddress.deleteMany({ where: { userId } }),
                  prisma.user.delete({ where: { id: userId } })
            ]);

            // 删除Redis中的令牌
            await redisClient.del(`shop:user:${userId}:token`);

            res.sendSuccess(null, '账号已成功删除');
      })
};