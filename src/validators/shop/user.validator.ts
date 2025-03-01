// src/validators/shop/user.validator.ts
// src/validators/shop/user.validator.ts
import { z } from 'zod';

// 基础验证规则
const usernameSchema = z.string()
      .min(3, '用户名长度不能小于3个字符')
      .max(50, '用户名长度不能超过50个字符');

const passwordSchema = z.string()
      .min(6, '密码长度不能小于6个字符')
      .max(50, '密码长度不能超过50个字符');

// 注册验证
export const registerSchema = z.object({
      body: z.object({
            username: usernameSchema,
            password: passwordSchema,
      }),
});

// 登录验证
export const loginSchema = z.object({
      body: z.object({
            username: usernameSchema,
            password: z.string().min(6, '密码长度不能小于6个字符'),
      }),
});

// 删除账号验证
export const deleteAccountSchema = z.object({
      body: z.object({
            password: z.string().min(1, '密码不能为空'),
      }),
});