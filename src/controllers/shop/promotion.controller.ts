// src/controllers/shop/promotion.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { cacheUtils } from '../../utils/cache.utils';

export const promotionController = {
  // 获取当前可用的满减规则
  getAvailablePromotions: asyncHandler(async (req: Request, res: Response) => {
    // 添加自适应缓存，根据流量调整缓存时间
    const cacheKey = 'promotions:available';
    const promotions = await cacheUtils.adaptiveCaching(
      cacheKey,
      async () => {
        const now = new Date();
        return await prisma.promotion.findMany({
          where: {
            isActive: true,
            startTime: { lte: now },
            endTime: { gte: now }
          },
          orderBy: {
            thresholdAmount: 'asc'
          }
        });
      },
      'MEDIUM',  // 基础缓存级别
      'medium'   // 当前流量等级
    );

    res.sendSuccess(promotions);
  }),

  // 检查特定金额可用的满减规则
  checkEligiblePromotion: asyncHandler(async (req: Request, res: Response) => {
    const { amount } = req.query;
    const totalAmount = parseInt(amount as string);

    if (isNaN(totalAmount) || totalAmount <= 0) {
      return res.sendSuccess(null, 'No available promotions');
    }

    const now = new Date();
    const promotion = await prisma.promotion.findFirst({
      where: {
        isActive: true,
        startTime: { lte: now },
        endTime: { gte: now },
        thresholdAmount: { lte: totalAmount }
      },
      orderBy: {
        thresholdAmount: 'desc' // 选择满足条件的最高阈值规则
      }
    });

    if (!promotion) {
      return res.sendSuccess(null, '无可用优惠');
    }

    // 计算具体折扣金额
    let discountAmount = 0;
    if (promotion.type === 'AMOUNT_OFF') {
      discountAmount = promotion.discountAmount;
    } else if (promotion.type === 'PERCENT_OFF') {
      discountAmount = Math.floor(totalAmount * (promotion.discountAmount / 100));
    }

    // 确保折扣金额不超过订单总金额
    discountAmount = Math.min(discountAmount, totalAmount);

    res.sendSuccess({
      promotion,
      discountAmount,
      finalAmount: totalAmount - discountAmount
    });
  })
};