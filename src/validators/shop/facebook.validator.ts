// src/validators/shop/facebook.validator.ts
import { z } from 'zod';

// Facebook令牌登录验证
export const facebookTokenLoginSchema = z.object({
    body: z.object({
        accessToken: z.string({
            required_error: "缺少访问令牌",
            invalid_type_error: "访问令牌必须为字符串"
        })
    })
});