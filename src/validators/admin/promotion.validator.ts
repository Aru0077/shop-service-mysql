// src/validators/admin/promotion.validator.ts
import { z } from 'zod';

// 基础满减规则字段验证
const basePromotionSchema = {
  name: z.string()
    .min(2, '规则名称不能少于2个字符')
    .max(100, '规则名称不能超过100个字符'),
  description: z.string().optional(),
  type: z.enum(['AMOUNT_OFF', 'PERCENT_OFF'], { 
    errorMap: () => ({ message: '类型必须是 AMOUNT_OFF 或 PERCENT_OFF' })
  }),
  thresholdAmount: z.number()
    .int('阈值金额必须为整数')
    .positive('阈值金额必须为正数'),
  discountAmount: z.number()
    .int('优惠金额必须为整数')
    .positive('优惠金额必须为正数'),
  startTime: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(.\d{3})?Z?$/, '开始时间格式不正确'),
  endTime: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(.\d{3})?Z?$/, '结束时间格式不正确'),
  isActive: z.boolean().optional().default(true)
};

// 创建满减规则验证
export const createPromotionSchema = z.object({
  body: z.object(basePromotionSchema)
});

// 更新满减规则验证
export const updatePromotionSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, '无效的规则ID')
  }),
  body: z.object({
    ...Object.fromEntries(
      Object.entries(basePromotionSchema).map(([key, schema]) => [key, schema.optional()])
    )
  })
});

// 获取满减规则列表验证
export const getPromotionListSchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/, '页码必须为数字').optional(),
    limit: z.string().regex(/^\d+$/, '每页数量必须为数字').optional(),
    isActive: z.string().optional()
  })
});

// 获取单个满减规则验证
export const getPromotionDetailSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, '无效的规则ID')
  })
});

// 删除满减规则验证
export const deletePromotionSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, '无效的规则ID')
  })
});

// 启用/禁用满减规则验证
export const togglePromotionStatusSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, '无效的规则ID')
  }),
  body: z.object({
    isActive: z.boolean({ 
      required_error: "状态是必需的", 
      invalid_type_error: "状态必须是布尔值" 
    })
  })
});