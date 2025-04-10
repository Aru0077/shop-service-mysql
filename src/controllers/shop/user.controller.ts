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
                  throw new AppError(400, 'fail', 'Username is already registered');
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

            res.sendSuccess(userData, 'Registration successful');
      }),

      // 用户登录
      login: asyncHandler(async (req: Request, res: Response) => {
            const { username, password } = req.body;

            // 查找用户
            const user = await prisma.user.findUnique({
                  where: { username }
            });

            if (!user || !user.password) {
                  throw new AppError(401, 'fail', 'Incorrect username or password');
            }

            if (user.isBlacklist === 1) {
                  throw new AppError(403, 'fail', 'Account has been disabled');
            }

            // 验证密码
            const isPasswordValid = await compare(password, user.password);
            if (!isPasswordValid) {
                  throw new AppError(401, 'fail', 'Incorrect username or password');
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

            res.sendSuccess({ token, user: userData, expiresAt }, 'Login successful');
      }),

      // 退出登录
      logout: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;

            if (userId) {
                  // 从Redis中删除令牌
                  await redisClient.del(`shop:user:${userId}:token`);
            }

            res.sendSuccess(null, 'Logout successful');
      }),

      // 删除账号
      // 删除账号
      deleteAccount: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;

            if (!userId) {
                  throw new AppError(401, 'fail', 'Please login first');
            }

            // 查找用户
            const user = await prisma.user.findUnique({
                  where: { id: userId }
            });

            if (!user) {
                  throw new AppError(404, 'fail', 'User does not exist');
            }

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
                  throw new AppError(400, 'fail', 'You have unfinished orders, cannot delete account at this time');
            }

            // 找出用户的所有订单ID
            const userOrders = await prisma.order.findMany({
                  where: { userId },
                  select: { id: true }
            });

            const orderIds = userOrders.map(order => order.id);

            // 完整事务删除用户相关数据
            try {
                  await prisma.$transaction(async (tx) => {
                        // 1. 先删除与订单相关的数据
                        if (orderIds.length > 0) {
                              // 删除QPay发票和回调记录
                              await tx.qPayInvoice.deleteMany({
                                    where: { orderId: { in: orderIds } }
                              });

                              await tx.qPayCallback.deleteMany({
                                    where: { orderId: { in: orderIds } }
                              });

                              // 删除支付日志
                              await tx.paymentLog.deleteMany({
                                    where: { orderId: { in: orderIds } }
                              });

                              // 删除订单项
                              await tx.orderItem.deleteMany({
                                    where: { orderId: { in: orderIds } }
                              });

                              // 删除订单
                              await tx.order.deleteMany({
                                    where: { id: { in: orderIds } }
                              });
                        }

                        // 2. 删除用户其他相关数据
                        await tx.userCartItem.deleteMany({ where: { userId } });
                        await tx.userFavorite.deleteMany({ where: { userId } });
                        await tx.userAddress.deleteMany({ where: { userId } });

                        // 3. 最后删除用户
                        await tx.user.delete({ where: { id: userId } });
                  });

                  // 删除Redis中的令牌
                  await redisClient.del(`shop:user:${userId}:token`);

                  res.sendSuccess(null, 'Account deleted successfully');
            } catch (error) {
                  console.error('删除账号失败:', error);
                  throw new AppError(500, 'fail', 'Failed to delete account, please try again later');
            }
      })
};