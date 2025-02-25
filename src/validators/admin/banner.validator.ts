// src/validators/banner.validator.ts
import { z } from 'zod';

const bannerSchema = z.object({
    body: z.object({
        imageUrl: z.string()
            .min(1, '图片URL不能为空')
            .max(255, '图片URL长度不能超过255个字符'),
        title: z.string()
            .min(2, '标题不能少于2个字符')
            .max(100, '标题不能超过100个字符'),
        content: z.string().optional(),
    }),
});

export const createBannerSchema = bannerSchema;
export const updateBannerSchema = bannerSchema;