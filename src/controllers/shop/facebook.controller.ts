// src/controllers/shop/facebook.controller.ts
import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { facebookAuthService } from '../../services/facebook.service';
import { redisClient } from '../../config';
import { logger } from '../../utils/logger';

export const facebookController = {
    /**
     * 获取Facebook登录URL
     */
    getLoginUrl: asyncHandler(async (req: Request, res: Response) => {
        const loginUrl = facebookAuthService.getLoginUrl();
        res.sendSuccess({ loginUrl });
    }),

    /**
     * 处理Facebook OAuth回调
     */
    handleCallback: asyncHandler(async (req: Request, res: Response) => {
        const { code } = req.query;

        if (!code || typeof code !== 'string') {
            throw new AppError(400, 'fail', '无效的请求');
        }

        try {
            logger.info('收到Facebook回调请求', {
                codeLength: code.length,
                url: req.originalUrl
            });

            // 获取访问令牌
            const accessToken = await facebookAuthService.getAccessToken(code);
            if (!accessToken) {
                throw new AppError(401, 'fail', '无法获取访问令牌');
            }

            // 验证令牌
            const isValid = await facebookAuthService.verifyAccessToken(accessToken);
            if (!isValid) {
                throw new AppError(401, 'fail', '无效的访问令牌');
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

            // 返回用户信息和令牌
            res.sendSuccess({
                token: authResult.token,
                user: authResult.user
            }, '登录成功');

            logger.info('Facebook登录成功', {
                userId: authResult.user.id,
                facebookId: facebookUser.id
            });
        } catch (error: any) {
            logger.error('Facebook登录失败', {
                errorMessage: error.message,
                errorName: error.name,
                stack: error.stack
            });
            throw new AppError(500, 'fail', '登录处理失败');
        }
    }),

    /**
     * 前端SDK获取token后直接登录
     */
    loginWithToken: asyncHandler(async (req: Request, res: Response) => {
        const { accessToken } = req.body;

        if (!accessToken) {
            throw new AppError(400, 'fail', '缺少访问令牌');
        }

        try {
            // 验证令牌
            const isValid = await facebookAuthService.verifyAccessToken(accessToken);
            if (!isValid) {
                throw new AppError(401, 'fail', '无效的访问令牌');
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

            // 返回用户信息和令牌
            res.sendSuccess({
                token: authResult.token,
                user: authResult.user
            }, '登录成功');

            logger.info('Facebook令牌登录成功', {
                userId: authResult.user.id,
                facebookId: facebookUser.id
            });
        } catch (error: any) {
            logger.error('Facebook令牌登录失败', {
                error: error.message,
                stack: error.stack
            });
            throw new AppError(500, 'fail', '登录处理失败');
        }
    })
};