// src/validators/image.validator.ts
import { z } from 'zod';

// 批量删除验证
export const batchDeleteSchema = z.object({
      body: z.object({
            ids: z.array(z.string().regex(/^\d+$/, '无效的ID'))
      })
});

// 删除单个图片验证
export const deleteImageSchema = z.object({
      params: z.object({
            id: z.string().regex(/^\d+$/, '无效的ID')
      })
});

// 分页查询验证
export const paginationSchema = z.object({
      query: z.object({
            page: z.string().regex(/^\d+$/, '页码必须为数字').optional(),
            limit: z.string().regex(/^\d+$/, '每页数量必须为数字').optional(),
            isUsed: z.string().regex(/^[0|1]$/, '使用状态必须为0或1').optional()
      })
});