// src/validators/shop/product.validator.ts
import { z } from 'zod';

// 分页参数验证
export const paginationSchema = z.object({
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
                  .default('10'),
      }),
});

// 获取分类商品列表验证
export const categoryProductsSchema = z.object({
      params: z.object({
            categoryId: z.string().regex(/^\d+$/, '无效的分类ID'),
      }),
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
                  .default('10'),
            sort: z.enum(['newest', 'price-asc', 'price-desc', 'sales'], {
                  errorMap: () => ({ message: '无效的排序方式' })
            }).optional().default('newest'),
      }),
});

// 获取商品详情验证
export const productDetailSchema = z.object({
      params: z.object({
            id: z.string().regex(/^\d+$/, '无效的商品ID'),
      }),
});