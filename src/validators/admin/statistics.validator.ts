// src/validators/admin/statistics.validator.ts
import { z } from 'zod';

// 由于统计接口通常不需要复杂的请求参数验证，我们可以创建一个空白的基础验证
export const baseStatisticsSchema = z.object({
      // 空对象，仅用于验证基本的路由参数
});

// 如果需要支持自定义日期范围，可以添加以下验证
export const dateRangeSchema = z.object({
      query: z.object({
            startDate: z.string()
                  .regex(/^\d{4}-\d{2}-\d{2}$/, '开始日期格式必须为YYYY-MM-DD')
                  .optional(),
            endDate: z.string()
                  .regex(/^\d{4}-\d{2}-\d{2}$/, '结束日期格式必须为YYYY-MM-DD')
                  .optional(),
      })
});

// 如果需要支持分组选项，可以添加以下验证
export const groupBySchema = z.object({
      query: z.object({
            groupBy: z.enum(['day', 'week', 'month'], {
                  errorMap: () => ({ message: '分组必须是 day、week 或 month' })
            }).optional().default('day'),
      })
});