// src/validators/adminUser.validator.ts
import { z } from 'zod';

// 基础验证规则
const usernameSchema = z.string()
    .min(3, '用户名长度不能小于3个字符')
    .max(50, '用户名长度不能超过50个字符');

const passwordSchema = z.string()
    .min(6, '密码长度不能小于6个字符')
    .max(50, '密码长度不能超过50个字符'); 

// 登录验证
export const loginSchema = z.object({
    body: z.object({
        username: usernameSchema,
        password: z.string().min(6, '密码长度不能小于6个字符'),
    }),
});

// 创建管理员验证
export const createAdminSchema = z.object({
    body: z.object({
        username: usernameSchema,
        password: passwordSchema,
        isSuper: z.boolean().optional().default(false),
    }),
});

// 更新状态验证
export const updateStatusSchema = z.object({
    params: z.object({
        id: z.string().regex(/^\d+$/, '无效的ID'),
    }),
    body: z.object({
        status: z.number()
            .int()
            .min(0, '状态值必须大于等于0')
            .max(1, '状态值必须小于等于1'),
    }),
});

// 重置密码验证
export const resetPasswordSchema = z.object({
    params: z.object({
        id: z.string().regex(/^\d+$/, '无效的ID'),
    }),
    body: z.object({
        newPassword: passwordSchema,
    }),
});

// 分页查询验证
export const paginationSchema = z.object({
    query: z.object({
        page: z.string().regex(/^\d+$/, '页码必须为数字').optional(),
        limit: z.string().regex(/^\d+$/, '每页数量必须为数字').optional(),
    }),
});