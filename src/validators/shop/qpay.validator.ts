// src/validators/shop/qpay.validator.ts
import { z } from 'zod';

// 创建QPay支付验证
export const createQPaySchema = z.object({
    body: z.object({
        orderId: z.string().uuid('订单ID必须是有效的UUID')
    })
});

// 检查支付状态验证
export const checkPaymentStatusSchema = z.object({
    params: z.object({
        orderId: z.string().uuid('订单ID必须是有效的UUID')
    })
});

// QPay回调验证
export const qpayCallbackSchema = z.object({
    query: z.object({
        order_id: z.string().uuid('订单ID必须是有效的UUID').optional()
    }).optional(),
    body: z.any()
});