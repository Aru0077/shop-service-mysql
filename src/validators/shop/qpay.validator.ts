// src/validators/shop/qpay.validator.ts
import { z } from 'zod';

// 创建QPay支付验证
export const createQPayPaymentSchema = z.object({
      body: z.object({
            orderId: z.string().uuid('无效的订单ID')
      })
});

// 检查QPay支付状态验证
export const checkQPayStatusSchema = z.object({
      params: z.object({
            orderId: z.string().uuid('无效的订单ID')
      })
});