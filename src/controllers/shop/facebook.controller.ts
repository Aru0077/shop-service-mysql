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
        const { code, state } = req.query;

        // 验证state参数
        const validState = await redisClient.get(`facebook:state:${state}`);

        if (!validState) {
            return res.redirect('https://www.uni-mall-mn.shop/login?error=无效的请求状态');
        }

        // 删除已使用的state
        await redisClient.del(`facebook:state:${state}`);

        if (!code || typeof code !== 'string') {
            return res.redirect('https://www.uni-mall-mn.shop/login?error=无效的请求');
        }

        try {
            // 获取访问令牌
            const accessToken = await facebookAuthService.getAccessToken(code);

            // 验证令牌
            const isValid = await facebookAuthService.verifyAccessToken(accessToken);
            if (!isValid) {
                return res.redirect('https://www.uni-mall-mn.shop/login?error=无效的访问令牌');
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

            // 使用Base64编码用户名，避免URL编码问题
            const safeUsername = Buffer.from(authResult.user.username).toString('base64');
        

            // 重定向回前端，附带成功消息和令牌
            return res.redirect(`https://www.uni-mall-mn.shop/auth/login-success?token=${authResult.token}&userId=${authResult.user.id}&username=${encodeURIComponent(authResult.user.username)}`); 

            
        } catch (error: any) {
            logger.error('Facebook登录失败', {
                errorMessage: error.message,
                errorName: error.name,
                stack: error.stack
            });
            return res.redirect('https://www.uni-mall-mn.shop/login?error=登录处理失败');
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