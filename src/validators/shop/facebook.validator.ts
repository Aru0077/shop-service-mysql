// src/validators/shop/facebook.validator.ts
import { z } from 'zod';

// Facebook回调验证
export const facebookCallbackSchema = z.object({
      query: z.object({
            code: z.string({
                  required_error: "缺少授权码",
                  invalid_type_error: "授权码必须为字符串"
            })
      })
});

// Facebook令牌登录验证
export const facebookTokenLoginSchema = z.object({
      body: z.object({
            accessToken: z.string({
                  required_error: "缺少访问令牌",
                  invalid_type_error: "访问令牌必须为字符串"
            })
      })
});