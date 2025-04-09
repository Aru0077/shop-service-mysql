// src/services/qpay.service.ts
import axios from 'axios';
import { redisClient, prisma } from '../config';
import { OrderStatus, PaymentStatus } from '../constants/orderStatus.enum';
import { logger } from '../utils/logger';
import { orderQueue } from '../queues/order.queue';
import { cacheUtils } from '../utils/cache.utils';

// QPay配置常量
const QPAY_API_URL = process.env.QPAY_API_URL || 'https://merchant.qpay.mn/v2';
const QPAY_CLIENT_ID = process.env.QPAY_CLIENT_ID || 'LINING2';
const QPAY_CLIENT_SECRET = process.env.QPAY_CLIENT_SECRET || '9tdHUEtK2';
const QPAY_INVOICE_CODE = process.env.QPAY_INVOICE_CODE || 'LINING_INVOICE';
const QPAY_CALLBACK_URL = process.env.QPAY_CALLBACK_URL || 'https://api.uni-mall-mn.shop/v1/shop/qpay/callback';

// Redis缓存键
const QPAY_TOKEN_KEY = 'qpay:token';
const QPAY_TOKEN_LOCK_KEY = 'qpay:token:lock';
const QPAY_TOKEN_EXPIRY = 86400; // 24小时缓存


class QPayService {
      /**
       * 获取QPay访问令牌，带缓存、并发控制和重试限制
       * @returns 访问令牌
       */
      async getAccessToken(): Promise<string> {
            // 最大重试次数常量
            const MAX_TOKEN_RETRY = 3;
            let retryCount = 0;

            try {
                  // 先尝试从缓存获取令牌
                  const cachedToken = await redisClient.get(QPAY_TOKEN_KEY);
                  if (cachedToken) {
                        logger.info('使用缓存的QPay访问令牌');
                        return cachedToken;
                  }

                  // 检查是否有刷新令牌可用
                  const refreshToken = await redisClient.get('qpay:refresh_token');
                  if (refreshToken) {
                        logger.info('尝试使用刷新令牌获取新访问令牌');
                        try {
                              // 尝试刷新令牌
                              const result = await this.refreshAccessToken(refreshToken);
                              logger.info('成功通过刷新令牌获取新访问令牌');
                              return result.accessToken;
                        } catch (refreshError: any) {
                              // 刷新失败，记录日志
                              logger.warn('刷新令牌失败，将尝试重新获取令牌', {
                                    error: refreshError.message
                              });
                              // 刷新失败后删除刷新令牌避免重复尝试
                              await redisClient.del('qpay:refresh_token');
                              // 继续执行原有的获取令牌流程
                        }
                  }

                  // 实现重试逻辑
                  while (retryCount < MAX_TOKEN_RETRY) {
                        // 尝试获取令牌刷新锁
                        const lockAcquired = await redisClient.set(QPAY_TOKEN_LOCK_KEY, '1', {
                              NX: true,
                              EX: 30 // 30秒锁定时间
                        });

                        if (lockAcquired) {
                              try {
                                    // 调用API获取令牌
                                    logger.info('开始请求QPay访问令牌', {
                                          clientId: QPAY_CLIENT_ID,
                                          requestTime: new Date().toISOString(),
                                          attempt: retryCount + 1
                                    });

                                    const response = await axios.post(
                                          `${QPAY_API_URL}/auth/token`,
                                          {},
                                          {
                                                auth: {
                                                      username: QPAY_CLIENT_ID,
                                                      password: QPAY_CLIENT_SECRET
                                                },
                                                headers: {
                                                      'Content-Type': 'application/json'
                                                }
                                          }
                                    );

                                    logger.info('QPay访问令牌API响应', {
                                          status: response.status,
                                          responseTime: new Date().toISOString()
                                    });

                                    // 提取响应中的令牌
                                    const token = response.data.access_token;
                                    const refreshToken = response.data.refresh_token;
                                    const expiresIn = response.data.expires_in;
                                    const refreshExpiresIn = response.data.refresh_expires_in;

                                    if (!token) {
                                          logger.error('QPay未返回有效的访问令牌', { response: response.data });
                                          throw new Error('QPay未返回有效的访问令牌');
                                    }

                                    // 计算相对过期时间（将时间戳转换为相对秒数）
                                    const now = Math.floor(Date.now() / 1000);

                                    // 访问令牌缓存时间（提前5分钟过期）
                                    let tokenExpiry = QPAY_TOKEN_EXPIRY; // 默认值
                                    if (expiresIn && expiresIn > now) {
                                          tokenExpiry = expiresIn - now - 300; // 提前5分钟过期
                                    }

                                    // 刷新令牌缓存时间
                                    let refreshExpiry = QPAY_TOKEN_EXPIRY * 2; // 默认值
                                    if (refreshExpiresIn && refreshExpiresIn > now) {
                                          refreshExpiry = refreshExpiresIn - now;
                                    }

                                    // 缓存访问令牌
                                    await redisClient.setEx(QPAY_TOKEN_KEY, tokenExpiry, token);

                                    // 如果有刷新令牌，也缓存它
                                    if (refreshToken) {
                                          await redisClient.setEx('qpay:refresh_token', refreshExpiry, refreshToken);
                                          logger.info('成功获取并缓存QPay访问令牌和刷新令牌', {
                                                tokenExpiry,
                                                refreshExpiry
                                          });
                                    } else {
                                          logger.info('成功获取并缓存QPay访问令牌（无刷新令牌）');
                                    }

                                    return token;
                              } finally {
                                    // 释放锁
                                    logger.info('释放QPay令牌锁');
                                    await redisClient.del(QPAY_TOKEN_LOCK_KEY);
                              }
                        }

                        // 锁获取失败，重试
                        logger.info(`等待获取QPay令牌锁，重试次数: ${retryCount + 1}/${MAX_TOKEN_RETRY}`);
                        await new Promise(resolve => setTimeout(resolve, 1000));

                        // 重试前再次检查是否已缓存令牌
                        const refreshedToken = await redisClient.get(QPAY_TOKEN_KEY);
                        if (refreshedToken) {
                              logger.info('等待期间已获取到QPay令牌');
                              return refreshedToken;
                        }

                        retryCount++;
                  }

                  // 超过最大重试次数
                  logger.error('获取QPay令牌锁失败，已达最大重试次数');
                  throw new Error('无法获取QPay令牌，请稍后再试');
            } catch (error: any) {
                  logger.error('获取QPay访问令牌失败', {
                        error: error.message,
                        stack: error.stack,
                        requestTime: new Date().toISOString(),
                        retries: retryCount
                  });
                  throw new Error(`获取QPay访问令牌失败: ${error.message}`);
            }
      }

      async refreshAccessToken(refreshToken: string): Promise<any> {
            try {
                  // 新增：检查刷新令牌是否过期
                  const refreshTokenExpiry = await redisClient.get('qpay:refresh_token:expiry');
                  const now = Math.floor(Date.now() / 1000);

                  // 如果存在过期时间且已过期，则直接抛出异常
                  if (refreshTokenExpiry && parseInt(refreshTokenExpiry) <= now) {
                        logger.warn('刷新令牌已过期，将删除并重新获取令牌');
                        // 删除过期的刷新令牌和过期时间
                        await Promise.all([
                              redisClient.del('qpay:refresh_token'),
                              redisClient.del('qpay:refresh_token:expiry')
                        ]);
                        throw new Error('刷新令牌已过期');
                  }

                  logger.info('开始刷新QPay访问令牌');

                  const response = await axios.post(
                        `${QPAY_API_URL}/auth/refresh`,
                        { refresh_token: refreshToken },
                        {
                              headers: {
                                    'Content-Type': 'application/json'
                              }
                        }
                  );

                  logger.info('QPay令牌刷新成功');

                  // 缓存新令牌
                  const newToken = response.data.access_token;
                  const newRefreshToken = response.data.refresh_token;
                  const expiresIn = response.data.expires_in;
                  const refreshExpiresIn = response.data.refresh_expires_in;



                  // 设置过期时间（同 getAccessToken 方法）
                  let tokenExpiry = QPAY_TOKEN_EXPIRY; // 默认值
                  if (expiresIn && expiresIn > now) {
                        tokenExpiry = expiresIn - now - 300;
                  }

                  let refreshExpiry = QPAY_TOKEN_EXPIRY * 2; // 默认值
                  if (refreshExpiresIn && refreshExpiresIn > now) {
                        refreshExpiry = refreshExpiresIn - now;
                  }


                  // 存储令牌和刷新令牌
                  await redisClient.setEx(QPAY_TOKEN_KEY, tokenExpiry, newToken);
                  await redisClient.setEx('qpay:refresh_token', refreshExpiry, newRefreshToken);

                  return {
                        accessToken: newToken,
                        refreshToken: newRefreshToken
                  };
            } catch (error: any) {
                  logger.error('刷新QPay令牌失败', { error: error.message });
                  throw new Error(`刷新QPay令牌失败: ${error.message}`);
            }
      }

      /**
       * 为订单创建QPay发票
       * @param orderId 订单ID
       * @returns 发票信息
       */
      async createInvoice(orderId: string): Promise<any> {
            try {
                  // 获取订单详情
                  const order = await prisma.order.findUnique({
                        where: { id: orderId },
                        include: {
                              orderItems: true
                        }
                  });

                  if (!order) {
                        throw new Error('订单不存在');
                  }

                  if (order.orderStatus !== OrderStatus.PENDING_PAYMENT) {
                        throw new Error('订单状态不允许支付');
                  }

                  // 1. 首先检查是否存在未过期的待支付发票
                  const now = new Date();
                  const existingValidInvoice = await prisma.qPayInvoice.findFirst({
                        where: {
                              orderId,
                              status: 'PENDING',
                              expiresAt: {
                                    gt: now // 确保未过期
                              }
                        }
                  });

                  if (existingValidInvoice) {
                        logger.info(`使用订单 ${orderId} 的现有未过期发票`, { invoiceId: existingValidInvoice.invoiceId });
                        // 返回现有发票信息
                        return {
                              invoiceId: existingValidInvoice.invoiceId,
                              qrImage: existingValidInvoice.qrImage,
                              qrText: existingValidInvoice.qrText,
                              qPayShortUrl: existingValidInvoice.qPayShortUrl,
                              urls: existingValidInvoice.urls,
                              expiresAt: existingValidInvoice.expiresAt
                        };
                  }

                  // 2. 更新已过期但仍为PENDING的发票状态
                  const expiredInvoices = await prisma.qPayInvoice.findMany({
                        where: {
                              orderId,
                              status: 'PENDING',
                              expiresAt: {
                                    lte: now
                              }
                        }
                  });

                  if (expiredInvoices.length > 0) {
                        logger.info(`将订单 ${orderId} 的过期发票更新为EXPIRED状态`, { count: expiredInvoices.length });
                        await prisma.qPayInvoice.updateMany({
                              where: {
                                    id: {
                                          in: expiredInvoices.map(inv => inv.id)
                                    }
                              },
                              data: {
                                    status: 'EXPIRED'
                              }
                        });
                  }

                  // 3. 获取QPay令牌
                  const token = await this.getAccessToken();

                  // 4. 准备带订单ID的回调URL
                  const callbackUrl = `${QPAY_CALLBACK_URL}?order_id=${orderId}`;

                  // 5. 创建发票payload
                  const payload = {
                        invoice_code: QPAY_INVOICE_CODE,
                        sender_invoice_no: `${order.orderNo}_${Date.now().toString().substring(8)}`, // 添加时间戳后缀确保唯一性
                        invoice_receiver_code: "terminal",
                        invoice_description: `Payment for order ${order.orderNo}`,
                        amount: order.paymentAmount,
                        callback_url: callbackUrl
                  };

                  logger.info('开始创建QPay发票', {
                        orderId,
                        orderNo: order.orderNo,
                        amount: payload.amount,
                        requestTime: new Date().toISOString()
                  });

                  // 6. 调用QPay API创建发票
                  const response = await axios.post(
                        `${QPAY_API_URL}/invoice`,
                        payload,
                        {
                              headers: {
                                    'Authorization': `Bearer ${token}`,
                                    'Content-Type': 'application/json'
                              }
                        }
                  );

                  logger.info('QPay创建发票API响应', {
                        status: response.status,
                        invoiceId: response.data.invoice_id,
                        orderId,
                        responseTime: new Date().toISOString()
                  });

                  if (!response.data || !response.data.invoice_id) {
                        throw new Error('创建QPay发票失败');
                  }

                  // 7. 提取发票信息
                  const invoiceData = {
                        invoiceId: response.data.invoice_id,
                        qrImage: response.data.qr_image,
                        qrText: response.data.qr_text,
                        qPayShortUrl: response.data.qPay_shortUrl,
                        urls: response.data.urls
                  };

                  // 8. 计算过期时间（通常为15分钟）
                  const expiresAt = new Date();
                  expiresAt.setMinutes(expiresAt.getMinutes() + 15);

                  // 9. 将发票保存到数据库
                  await prisma.qPayInvoice.create({
                        data: {
                              orderId,
                              invoiceId: invoiceData.invoiceId,
                              qrImage: invoiceData.qrImage,
                              qrText: invoiceData.qrText,
                              qPayShortUrl: invoiceData.qPayShortUrl,
                              urls: invoiceData.urls,
                              status: 'PENDING',
                              expiresAt
                        }
                  });

                  logger.info(`为订单 ${orderId} 创建了新的QPay发票`, { invoiceId: invoiceData.invoiceId });

                  // 10. 添加过期时间到响应
                  return {
                        ...invoiceData,
                        expiresAt
                  };
            } catch (error: any) {
                  logger.error('创建QPay发票失败', { error: error.message, orderId });
                  throw new Error(`创建QPay发票失败: ${error.message}`);
            }
      }

      /**
       * 检查支付状态
       * @param orderId 订单ID
       * @returns 支付状态信息
       */
      async checkPaymentStatus(orderId: string): Promise<any> {
            try {
                  // 首先检查是否已有成功的回调记录
                  const callback = await prisma.qPayCallback.findFirst({
                        where: {
                              orderId,
                              status: 'PROCESSED'
                        },
                        orderBy: {
                              createdAt: 'desc'
                        }
                  });

                  if (callback) {
                        // 已经处理过回调，返回支付完成
                        return {
                              status: 'PAID', // 使用枚举值而非isPaid
                              message: '支付成功',
                              orderId,
                              paymentId: callback.paymentId
                        };
                  }

                  // 检查是否有失败的回调
                  const failedCallback = await prisma.qPayCallback.findFirst({
                        where: {
                              orderId,
                              status: 'FAILED'
                        },
                        orderBy: {
                              createdAt: 'desc'
                        }
                  });

                  if (failedCallback) {
                        return {
                              status: 'CANCELLED', // 使用枚举值
                              message: '支付处理失败',
                              orderId,
                              paymentId: failedCallback.paymentId
                        };
                  }

                  // 从数据库获取发票信息
                  const invoice = await prisma.qPayInvoice.findFirst({
                        where: {
                              orderId,
                              status: 'PENDING'
                        }
                  });

                  if (!invoice) {
                        throw new Error('找不到该订单的QPay发票');
                  }

                  // 检查发票是否过期
                  if (new Date() > invoice.expiresAt) {
                        await prisma.qPayInvoice.update({
                              where: { id: invoice.id },
                              data: { status: 'EXPIRED' }
                        });
                        return {
                              status: 'EXPIRED', // 使用枚举值
                              message: '支付已过期',
                              orderId,
                              invoiceId: invoice.invoiceId
                        };
                  }

                  // 只返回等待支付状态，不调用QPay API
                  return {
                        status: 'PENDING', // 使用枚举值
                        message: '等待支付中',
                        orderId,
                        invoiceId: invoice.invoiceId
                  };
            } catch (error: any) {
                  logger.error('检查QPay支付状态失败', { error: error.message, orderId });
                  throw new Error(`检查QPay支付状态失败: ${error.message}`);
            }
      }

      /**
       * 处理支付回调
       * @param orderId 订单ID
       * @param paymentId 支付ID
       * @param callbackData 回调数据
       * @returns 处理结果
       */
      async processCallback(orderId: string, paymentId: string, callbackData: any): Promise<any> {
            try {
                  // 幂等性检查：检查是否已有成功处理的回调记录
                  const existingCallback = await prisma.qPayCallback.findFirst({
                        where: {
                              orderId,
                              paymentId,
                              status: 'PROCESSED'
                        }
                  });

                  if (existingCallback) {
                        logger.info('QPay回调已处理，跳过重复处理', { orderId, paymentId });
                        return {
                              success: true,
                              message: '支付已处理',
                              duplicate: true
                        };
                  }

                  // 将回调记录到数据库
                  const callback = await prisma.qPayCallback.create({
                        data: {
                              orderId,
                              paymentId,
                              callbackData: JSON.stringify(callbackData),
                              status: 'RECEIVED'
                        }
                  });

                  // 获取订单信息
                  const order = await prisma.order.findUnique({
                        where: { id: orderId }
                  });

                  if (!order) {
                        logger.error('处理QPay回调时找不到订单', { orderId, paymentId });
                        await prisma.qPayCallback.update({
                              where: { id: callback.id },
                              data: {
                                    status: 'FAILED',
                                    error: '找不到订单'
                              }
                        });
                        return {
                              success: false,
                              message: '找不到订单'
                        };
                  }

                  // 更新发票状态
                  await prisma.qPayInvoice.updateMany({
                        where: {
                              orderId,
                              status: 'PENDING'
                        },
                        data: {
                              status: 'PAID',
                              paymentId
                        }
                  });

                  // 在事务中更新订单状态
                  await prisma.$transaction(async (tx) => {
                        // 更新订单状态
                        await tx.order.update({
                              where: { id: orderId },
                              data: {
                                    orderStatus: OrderStatus.PENDING_SHIPMENT,
                                    paymentStatus: PaymentStatus.PAID
                              }
                        });

                        // 创建支付日志
                        await tx.paymentLog.create({
                              data: {
                                    orderId,
                                    amount: order.paymentAmount,
                                    paymentType: 'qpay',
                                    transactionId: paymentId,
                                    status: 1
                              }
                        });

                        // 更新回调状态
                        await tx.qPayCallback.update({
                              where: { id: callback.id },
                              data: { status: 'PROCESSED' }
                        });
                  });

                  // 支付成功后通过队列处理后续库存确认扣减等任务
                  await orderQueue.add('processPostPayment', {
                        orderId: order.id,
                        orderNo: order.orderNo,
                        orderItems: await prisma.orderItem.findMany({
                              where: { orderId: order.id },
                              select: {
                                    id: true,
                                    skuId: true,
                                    quantity: true
                              }
                        })
                  }, {
                        attempts: 3,
                        backoff: {
                              type: 'exponential',
                              delay: 2000
                        }
                  });

                  logger.info(`成功处理订单 ${orderId} 的QPay支付回调`, { paymentId });

                  // 添加：清理订单缓存
                  await cacheUtils.invalidateModuleCache('order', orderId);

                  return {
                        success: true,
                        message: '支付成功处理'
                  };
            } catch (error: any) {
                  logger.error('处理QPay回调失败', {
                        error: error.message,
                        stack: error.stack,
                        orderId,
                        paymentId
                  });

                  // 更新回调状态为失败
                  await prisma.qPayCallback.updateMany({
                        where: {
                              orderId,
                              paymentId,
                              status: 'RECEIVED' // 只更新未处理的回调
                        },
                        data: {
                              status: 'FAILED',
                              error: error.message
                        }
                  });

                  throw new Error(`处理QPay回调失败: ${error.message}`);
            }
      }

      /**
       * 处理从QPay收到的支付
       * @param orderId 订单ID
       * @param invoiceId 发票ID
       * @param paymentData 支付数据
       * @returns 处理结果
       */
      private async processPayment(orderId: string, invoiceId: string, paymentData: any): Promise<any> {
            try {
                  // 获取订单信息
                  const order = await prisma.order.findUnique({
                        where: { id: orderId }
                  });

                  if (!order) {
                        throw new Error('找不到订单');
                  }

                  // 获取支付ID
                  const paymentId = paymentData.payment_id;

                  // 检查是否已处理此支付
                  const existingCallback = await prisma.qPayCallback.findFirst({
                        where: {
                              orderId,
                              paymentId
                        }
                  });

                  if (existingCallback) {
                        // 已处理
                        return {
                              success: true,
                              message: '支付已处理',
                              paymentId
                        };
                  }

                  // 创建人工回调数据
                  const callbackData = {
                        payment_id: paymentId,
                        payment_status: 'SUCCESS',
                        amount: paymentData.amount,
                        invoice_id: invoiceId,
                        payment_date: new Date().toISOString()
                  };

                  // 像处理回调一样处理支付
                  return await this.processCallback(orderId, paymentId, callbackData);
            } catch (error: any) {
                  logger.error('处理QPay支付失败', { error: error.message, orderId, invoiceId });
                  throw new Error(`处理QPay支付失败: ${error.message}`);
            }
      }

      /**
       * 取消发票
       * @param invoiceId 发票ID
       * @returns 取消结果
       */
      async cancelInvoice(invoiceId: string): Promise<any> {
            try {
                  // 获取QPay令牌
                  const token = await this.getAccessToken();

                  // 调用QPay API取消发票
                  const response = await axios.delete(
                        `${QPAY_API_URL}/invoice/${invoiceId}`,
                        {
                              headers: {
                                    'Authorization': `Bearer ${token}`
                              }
                        }
                  );

                  logger.info(`成功取消QPay发票 ${invoiceId}`);

                  return {
                        success: true,
                        message: '发票已取消'
                  };
            } catch (error: any) {
                  logger.error('取消QPay发票失败', { error: error.message, invoiceId });
                  throw new Error(`取消QPay发票失败: ${error.message}`);
            }
      }
}

export const qpayService = new QPayService();