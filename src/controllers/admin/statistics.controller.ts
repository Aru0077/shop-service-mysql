// src/controllers/admin/statistics.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { OrderStatus, PaymentStatus } from '../../constants/orderStatus.enum';

export const statisticsController = {
      // 获取今日概览数据（今日销量，销售额，访客，新增用户，支付用户）
      getDailyOverview: asyncHandler(async (req: Request, res: Response) => {
            // 获取今天的开始和结束时间
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            // 并行查询各项统计数据
            const [dailySales, dailyRevenue, newUsers, payingUsers] = await Promise.all([
                  // 今日销量（已完成订单的商品总数）
                  prisma.orderItem.count({
                        where: {
                              order: {
                                    createdAt: {
                                          gte: today,
                                          lt: tomorrow
                                    },
                                    orderStatus: {
                                          in: [OrderStatus.COMPLETED, OrderStatus.SHIPPED, OrderStatus.PENDING_SHIPMENT]
                                    },
                                    paymentStatus: PaymentStatus.PAID
                              }
                        }
                  }),

                  // 今日销售额（已支付订单的总金额）
                  prisma.order.aggregate({
                        where: {
                              createdAt: {
                                    gte: today,
                                    lt: tomorrow
                              },
                              paymentStatus: PaymentStatus.PAID
                        },
                        _sum: {
                              paymentAmount: true
                        }
                  }),

                  // 今日新增用户
                  prisma.user.count({
                        where: {
                              createdAt: {
                                    gte: today,
                                    lt: tomorrow
                              }
                        }
                  }),

                  // 今日支付用户数（去重）
                  prisma.order.groupBy({
                        by: ['userId'],
                        where: {
                              createdAt: {
                                    gte: today,
                                    lt: tomorrow
                              },
                              paymentStatus: PaymentStatus.PAID
                        }
                  }).then(users => users.length)
            ]);

            // 注意：访客统计通常需要单独的统计服务或日志分析，这里假设我们没有这个数据
            // 如果有访客统计服务，可以在这里集成

            res.sendSuccess({
                  dailySales,
                  dailyRevenue: dailyRevenue._sum.paymentAmount || 0,
                  newUsers,
                  payingUsers,
                  visitors: null // 可能需要从其他服务获取
            });
      }),

      // 获取总体统计数据（总销量，总销售额，总支付用户，总用户）
      getTotalStatistics: asyncHandler(async (req: Request, res: Response) => {
            const [totalSales, totalRevenue, totalUsers, totalPayingUsers] = await Promise.all([
                  // 总销量（所有已完成订单的商品总数）
                  prisma.orderItem.count({
                        where: {
                              order: {
                                    orderStatus: {
                                          in: [OrderStatus.COMPLETED, OrderStatus.SHIPPED, OrderStatus.PENDING_SHIPMENT]
                                    },
                                    paymentStatus: PaymentStatus.PAID
                              }
                        }
                  }),

                  // 总销售额（所有已支付订单的总金额）
                  prisma.order.aggregate({
                        where: {
                              paymentStatus: PaymentStatus.PAID
                        },
                        _sum: {
                              paymentAmount: true
                        }
                  }),

                  // 总用户数
                  prisma.user.count(),

                  // 总支付用户数（去重）
                  prisma.order.groupBy({
                        by: ['userId'],
                        where: {
                              paymentStatus: PaymentStatus.PAID
                        }
                  }).then(users => users.length)
            ]);

            res.sendSuccess({
                  totalSales,
                  totalRevenue: totalRevenue._sum.paymentAmount || 0,
                  totalUsers,
                  totalPayingUsers
            });
      }),

      // 获取过去30天的每日销量
      // 修改过去30天销量数据查询
      getLast30DaysSales: asyncHandler(async (req: Request, res: Response) => {
            // 计算30天前的日期
            const endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 29);
            startDate.setHours(0, 0, 0, 0);

            // 使用分组聚合，直接获取结果而不是原始数据
            const dailySalesData = await prisma.$queryRaw`
          SELECT 
              DATE(created_at) as date,
              COUNT(*) as count
          FROM 
              order_items
          WHERE 
              created_at >= ${startDate} 
              AND created_at <= ${endDate}
              AND EXISTS (
                  SELECT 1 FROM orders 
                  WHERE orders.id = order_items.order_id 
                  AND orders.payment_status = ${PaymentStatus.PAID}
                  AND orders.order_status IN (
                      ${OrderStatus.COMPLETED},
                      ${OrderStatus.SHIPPED},
                      ${OrderStatus.PENDING_SHIPMENT}
                  )
              )
          GROUP BY 
              DATE(created_at)
          ORDER BY 
              date ASC
          LIMIT 31
      `;

            // 使用更高效的方式填充日期
            const resultMap = new Map();
            (dailySalesData as any[]).forEach(item => {
                  resultMap.set(item.date.toISOString().split('T')[0], item.count || 0);
            });

            const filledData = [];
            const current = new Date(startDate);
            while (current <= endDate) {
                  const dateStr = current.toISOString().split('T')[0];
                  filledData.push({
                        date: dateStr,
                        value: resultMap.get(dateStr) || 0
                  });
                  current.setDate(current.getDate() + 1);
            }

            res.sendSuccess(filledData);
      }),

      // 获取过去30天的每日销售额
      getLast30DaysRevenue: asyncHandler(async (req: Request, res: Response) => {
            // 计算30天前的日期
            const endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 29);
            startDate.setHours(0, 0, 0, 0);

            // 获取过去30天每天的销售额统计
            const dailyRevenueData = await prisma.$queryRaw`
            SELECT 
                DATE(created_at) as date,
                SUM(payment_amount) as amount
            FROM 
                orders
            WHERE 
                created_at >= ${startDate} 
                AND created_at <= ${endDate}
                AND payment_status = ${PaymentStatus.PAID}
            GROUP BY 
                DATE(created_at)
            ORDER BY 
                date ASC
        `;

            // 填充没有数据的日期
            const filledData = fillMissingDates(dailyRevenueData as any[], startDate, endDate, 'amount');

            res.sendSuccess(filledData);
      }),

      // 获取过去30天的每日用户总数
      getLast30DaysUsers: asyncHandler(async (req: Request, res: Response) => {
            // 计算30天前的日期
            const endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 29);
            startDate.setHours(0, 0, 0, 0);

            // 获取过去30天每天的用户总数统计
            const dailyTotalUsersData = [];

            // 循环每一天
            for (let i = 0; i <= 29; i++) {
                  const currentDate = new Date(startDate);
                  currentDate.setDate(currentDate.getDate() + i);

                  // 截至当天的用户总数
                  const currentDateEnd = new Date(currentDate);
                  currentDateEnd.setHours(23, 59, 59, 999);

                  const userCount = await prisma.user.count({
                        where: {
                              createdAt: {
                                    lte: currentDateEnd
                              }
                        }
                  });

                  dailyTotalUsersData.push({
                        date: currentDate.toISOString().split('T')[0],
                        count: userCount
                  });
            }

            // 构建响应数据
            const responseData = dailyTotalUsersData.map(item => ({
                  date: item.date,
                  value: item.count
            }));

            res.sendSuccess(responseData);
      })
};

// 辅助函数：填充缺失的日期数据
function fillMissingDates(data: any[], startDate: Date, endDate: Date, valueField: string): any[] {
      const filledData = [];
      const dateMap = new Map();

      // 将查询结果转换为日期映射
      data.forEach(item => {
            const dateStr = new Date(item.date).toISOString().split('T')[0];
            dateMap.set(dateStr, item[valueField] || 0);
      });

      // 填充所有日期
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            filledData.push({
                  date: dateStr,
                  value: dateMap.has(dateStr) ? dateMap.get(dateStr) : 0
            });
            currentDate.setDate(currentDate.getDate() + 1);
      }

      return filledData;
}