// src/validators/shop/temp-order.validator.ts
import { z } from 'zod';

// 创建临时订单验证
export const createTempOrderSchema = z.object({
      body: z.object({
            // 订单模式：购物车结算或直接购买
            mode: z.enum(['cart', 'quick-buy'], {
                  errorMap: () => ({ message: '订单模式必须为"cart"或"quick-buy"' })
            }),

            // 购物车模式下的购物车项ID数组
            cartItemIds: z.array(
                  z.number().int().positive('购物车项ID必须为正整数')
            ).optional(),

            // 直接购买模式下的商品信息
            productInfo: z.object({
                  productId: z.number().int().positive('商品ID必须为正整数'),
                  skuId: z.number().int().positive('SKU ID必须为正整数'),
                  quantity: z.number().int().positive('数量必须为正整数')
            }).optional()
      }).refine(data => {
            // 确保根据模式提供了正确的参数
            if (data.mode === 'cart' && (!data.cartItemIds || data.cartItemIds.length === 0)) {
                  return false;
            }
            if (data.mode === 'quick-buy' && !data.productInfo) {
                  return false;
            }
            return true;
      }, {
            message: '购物车模式下必须提供购物车项ID数组，直接购买模式下必须提供商品信息'
      })
});

// 更新临时订单验证
export const updateTempOrderSchema = z.object({
      params: z.object({
            id: z.string().uuid('无效的临时订单ID')
      }),
      body: z.object({
            // 收货地址ID
            addressId: z.number().int().positive('地址ID必须为正整数').optional(),

            // 支付方式
            paymentType: z.string().optional(),

            // 订单备注
            remark: z.string().max(200, '备注不能超过200个字符').optional()
      }).refine(data => {
            // 至少需要提供一个更新字段
            return Object.keys(data).length > 0;
      }, {
            message: '请提供至少一个需要更新的字段'
      })
});

// 确认临时订单验证
export const confirmTempOrderSchema = z.object({
      params: z.object({
            id: z.string().uuid('无效的临时订单ID')
      })
});

// 获取临时订单验证
export const getTempOrderSchema = z.object({
      params: z.object({
            id: z.string().uuid('无效的临时订单ID')
      })
});

// 刷新临时订单有效期验证
export const refreshTempOrderSchema = z.object({
      params: z.object({
            id: z.string().uuid('无效的临时订单ID')
      })
});

// 新增：获取结账信息验证
export const getCheckoutInfoSchema = z.object({
      // 无需验证任何参数
      query: z.object({}).optional()
});

// 更新并确认临时订单验证
export const updateAndConfirmTempOrderSchema = z.object({
      params: z.object({
            id: z.string().uuid('无效的临时订单ID')
      }),
      body: z.object({
            // 收货地址ID
            addressId: z.number().int().positive('地址ID必须为正整数').optional(),

            // 支付方式
            paymentType: z.string().optional(),

            // 订单备注
            remark: z.string().max(200, '备注不能超过200个字符').optional()
      })
});