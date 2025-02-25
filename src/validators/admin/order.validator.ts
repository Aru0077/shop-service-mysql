// src/validators/order.validator.ts
import { z } from 'zod';
import { OrderStatus } from '../../constants/orderStatus.enum';

// 分页查询订单列表验证
export const getOrdersSchema = z.object({
      query: z.object({
            page: z.string().regex(/^\d+$/, '页码必须为数字').optional(),
            limit: z.string().regex(/^\d+$/, '每页数量必须为数字').optional(),
            orderStatus: z.string().regex(/^\d+$/, '订单状态必须为数字').optional(),
            orderNo: z.string().optional(),
            startDate: z.string().optional(),
            endDate: z.string().optional(),
      }),
});

// 获取订单详情验证
export const getOrderDetailSchema = z.object({
      params: z.object({
            id: z.string().uuid('无效的订单ID'),
      }),
});

// 更新订单状态验证
export const updateOrderStatusSchema = z.object({
      params: z.object({
            id: z.string().uuid('无效的订单ID'),
      }),
      body: z.object({
            orderStatus: z.nativeEnum(OrderStatus, {
                  errorMap: () => ({ message: '无效的订单状态' }),
            }),
            trackingNumber: z.string().optional(),
            remark: z.string().optional(),
      }),
});