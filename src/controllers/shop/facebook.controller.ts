// src/controllers/shop/facebook.controller.ts
import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { facebookAuthService } from '../../services/facebook.service';
import { redisClient } from '../../config';
import { logger } from '../../utils/logger';

export const facebookController = {
    /**
     * 使用访问令牌登录
     */
    loginWithToken: asyncHandler(async (req: Request, res: Response) => {
        const { accessToken } = req.body;

        if (!accessToken) {
            throw new AppError(400, 'fail', 'Missing access token');
        }

        try {
            // 验证令牌
            const isValid = await facebookAuthService.verifyAccessToken(accessToken);
            if (!isValid) {
                throw new AppError(401, 'fail', 'Invalid access token');
            }

            // 获取用户信息
            const facebookUser = await facebookAuthService.getUserInfo(accessToken);

            // 查找或创建用户
            const authResult = await facebookAuthService.findOrCreateUser(facebookUser);

            // 将令牌存储到Redis，用于验证和登出
            await redisClient.setEx(
                `shop:user:${authResult.user.id}:token`,
                24 * 60 * 60, // 24小时
                authResult.token
            );

            // 计算过期时间戳
            const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

            // 返回用户信息和令牌
            res.sendSuccess({
                token: authResult.token,
                user: authResult.user,
                expiresAt
            }, 'Login successful');

            logger.info('Facebook令牌登录成功', {
                userId: authResult.user.id,
                facebookId: facebookUser.id
            });
        } catch (error: any) {
            logger.error('Facebook令牌登录失败', {
                error: error.message,
                stack: error.stack
            });
            throw new AppError(500, 'fail', 'Login processing failed');
        }
    })
};