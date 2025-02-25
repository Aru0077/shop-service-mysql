// src/routes/admin/statistics.routes.ts
import { Router } from 'express';
import { statisticsController } from '../../controllers/admin/statistics.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { authMiddleware } from '../../middlewares/auth.middleware';
import {
      baseStatisticsSchema,
      dateRangeSchema,
      groupBySchema
} from '../../validators/admin/statistics.validator';

const router = Router();

// 所有统计路由需要管理员认证
router.use(authMiddleware);

// 今日概览数据
router.get(
      '/daily-overview',
      validateRequest(baseStatisticsSchema),
      statisticsController.getDailyOverview
);

// 总体统计数据
router.get(
      '/total',
      validateRequest(baseStatisticsSchema),
      statisticsController.getTotalStatistics
);

// 过去30天销量数据
router.get(
      '/last-30-days-sales',
      validateRequest(baseStatisticsSchema),
      statisticsController.getLast30DaysSales
);

// 过去30天销售额数据
router.get(
      '/last-30-days-revenue',
      validateRequest(baseStatisticsSchema),
      statisticsController.getLast30DaysRevenue
);

// 过去30天总用户数据
router.get(
      '/last-30-days-users',
      validateRequest(baseStatisticsSchema),
      statisticsController.getLast30DaysUsers
);

export default router;