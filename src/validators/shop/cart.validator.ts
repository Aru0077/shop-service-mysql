// src/validators/shop/cart.validator.ts
import { z } from 'zod';

// 添加商品到购物车验证
export const addCartItemSchema = z.object({
      body: z.object({
            productId: z.number().int().positive('商品ID必须为正整数'),
            skuId: z.number().int().positive('SKU ID必须为正整数'),
            quantity: z.number().int().positive('数量必须为正整数').default(1)
      })
});

// 更新购物车商品数量验证
export const updateCartItemSchema = z.object({
      params: z.object({
            id: z.string().regex(/^\d+$/, '无效的购物车项ID')
      }),
      body: z.object({
            quantity: z.number().int().positive('数量必须为正整数')
      })
});

// 删除购物车商品验证
export const deleteCartItemSchema = z.object({
      params: z.object({
            id: z.string().regex(/^\d+$/, '无效的购物车项ID')
      })
});

// 获取购物车列表验证
export const getCartListSchema = z.object({
      query: z.object({
            page: z.string().regex(/^\d+$/, '页码必须为数字').optional().default('1'),
            limit: z.string().regex(/^\d+$/, '每页数量必须为数字').optional().default('10')
      })
});

// 预览订单金额验证
export const previewOrderSchema = z.object({
      body: z.object({
            cartItemIds: z.array(z.number().int().positive('购物车项ID必须为正整数'))
                  .min(1, '至少需要选择一个商品')
      })
});

