// src/controllers/shop/checkout.controller.ts

import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { cacheUtils } from '../../utils/cache.utils';

export const checkoutController = {
      // 获取订单确认页所需的所有信息
      getCheckoutInfo: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 并行获取所有需要的数据
            const [addresses, availablePromotions, recentOrders] = await Promise.all([
                  // 获取用户地址，默认地址排在前面
                  prisma.userAddress.findMany({
                        where: { userId },
                        orderBy: [
                              { isDefault: 'desc' },
                              { updatedAt: 'desc' }
                        ],
                        take: 3 // 只取最近使用的3个地址
                  }),

                  // 获取可用的满减规则
                  prisma.promotion.findMany({
                        where: {
                              isActive: true,
                              startTime: { lte: new Date() },
                              endTime: { gte: new Date() }
                        },
                        orderBy: {
                              thresholdAmount: 'asc'
                        }
                  }),

                  // 获取用户最近的订单用于展示支付偏好
                  prisma.order.findMany({
                        where: {
                              userId,
                              paymentStatus: 1 // 已支付
                        },
                        include: {
                              paymentLogs: {
                                    select: {
                                          paymentType: true
                                    },
                                    orderBy: {
                                          createdAt: 'desc'
                                    },
                                    take: 1
                              }
                        },
                        orderBy: {
                              createdAt: 'desc'
                        },
                        take: 1
                  })
            ]);

            // 提取用户偏好的支付方式
            let preferredPaymentType = 'wechat'; // 默认支付方式
            if (recentOrders.length > 0 && recentOrders[0].paymentLogs.length > 0) {
                  preferredPaymentType = recentOrders[0].paymentLogs[0].paymentType;
            }

            // 构建响应数据
            const checkoutInfo = {
                  addresses,
                  defaultAddressId: addresses.length > 0 ?
                        addresses.find(addr => addr.isDefault === 1)?.id || addresses[0].id
                        : null,
                  availablePromotions,
                  preferredPaymentType,
                  paymentMethods: [
                        { id: 'wechat', name: '微信支付' },
                        { id: 'alipay', name: '支付宝' },
                        { id: 'unionpay', name: '银联支付' }
                  ]
            };

            res.sendSuccess(checkoutInfo);
      })
};