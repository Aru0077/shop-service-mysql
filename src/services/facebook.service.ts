// src/services/facebook.service.ts
import axios from 'axios';
import { prisma } from '../config';
import { sign } from 'jsonwebtoken';
import { logger } from '../utils/logger';

/**
 * Facebook认证服务
 * 负责处理Facebook OAuth认证流程、验证令牌和用户管理
 */
export class FacebookAuthService {
      private appId: string;
      private appSecret: string;
      private apiVersion: string;
      private redirectUri: string;

      constructor() {
            // 从环境变量获取Facebook应用配置
            this.appId = process.env.FACEBOOK_APP_ID || '';
            this.appSecret = process.env.FACEBOOK_APP_SECRET || '';
            this.apiVersion = process.env.FACEBOOK_API_VERSION || 'v22.0';
            this.redirectUri = process.env.FACEBOOK_REDIRECT_URI || '';

            // 验证配置
            this.validateConfig();
      }

      /**
       * 验证Facebook配置是否完整
       */
      private validateConfig(): void {
            if (!this.appId || !this.appSecret) {
                  logger.error('Facebook认证配置不完整，请检查环境变量');
            }
      }

      /**
       * 获取Facebook登录URL
       * @returns Facebook登录URL
       */
      public getLoginUrl(): string {
            const scopes = ['email', 'public_profile'];

            return `https://www.facebook.com/${this.apiVersion}/dialog/oauth?` +
                  `client_id=${this.appId}` +
                  `&redirect_uri=${encodeURIComponent(this.redirectUri)}` +
                  `&scope=${encodeURIComponent(scopes.join(','))}` +
                  `&response_type=code`;
      }

      /**
       * 通过授权码获取访问令牌
       * @param code Facebook授权码
       * @returns 访问令牌
       */
      public async getAccessToken(code: string): Promise<string> {
            try {
                  const response = await axios.get(
                        `https://graph.facebook.com/${this.apiVersion}/oauth/access_token`,
                        {
                              params: {
                                    client_id: this.appId,
                                    client_secret: this.appSecret,
                                    redirect_uri: this.redirectUri,
                                    code: code
                              }
                        }
                  );

                  return response.data.access_token;
            } catch (error) {
                  logger.error('获取Facebook访问令牌失败', error);
                  throw new Error('获取访问令牌失败');
            }
      }

      /**
       * 验证Facebook访问令牌
       * @param accessToken Facebook访问令牌
       * @returns 验证结果
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
       * @param accessToken Facebook访问令牌
       * @returns 用户信息
       */
      public async getUserInfo(accessToken: string): Promise<any> {
            try {
                  const response = await axios.get(
                        `https://graph.facebook.com/${this.apiVersion}/me`,
                        {
                              params: {
                                    fields: 'id,name,email',
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
       * 根据Facebook ID查找或创建用户
       * @param facebookData Facebook用户数据
       * @returns 用户信息和JWT令牌
       */
      public async findOrCreateUser(facebookData: any): Promise<{ token: string, user: any }> {
            const { id: facebookId, name, email } = facebookData;

            try {
                  // 查找是否已存在Facebook ID关联的用户
                  let user = await prisma.user.findFirst({
                        where: { facebookId }
                  });

                  if (!user) {
                        // 如果有email且email已注册，则关联到现有账号
                        if (email) {
                              user = await prisma.user.findFirst({
                                    where: { username: email }
                              });

                              if (user) {
                                    // 更新现有用户的Facebook ID
                                    user = await prisma.user.update({
                                          where: { id: user.id },
                                          data: { facebookId }
                                    });
                              }
                        }

                        // 如果仍未找到用户，创建新用户
                        if (!user) {
                              // 生成唯一用户名
                              const username = email || `fb_${facebookId}`;

                              // 检查用户名是否已存在
                              const existingUser = await prisma.user.findUnique({
                                    where: { username }
                              });

                              // 如果用户名已存在，添加随机后缀
                              const finalUsername = existingUser
                                    ? `${username}_${Math.floor(Math.random() * 10000)}`
                                    : username;

                              // 创建新用户
                              user = await prisma.user.create({
                                    data: {
                                          username: finalUsername,
                                          facebookId
                                    }
                              });
                        }
                  }

                  // 生成JWT令牌
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