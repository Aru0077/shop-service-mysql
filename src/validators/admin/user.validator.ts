// src/validators/user.validator.ts
import { z } from 'zod';

// 分页查询验证
export const userPaginationSchema = z.object({
    query: z.object({
        page: z.string().regex(/^\d+$/, '页码必须为数字').optional(),
        limit: z.string().regex(/^\d+$/, '每页数量必须为数字').optional(),
        username: z.string().optional(),
    }),
});

// 设置黑名单状态验证
export const blacklistStatusSchema = z.object({
    params: z.object({
        id: z.string().uuid('无效的用户ID'),
    }),
    body: z.object({
        isBlacklist: z.number()
            .int()
            .min(0, '状态值必须为0或1')
            .max(1, '状态值必须为0或1'),
    }),
});

// 获取用户详情验证
export const getUserDetailsSchema = z.object({
    params: z.object({
        id: z.string().uuid('无效的用户ID'),
    }),
});