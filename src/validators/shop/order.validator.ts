// src/validators/shop/order.validator.ts
import { z } from 'zod';

// 创建订单验证
export const createOrderSchema = z.object({
      body: z.object({
            addressId: z.number().int().positive('地址ID必须为正整数'),
            cartItemIds: z.array(z.number().int().positive('购物车项ID必须为正整数')),
            remark: z.string().max(200, '备注不能超过200个字符').optional()
      })
});

// 快速购买验证
export const quickBuySchema = z.object({
      body: z.object({
            productId: z.number().int().positive('商品ID必须为正整数'),
            skuId: z.number().int().positive('SKU ID必须为正整数'),
            quantity: z.number().int().positive('数量必须为正整数'),
            addressId: z.number().int().positive('地址ID必须为正整数'),
            remark: z.string().max(200, '备注不能超过200个字符').optional()
      })
});

// 获取订单列表验证
export const getOrderListSchema = z.object({
      query: z.object({
            page: z.string().regex(/^\d+$/, '页码必须为数字').optional().default('1'),
            limit: z.string().regex(/^\d+$/, '每页数量必须为数字').optional().default('10'),
            status: z.string().regex(/^\d+$/, '状态必须为数字').optional()
      })
});

// 获取订单详情验证
export const getOrderDetailSchema = z.object({
      params: z.object({
            id: z.string().uuid('无效的订单ID')
      })
});

// 订单支付验证
export const payOrderSchema = z.object({
      params: z.object({
            id: z.string().uuid('无效的订单ID')
      }),
      body: z.object({
            paymentType: z.string().min(1, '支付方式不能为空'),
            transactionId: z.string().optional()
      })
});