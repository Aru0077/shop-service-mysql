// src/controllers/shop/qpay.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { OrderStatus, PaymentStatus } from '../../constants/orderStatus.enum';
import { qpayService } from '../../services/qpay.service';
import { orderService } from '../../services/order.service';
import { logger } from '../../utils/logger';

export const qpayController = {
      // 创建QPay支付
      createPayment: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { orderId } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 获取订单信息
            const order = await prisma.order.findFirst({
                  where: {
                        id: orderId,
                        userId,
                        paymentStatus: PaymentStatus.UNPAID,
                        orderStatus: OrderStatus.PENDING_PAYMENT
                  }
            });

            if (!order) {
                  throw new AppError(404, 'fail', '订单不存在或状态不正确');
            }

            // 检查订单是否已经有QPay发票
            const existingInvoice = await prisma.qPayInvoice.findFirst({
                  where: {
                        orderId,
                        status: { notIn: ['CANCELLED', 'EXPIRED'] }
                  }
            });

            if (existingInvoice) {
                  // 检查发票是否已支付
                  const paymentStatus = await qpayService.checkPaymentStatus(existingInvoice.invoiceId);

                  if (paymentStatus && paymentStatus.payment_status === 'PAID') {
                        // 如果已支付但状态未更新，更新订单状态
                        await orderService.processOrderPayment(
                              orderId,
                              userId,
                              'qpay',
                              paymentStatus.payment_id
                        );

                        return res.sendSuccess({
                              status: 'PAID',
                              message: '订单已支付',
                              orderId
                        });
                  }

                  // 返回现有发票信息
                  return res.sendSuccess({
                        invoiceId: existingInvoice.invoiceId,
                        qrImage: existingInvoice.qrImage,
                        qrText: existingInvoice.qrText,
                        qPayShortUrl: existingInvoice.qPayShortUrl,
                        urls: existingInvoice.urls,
                        orderId
                  });
            }

            // 创建QPay发票
            const invoiceDescription = `Order #${order.orderNo}`;
            const callbackUrl = `${process.env.QPAY_CALLBACK_URL}?orderId=${orderId}`;

            const invoice = await qpayService.createInvoice(
                  order.paymentAmount,
                  invoiceDescription,
                  order.orderNo,
                  callbackUrl
            );

            if (!invoice) {
                  throw new AppError(500, 'fail', '创建支付发票失败，请稍后重试');
            }

            console.log('QPay发票创建成功', invoice);
            
            // 保存发票信息
            await prisma.qPayInvoice.create({
                  data: {
                        orderId,
                        invoiceId: invoice.invoice_id,
                        qrImage: invoice.qr_image,
                        qrText: invoice.qr_text,
                        qPayShortUrl: invoice.qPay_shortUrl || null,
                        urls: invoice.urls,  
                        status: 'PENDING',
                        expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30分钟有效期
                  }
            });

            // 返回支付信息
            res.sendSuccess({
                  invoiceId: invoice.invoice_id,
                  qrImage: invoice.qr_image,
                  qrText: invoice.qr_text,
                  qPayShortUrl: invoice.qPay_shortUrl || null,
                  urls: invoice.urls ? invoice.urls : null,  
                  orderId
            });
      }),

      // 检查支付状态
      checkPaymentStatus: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { orderId } = req.params;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 获取订单信息
            const order = await prisma.order.findFirst({
                  where: {
                        id: orderId,
                        userId
                  }
            });

            if (!order) {
                  throw new AppError(404, 'fail', '订单不存在');
            }

            // 如果订单已支付，直接返回
            if (order.paymentStatus === PaymentStatus.PAID) {
                  return res.sendSuccess({
                        status: 'PAID',
                        message: '订单已支付',
                        orderId
                  });
            }

            // 获取QPay发票信息
            const invoice = await prisma.qPayInvoice.findFirst({
                  where: {
                        orderId
                  },
                  orderBy: {
                        createdAt: 'desc'
                  }
            });

            if (!invoice) {
                  return res.sendSuccess({
                        status: 'NO_INVOICE',
                        message: '订单未创建支付发票',
                        orderId
                  });
            }

            // 检查支付状态
            const paymentStatus = await qpayService.checkPaymentStatus(invoice.invoiceId);

            if (!paymentStatus) {
                  return res.sendSuccess({
                        status: 'PENDING',
                        message: '支付处理中',
                        orderId,
                        invoiceId: invoice.invoiceId
                  });
            }

            if (paymentStatus.payment_status === 'PAID') {
                  // 更新订单状态
                  try {
                        await orderService.processOrderPayment(
                              orderId,
                              userId,
                              'qpay',
                              paymentStatus.payment_id
                        );

                        // 更新发票状态
                        await prisma.qPayInvoice.update({
                              where: { id: invoice.id },
                              data: { status: 'PAID', paymentId: paymentStatus.payment_id }
                        });

                        return res.sendSuccess({
                              status: 'PAID',
                              message: '订单已支付',
                              orderId,
                              paymentId: paymentStatus.payment_id
                        });
                  } catch (error) {
                        logger.error('处理QPay支付失败', { error, orderId });
                        throw new AppError(500, 'fail', '处理支付失败，请联系客服');
                  }
            }

            // 返回当前状态
            res.sendSuccess({
                  status: paymentStatus.payment_status || 'PENDING',
                  message: '支付处理中',
                  orderId,
                  invoiceId: invoice.invoiceId
            });
      }),

      // 处理QPay回调
      handleCallback: asyncHandler(async (req: Request, res: Response) => {
            const { orderId, payment_id } = req.query;

            if (!orderId) {
                  logger.error('QPay回调缺少orderId', { query: req.query });
                  return res.status(400).send('Missing order ID');
            }

            // 记录回调信息
            logger.info('收到QPay支付回调', { orderId, payment_id, query: req.query });

            // 验证订单是否存在
            const order = await prisma.order.findUnique({
                  where: { id: orderId as string }
            });

            if (!order) {
                  logger.error('QPay回调订单不存在', { orderId });
                  return res.status(404).send('Order not found');
            }

            // 如果订单已支付，直接返回成功
            if (order.paymentStatus === PaymentStatus.PAID) {
                  return res.status(200).send('Payment already processed');
            }

            // 记录回调数据
            await prisma.qPayCallback.create({
                  data: {
                        orderId: orderId as string,
                        paymentId: payment_id as string || null,
                        callbackData: JSON.stringify(req.query),
                        status: 'RECEIVED'
                  }
            });

            // 验证支付状态
            if (payment_id) {
                  try {
                        // 获取支付详情
                        const paymentDetails = await qpayService.getPaymentDetails(payment_id as string);

                        if (paymentDetails && paymentDetails.payment_status === 'PAID') {
                              // 处理订单支付
                              await orderService.processOrderPayment(
                                    orderId as string,
                                    order.userId,
                                    'qpay',
                                    payment_id as string
                              );

                              // 更新发票状态
                              await prisma.qPayInvoice.updateMany({
                                    where: { orderId: orderId as string },
                                    data: { status: 'PAID', paymentId: payment_id as string }
                              });

                              // 更新回调状态
                              await prisma.qPayCallback.update({
                                    where: { id: orderId as string },
                                    data: { status: 'PROCESSED' }
                              });

                              return res.status(200).send('Payment processed successfully');
                        }
                  } catch (error) {
                        logger.error('处理QPay回调失败', { error, orderId, payment_id });

                        // 更新回调状态
                        await prisma.qPayCallback.update({
                              where: { id: orderId as string },
                              data: { status: 'FAILED', error: JSON.stringify(error) }
                        });

                        return res.status(500).send('Error processing payment');
                  }
            }

            // 默认返回成功，避免QPay重复回调
            return res.status(200).send('Callback received');
      })
};