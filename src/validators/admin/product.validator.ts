// src/validators/admin/product.validator.ts
import { z } from 'zod';
import { ProductStatus } from '@prisma/client';

// Common schemas
const nameSchema = z.string()
    .min(1, '商品名称不能为空')
    .max(200, '商品名称不能超过200个字符');

const categoryIdSchema = z.number({
    required_error: "分类ID是必填项",
    invalid_type_error: "分类ID必须是数字"
}).int().positive("分类ID必须是正整数");

const productCodeSchema = z.string()
    .min(1, '商品编码不能为空')
    .max(50, '商品编码不能超过50个字符');

const imageUrlSchema = z.string()
    .url('请输入有效的图片URL')
    .max(255, '图片URL不能超过255个字符')
    .optional()
    .transform(val => val || undefined);

const detailImagesSchema = z.array(
    z.string()
        .url('请输入有效的图片URL')
        .max(255, '图片URL不能超过255个字符')
).nullable().optional()
    .transform(val => val && val.length > 0 ? val : null);

const promotionSchema = z.union([
    z.literal(0),
    z.literal(1)
]).optional()
    .transform(val => val ?? 0);

// Create product schema
export const createProductSchema = z.object({
    body: z.object({
        name: nameSchema,
        categoryId: categoryIdSchema,
        productCode: productCodeSchema,
        content: z.string().optional(),
        mainImage: imageUrlSchema,
        detailImages: detailImagesSchema,
        is_promotion: promotionSchema
    })
});

// Update product schema
export const updateProductSchema = z.object({
    params: z.object({
        id: z.string().regex(/^\d+$/, '无效的商品ID')
    }),
    body: z.object({
        name: nameSchema.optional(),
        categoryId: categoryIdSchema.optional(),
        content: z.string().optional(),
        mainImage: imageUrlSchema,
        detailImages: detailImagesSchema,
        is_promotion: promotionSchema
    })
});

// Update status schema
export const updateStatusSchema = z.object({
    params: z.object({
        id: z.string().regex(/^\d+$/, '无效的商品ID')
    }),
    body: z.object({
        status: z.enum(Object.values(ProductStatus) as [string, ...string[]], {
            errorMap: () => ({ message: '无效的商品状态' })
        })
    })
});

// List products schema
export const getListSchema = z.object({
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
            .refine(val => val >= 1 && val <= 100, '每页数量必须在1-100之间')
            .optional()
            .default('10'),

        categoryId: z.string()
            .regex(/^\d+$/, '分类ID必须为数字')
            .transform(Number)
            .optional(),

        status: z.enum(Object.values(ProductStatus) as [string, ...string[]], {
            errorMap: () => ({ message: '无效的商品状态' })
        }).optional(),

        is_promotion: z.string()
            .regex(/^[0|1]$/, '促销状态必须为0或1')
            .transform(Number)
            .optional(),

        sort: z.enum(['stock', 'sales', 'created'], {
            errorMap: () => ({ message: '无效的排序字段' })
        }).optional(),

        order: z.enum(['asc', 'desc'], {
            errorMap: () => ({ message: '无效的排序方向' })
        }).optional(),

        keyword: z.string().optional()
    })
});

// 获取库存记录参数验证
export const getStockLogsSchema = z.object({
    params: z.object({
        id: z.string().regex(/^\d+$/, '无效的商品ID')
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
            .refine(val => val >= 1 && val <= 100, '每页数量必须在1-100之间')
            .optional()
            .default('10')
    })
});