// src/validators/spec.validator.ts
import { z } from 'zod';

const nameSchema = z.string()
      .min(2, '规格名称不能少于2个字符')
      .max(50, '规格名称不能超过50个字符');

const valueSchema = z.string()
      .min(1, '规格值不能为空')
      .max(50, '规格值不能超过50个字符');

// 创建规格验证
export const createSpecSchema = z.object({
      body: z.object({
            name: nameSchema,
            values: z.array(valueSchema)
                  .min(1, '至少需要一个规格值')
                  .max(50, '规格值不能超过50个')
      })
});

// 更新规格验证
export const updateSpecSchema = z.object({
      params: z.object({
            id: z.string().regex(/^\d+$/, '无效的ID')
      }),
      body: z.object({
            name: nameSchema.optional(),
            values: z.array(valueSchema).optional()
      })
});

// 删除规格验证
export const deleteSpecSchema = z.object({
      params: z.object({
            id: z.string().regex(/^\d+$/, '无效的ID')
      })
});