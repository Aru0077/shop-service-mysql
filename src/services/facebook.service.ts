// src/services/facebook.service.ts
import axios from 'axios';
import { prisma } from '../config';
import { sign } from 'jsonwebtoken';
import { logger } from '../utils/logger';
import crypto from 'crypto';
import { redisClient } from '../config';

export class FacebookAuthService {
      private appId: string;
      private appSecret: string;
      private apiVersion: string;
      private redirectUri: string;

      constructor() {
            // 从环境变量获取配置
            this.appId = process.env.FACEBOOK_APP_ID || '';
            this.appSecret = process.env.FACEBOOK_APP_SECRET || '';
            this.apiVersion = process.env.FACEBOOK_API_VERSION || 'v22.0';
            this.redirectUri = process.env.FACEBOOK_REDIRECT_URI || '';

            // 验证必要的配置
            const missingConfig = [];
            if (!this.appId) missingConfig.push('FACEBOOK_APP_ID');
            if (!this.appSecret) missingConfig.push('FACEBOOK_APP_SECRET');
            if (!this.redirectUri) missingConfig.push('FACEBOOK_REDIRECT_URI');

            if (missingConfig.length > 0) {
                  logger.error('Facebook Auth Service 初始化失败：缺少必要配置', { missingConfig });
            } else {
                  logger.info('Facebook Auth Service 初始化成功', {
                        appId: this.appId ? '已配置' : '未配置',
                        redirectUri: this.redirectUri,
                        apiVersion: this.apiVersion
                  });
            }
      }

      /**
       * 获取Facebook登录URL
       */
      public getLoginUrl(): string {
            const state = crypto.randomBytes(16).toString('hex');
            // 将state保存到Redis，用于验证回调
            redisClient.setEx(`facebook:state:${state}`, 600, '1');

            const scopes = ['public_profile'];

            return `https://www.facebook.com/${this.apiVersion}/dialog/oauth?` +
                  `client_id=${this.appId}` +
                  `&redirect_uri=${encodeURIComponent(this.redirectUri)}` +
                  `&scope=${encodeURIComponent(scopes.join(','))}` +
                  `&state=${state}` +
                  `&response_type=code`;
      }

      /**
       * 通过授权码获取访问令牌
       */
      public async getAccessToken(code: string): Promise<string> {
            try {
                  // 日志记录请求参数（不含敏感信息）
                  logger.info('正在请求Facebook访问令牌', {
                        apiVersion: this.apiVersion,
                        redirectUri: this.redirectUri
                  });

                  // 使用 POST 而非 GET，避免 URL 长度限制
                  const response = await axios.post(
                        `https://graph.facebook.com/${this.apiVersion}/oauth/access_token`,
                        null, // POST 请求体为空
                        {
                              params: {
                                    client_id: this.appId,
                                    client_secret: this.appSecret,
                                    redirect_uri: this.redirectUri,
                                    code: code
                              }
                        }
                  );

                  logger.info('Facebook访问令牌获取成功');
                  return response.data.access_token;
            } catch (error: any) {
                  // 增强错误记录，捕获更多详细信息
                  const errorData = error.response?.data || {};
                  const errorDetails = {
                        statusCode: error.response?.status,
                        errorMessage: error.message,
                        errorName: error.name,
                        fbError: errorData.error,
                        redirectUri: this.redirectUri
                  };

                  logger.error('获取Facebook访问令牌失败', errorDetails);
                  throw new Error('获取访问令牌失败');
            }
      }

      /**
       * 验证Facebook访问令牌
       */
      public async verifyAccessToken(accessToken: string): Promise<boolean> {
            try {
                  const response = await axios.get(
                        `https://graph.facebook.com/debug_token`,
                        {
                              params: {
                                    input_token: accessToken,
                                    access_token: `${this.appId}|${this.appSecret}`
                              }
                        }
                  );
                  return response.data.data.is_valid || false;
            } catch (error) {
                  logger.error('验证Facebook访问令牌失败', error);
                  return false;
            }
      }

      /**
       * 获取Facebook用户信息
       */
      public async getUserInfo(accessToken: string): Promise<any> {
            try {
                  const response = await axios.get(
                        `https://graph.facebook.com/${this.apiVersion}/me`,
                        {
                              params: {
                                    fields: 'id,name',
                                    access_token: accessToken
                              }
                        }
                  );
                  return response.data;
            } catch (error) {
                  logger.error('获取Facebook用户信息失败', error);
                  throw new Error('获取用户信息失败');
            }
      }

      /**
       * 查找或创建用户
       */
      public async findOrCreateUser(facebookData: any): Promise<{ token: string, user: any }> {
            const { id: facebookId, name } = facebookData;

            try {
                  // 1. 通过 Facebook ID 查找用户
                  let user = await prisma.user.findFirst({
                        where: { facebookId }
                  });

                  // 2. 如果没找到用户，创建新用户
                  if (!user) {
                        // 直接使用 Facebook name 作为用户名
                        const username = name;

                        // 检查用户名是否已存在
                        const existingUser = await prisma.user.findUnique({
                              where: { username }
                        });

                        // 如果用户名已存在，添加随机后缀
                        const finalUsername = existingUser
                              ? `${name}_${Math.floor(Math.random() * 10000)}`
                              : username;

                        // 创建新用户
                        user = await prisma.user.create({
                              data: {
                                    username: finalUsername,
                                    facebookId
                              }
                        });

                        logger.info('已创建新Facebook用户', {
                              userId: user.id,
                              username: user.username,
                              facebookId: user.facebookId
                        });
                  }

                  // 3. 生成JWT令牌
                  const token = sign(
                        { id: user.id },
                        process.env.JWT_SECRET as string,
                        { expiresIn: 24 * 60 * 60 } // 24小时
                  );

                  return {
                        token,
                        user: {
                              id: user.id,
                              username: user.username
                        }
                  };
            } catch (error) {
                  logger.error('处理Facebook用户数据失败', error);
                  throw new Error('处理用户数据失败');
            }
      }
}

// 导出单例实例
export const facebookAuthService = new FacebookAuthService();