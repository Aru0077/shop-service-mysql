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

class QPayService {
      /**
       * 获取QPay访问令牌，带缓存和并发控制
       * @returns 访问令牌
       */
      async getAccessToken(): Promise<string> {
            try {
                  // 先尝试从缓存获取令牌
                  const cachedToken = await redisClient.get(QPAY_TOKEN_KEY);
                  if (cachedToken) {
                        return cachedToken;
                  }

                  // 尝试获取令牌刷新锁
                  const lockAcquired = await redisClient.set(QPAY_TOKEN_LOCK_KEY, '1', {
                        NX: true,
                        EX: 30 // 30秒锁定时间
                  });

                  if (!lockAcquired) {
                        // 其他请求正在刷新令牌，等待后重试
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        // 检查等待期间是否已刷新令牌
                        const refreshedToken = await redisClient.get(QPAY_TOKEN_KEY);
                        if (refreshedToken) {
                              return refreshedToken;
                        }
                        // 仍无令牌，抛出错误
                        throw new Error('无法获取QPay令牌，请稍后再试');
                  }

                  try {
                        // 调用API获取令牌
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

                        // 提取响应中的令牌
                        const token = response.data.access_token;
                        if (!token) {
                              throw new Error('QPay未返回有效的访问令牌');
                        }

                        // 缓存令牌
                        await redisClient.setEx(QPAY_TOKEN_KEY, QPAY_TOKEN_EXPIRY, token);

                        logger.info('成功获取QPay访问令牌');
                        return token;
                  } finally {
                        // 释放锁
                        await redisClient.del(QPAY_TOKEN_LOCK_KEY);
                  }
            } catch (error: any) {
                  logger.error('获取QPay访问令牌失败', { error: error.message });
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
                              isPaid: true,
                              paymentId: callback.paymentId,
                              callbackData: JSON.parse(callback.callbackData),
                              processedAt: callback.createdAt
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
                              isPaid: false,
                              isExpired: true,
                              message: '支付已过期'
                        };
                  }

                  // 获取QPay令牌
                  const token = await this.getAccessToken();

                  // 调用QPay API检查支付状态
                  const response = await axios.post(
                        `${QPAY_HOST}/v2/payment/check`,
                        {
                              object_type: 'INVOICE',
                              object_id: invoice.invoiceId,
                              offset: {
                                    page_number: 1,
                                    page_limit: 100
                              }
                        },
                        {
                              headers: {
                                    'Authorization': `Bearer ${token}`,
                                    'Content-Type': 'application/json'
                              }
                        }
                  );

                  // 提取支付信息
                  const payments = response.data?.rows || [];

                  if (payments.length > 0) {
                        // 存在支付，处理它
                        const latestPayment = payments[0];

                        // 记录支付信息
                        await this.processPayment(orderId, invoice.invoiceId, latestPayment);

                        return {
                              isPaid: true,
                              paymentId: latestPayment.payment_id,
                              paymentData: latestPayment
                        };
                  }

                  // 未找到支付
                  return {
                        isPaid: false,
                        isExpired: false,
                        message: '等待支付中'
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
                  logger.error('处理QPay回调失败', { error: error.message, orderId, paymentId });

                  // 更新回调状态为失败
                  await prisma.qPayCallback.updateMany({
                        where: {
                              orderId,
                              paymentId
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