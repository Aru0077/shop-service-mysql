// src/validators/shop/favorite.validator.ts
import { z } from 'zod';

// 收藏商品验证
export const addFavoriteSchema = z.object({
      body: z.object({
            productId: z.number()
                  .int('商品ID必须为整数')
                  .positive('商品ID必须为正数')
      })
});

// 取消收藏商品验证
export const removeFavoriteSchema = z.object({
      params: z.object({
            productId: z.string()
                  .regex(/^\d+$/, '无效的商品ID')
      })
});

// 批量取消收藏商品验证
export const batchRemoveFavoritesSchema = z.object({
      body: z.object({
            productIds: z.array(
                  z.number()
                        .int('商品ID必须为整数')
                        .positive('商品ID必须为正数')
            )
                  .min(1, '至少需要提供一个商品ID')
      })
});

// 获取收藏商品列表验证
export const getFavoritesSchema = z.object({
      query: z.object({
            page: z.string()
                  .regex(/^\d+$/, '页码必须为数字')
                  .transform(Number)
                  .refine(val => val >= 1, '页码必须大于0')
                  .optional()
                  .default('1'),
            limit: z.string()
                  .regex(/^\d+$/, '每页数量必须为数字')
                  .transform(Number)
                  .refine(val => val >= 1 && val <= 50, '每页数量必须在1-50之间')
                  .optional()
                  .default('10')
      })
});