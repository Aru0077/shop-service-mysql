// src/validators/category.validator.ts
import { z } from 'zod';

const nameSchema = z.string()
      .min(2, '分类名称不能少于2个字符')
      .max(50, '分类名称不能超过50个字符');

// 创建分类验证
export const createCategorySchema = z.object({
      body: z.object({
            name: nameSchema,
            parentId: z.number()
                  .int()
                  .nonnegative('父级ID不能为负数')
                  .default(0),
      }),
});

// 更新分类验证
export const updateCategorySchema = z.object({
      params: z.object({
            id: z.string().regex(/^\d+$/, '无效的ID'),
      }),
      body: z.object({
            name: nameSchema,
            parentId: z.number()
                  .int()
                  .nonnegative('父级ID不能为负数')
                  .optional(),
      }),
});

// 删除分类验证
export const deleteCategorySchema = z.object({
      params: z.object({
            id: z.string().regex(/^\d+$/, '无效的ID'),
      }),
});