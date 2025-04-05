// src/services/qpay.service.ts
import axios from 'axios';
import { redisClient, prisma } from '../config';
import { OrderStatus, PaymentStatus } from '../constants/orderStatus.enum';
import { logger } from '../utils/logger';
import { orderQueue } from '../queues/order.queue';

// QPay配置常量
const QPAY_HOST = process.env.QPAY_HOST || 'https://merchant.qpay.mn';
const QPAY_CLIENT_ID = process.env.QPAY_CLIENT_ID || 'TEST_MERCHANT';
const QPAY_CLIENT_SECRET = process.env.QPAY_CLIENT_SECRET || 'WBDUzy8n';
const QPAY_INVOICE_CODE = process.env.QPAY_INVOICE_CODE || 'TEST_INVOICE';
const QPAY_CALLBACK_URL = process.env.QPAY_CALLBACK_URL || 'https://api.uni-mall-mn.shop/v1/shop/qpay/callback';

// Redis缓存键
const QPAY_TOKEN_KEY = 'qpay:token';
const QPAY_TOKEN_LOCK_KEY = 'qpay:token:lock';
const QPAY_TOKEN_EXPIRY = 86400; // 24小时缓存

const MAX_TOKEN_RETRY = 3;

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
                                          `${QPAY_HOST}/v2/auth/token`,
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
                                    if (!token) {
                                          logger.error('QPay未返回有效的访问令牌', { response: response.data });
                                          throw new Error('QPay未返回有效的访问令牌');
                                    }

                                    // 缓存令牌
                                    await redisClient.setEx(QPAY_TOKEN_KEY, QPAY_TOKEN_EXPIRY, token);

                                    logger.info('成功获取并缓存QPay访问令牌');
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

                  // 检查是否已存在发票
                  const existingInvoice = await prisma.qPayInvoice.findFirst({
                        where: {
                              orderId,
                              status: 'PENDING'
                        }
                  });

                  if (existingInvoice) {
                        // 返回现有发票信息
                        return {
                              invoiceId: existingInvoice.invoiceId,
                              qrImage: existingInvoice.qrImage,
                              qrText: existingInvoice.qrText,
                              qPayShortUrl: existingInvoice.qPayShortUrl,
                              urls: existingInvoice.urls,
                              expiresAt: existingInvoice.expiresAt
                        };
                  }

                  // 获取QPay令牌
                  const token = await this.getAccessToken();

                  // 准备带订单ID的回调URL
                  const callbackUrl = `${QPAY_CALLBACK_URL}?order_id=${orderId}`;

                  // 创建发票payload
                  const payload = {
                        invoice_code: QPAY_INVOICE_CODE,
                        sender_invoice_no: `${order.orderNo}`, // 必须唯一
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

                  // 调用QPay API创建发票
                  const response = await axios.post(
                        `${QPAY_HOST}/v2/invoice`,
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

                  // 提取发票信息
                  const invoiceData = {
                        invoiceId: response.data.invoice_id,
                        qrImage: response.data.qr_image,
                        qrText: response.data.qr_text,
                        qPayShortUrl: response.data.qPay_shortUrl,
                        urls: response.data.urls
                  };

                  // 计算过期时间（通常为15分钟）
                  const expiresAt = new Date();
                  expiresAt.setMinutes(expiresAt.getMinutes() + 15);

                  // 将发票保存到数据库
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

                  logger.info(`为订单 ${orderId} 创建了QPay发票`, { invoiceId: invoiceData.invoiceId });

                  // 添加过期时间到响应
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
                        `${QPAY_HOST}/v2/invoice/${invoiceId}`,
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