// src/validators/shop/promotion.validator.ts
import { z } from 'zod';

// 检查特定金额可用的满减规则验证
export const checkEligiblePromotionSchema = z.object({
  query: z.object({
    amount: z.string()
      .regex(/^\d+$/, '金额必须为数字')
      .transform(Number)
      .refine(val => val > 0, '金额必须大于0')
  })
});