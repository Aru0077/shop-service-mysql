// src/services/qpay.service.ts
import axios, { AxiosInstance } from 'axios';
import { redisClient } from '../config';
import {
      QPayAuthResponse,
      QPayInvoiceRequest,
      QPayInvoiceResponse,
      QPayPaymentCheckRequest,
      QPayPaymentCheckResponse,
      QPayPayment
} from '../types/qpay.types';
import { logger } from '../utils/logger';

class QPayService {
      private axiosInstance: AxiosInstance;
      private apiUrl: string;
      private clientId: string;
      private clientSecret: string;
      private invoiceCode: string;
      private callbackUrl: string;

      constructor() {
            // 从环境变量获取配置
            this.apiUrl = process.env.QPAY_API_URL || 'https://merchant.qpay.mn/v2';
            this.clientId = process.env.QPAY_CLIENT_ID || '';
            this.clientSecret = process.env.QPAY_CLIENT_SECRET || '';
            this.invoiceCode = process.env.QPAY_INVOICE_CODE || '';
            this.callbackUrl = process.env.QPAY_CALLBACK_URL || '';

            // 验证必要的环境变量是否存在
            if (!this.clientId || !this.clientSecret) {
                  logger.error('QPay配置错误: 缺少客户端ID或密钥');
            }

            if (!this.callbackUrl) {
                  logger.error('QPay配置错误: 缺少回调URL');
            }

            // 创建axios实例
            this.axiosInstance = axios.create({
                  baseURL: this.apiUrl,
                  timeout: 30000,
                  headers: {
                        'Content-Type': 'application/json'
                  }
            });

            // 添加请求拦截器处理认证
            this.axiosInstance.interceptors.request.use(
                  async (config) => {
                        // 不拦截认证请求
                        if (config.url?.includes('/auth/token')) {
                              return config;
                        }

                        // 获取访问令牌
                        const token = await this.getAccessToken();
                        if (token) {
                              config.headers.Authorization = `Bearer ${token}`;
                        }

                        return config;
                  },
                  (error) => Promise.reject(error)
            );

            // 添加响应拦截器处理错误
            this.axiosInstance.interceptors.response.use(
                  (response) => response,
                  async (error) => {
                        // 请求配置
                        const originalRequest = error.config;

                        // 如果是401错误且未重试，尝试刷新令牌并重试
                        if (error.response?.status === 401 && !originalRequest._retry) {
                              originalRequest._retry = true;

                              try {
                                    // 刷新令牌
                                    await this.refreshToken();

                                    // 获取新令牌
                                    const token = await this.getAccessToken();
                                    

                                    // 更新请求头
                                    originalRequest.headers.Authorization = `Bearer ${token}`;

                                    // 重试请求
                                    return this.axiosInstance(originalRequest);
                              } catch (refreshError) {
                                    logger.error('QPay令牌刷新失败', { error: refreshError });
                                    return Promise.reject(refreshError);
                              }
                        }

                        return Promise.reject(error);
                  }
            );
      }

      /**
       * 获取缓存的访问令牌
       */
      private async getAccessToken(): Promise<string | null> {
            try {
                  // 从Redis获取令牌
                  const token = await redisClient.get('qpay:access_token');

                  if (!token) {
                        // 如果令牌不存在，获取新令牌
                        return await this.authenticate();
                  }

                  return token;
            } catch (error) {
                  logger.error('获取QPay访问令牌失败', { error });
                  throw error;
            }
      }

      /**
       * 执行认证获取新令牌
       */
      private async authenticate(): Promise<string | null> {
            try {
                  // 使用Basic认证请求令牌
                  const response = await this.axiosInstance.post<QPayAuthResponse>(
                        '/auth/token',
                        {},
                        {
                              auth: {
                                    username: this.clientId,
                                    password: this.clientSecret
                              }
                        }
                  );

                  const { access_token, expires_in } = response.data;

                  // 缓存访问令牌
                  await redisClient.setEx('qpay:access_token', expires_in, access_token);

                  // 如果有刷新令牌，也缓存它
                  if (response.data.refresh_token) {
                        await redisClient.setEx('qpay:refresh_token', expires_in * 2, response.data.refresh_token);
                  }

                  return access_token;
            } catch (error) {
                  logger.error('QPay认证失败', { error });
                  return null;
            }
      }

      /**
       * 刷新访问令牌
       */
      private async refreshToken(): Promise<boolean> {
            try {
                  // 获取刷新令牌
                  const refreshToken = await redisClient.get('qpay:refresh_token');

                  if (!refreshToken) {
                        // 如果没有刷新令牌，直接重新认证
                        await this.authenticate();
                        return true;
                  }

                  // 使用刷新令牌获取新的访问令牌
                  const response = await this.axiosInstance.post<QPayAuthResponse>(
                        '/auth/refresh',
                        {},
                        {
                              headers: {
                                    Authorization: `Bearer ${refreshToken}`
                              }
                        }
                  );

                  const { access_token, expires_in } = response.data;

                  // 缓存新的访问令牌
                  await redisClient.setEx('qpay:access_token', expires_in, access_token);

                  return true;
            } catch (error) {
                  logger.error('QPay令牌刷新失败', { error });

                  // 刷新失败，尝试重新认证
                  await this.authenticate();

                  return false;
            }
      }

      /**
       * 创建支付发票
       */
      public async createInvoice(
            amount: number,
            description: string,
            orderNo: string,
            customCallbackUrl?: string
      ): Promise<QPayInvoiceResponse | null> {
            try {
                  // 使用完整的回调URL，添加订单ID作为查询参数
                  const callbackUrl = customCallbackUrl || `${this.callbackUrl}?payment_id=${orderNo}`;

                  // 准备发票请求数据
                  const invoiceData: QPayInvoiceRequest = {
                        invoice_code: this.invoiceCode,
                        sender_invoice_no: orderNo,
                        invoice_receiver_code: 'terminal',
                        invoice_description: description,
                        // sender_branch_code: 'BRANCH1',
                        amount,
                        callback_url: callbackUrl
                  };

                  // 创建发票
                  const response = await this.axiosInstance.post<QPayInvoiceResponse>(
                        '/invoice',
                        invoiceData
                  );

                  logger.info('QPay发票创建结果',  response.data);


                  // 缓存发票信息，用于后续状态查询
                  const invoiceKey = `qpay:invoice:${orderNo}`;
                  await redisClient.setEx(invoiceKey, 3600, JSON.stringify(response.data));

                  return response.data;
            } catch (error: any) {
                  // 更详细地记录错误
                  const errorDetails = {
                        message: error.message || '未知错误',
                        name: error.name,
                        stack: error.stack,
                        response: error.response?.data, // 捕获API响应中的错误信息
                        orderNo
                  };
                  logger.error('创建QPay发票失败', errorDetails);
                  return null;
            }
      }

      /**
       * 检查支付状态
       */
      public async checkPaymentStatus(
            invoiceId: string
      ): Promise<QPayPayment | null> {
            try {
                  // 准备支付检查请求
                  const checkRequest: QPayPaymentCheckRequest = {
                        object_type: 'INVOICE',
                        object_id: invoiceId,
                        offset: {
                              page_number: 1,
                              page_limit: 100
                        }
                  };

                  // 检查支付状态
                  const response = await this.axiosInstance.post<QPayPaymentCheckResponse>(
                        '/payment/check',
                        checkRequest
                  );

                  // 检查是否有支付记录
                  if (response.data.count > 0 && response.data.rows.length > 0) {
                        return response.data.rows[0];
                  }

                  return null;
            } catch (error) {
                  logger.error('检查QPay支付状态失败', { error, invoiceId });
                  return null;
            }
      }

      /**
       * 获取支付详情
       */
      public async getPaymentDetails(
            paymentId: string
      ): Promise<any | null> {
            try {
                  const response = await this.axiosInstance.get(`/payment/${paymentId}`);
                  return response.data;
            } catch (error) {
                  logger.error('获取QPay支付详情失败', { error, paymentId });
                  return null;
            }
      }

      /**
       * 取消发票
       */
      public async cancelInvoice(
            invoiceId: string
      ): Promise<boolean> {
            try {
                  await this.axiosInstance.delete(`/invoice/${invoiceId}`);
                  return true;
            } catch (error) {
                  logger.error('取消QPay发票失败', { error, invoiceId });
                  return false;
            }
      }

      /**
       * 创建电子发票
       */
      public async createEbarimt(
            paymentId: string,
            receiverType: string = 'CITIZEN'
      ): Promise<any | null> {
            try {
                  const response = await this.axiosInstance.post('/ebarimt/create', {
                        payment_id: paymentId,
                        ebarimt_receiver_type: receiverType
                  });

                  return response.data;
            } catch (error) {
                  logger.error('创建QPay电子发票失败', { error, paymentId });
                  return null;
            }
      }
}

// 导出服务实例
export const qpayService = new QPayService();