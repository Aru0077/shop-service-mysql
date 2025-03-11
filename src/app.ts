// src/app.ts
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import routes from './routes';
import {
      responseHandler,
      notFoundHandler,
      globalErrorHandler
} from './utils/http.utils';
import './config';  // 导入配置，会自动初始化数据库和Redis连接
import { prisma, redisClient } from './config';
// 导入订单定时任务服务
import { orderScheduleService } from './services/orderSchedule.service';
// 导入缓存工具
import { cacheUtils, CACHE_LEVELS } from './utils/cache.utils';
import { ProductStatus } from '@prisma/client';

// 缓存预热函数
async function warmupCaches() {
      console.log('🔄 Warming up application caches...');

      try {
            // 定义要预热的缓存键和对应的数据获取函数
            await cacheUtils.warmupCache(
                  [
                        'shop:category:tree',
                        'shop:home:data',
                        'promotions:available',
                        'shop:products:latest:1:10',
                        'shop:products:top-selling:1:10',
                        'shop:products:promotion:1:10'
                  ],
                  [
                        // 分类树查询
                        async () => {
                              const categories = await prisma.category.findMany({
                                    orderBy: [
                                          { level: 'asc' },
                                          { id: 'asc' }
                                    ]
                              });

                              // 构建分类树
                              const buildTree = (parentId: number = 0): any[] => {
                                    return categories
                                          .filter(category => category.parentId === parentId)
                                          .map(category => ({
                                                id: category.id,
                                                name: category.name,
                                                level: category.level,
                                                children: buildTree(category.id)
                                          }));
                              };

                              return buildTree();
                        },

                        // 首页数据查询
                        async () => {
                              // 并行获取三种数据
                              const [latestProducts, topSellingProducts, latestBanner] = await Promise.all([
                                    // 最新上架商品
                                    prisma.product.findMany({
                                          where: { status: ProductStatus.ONLINE },
                                          include: {
                                                category: { select: { id: true, name: true } },
                                                skus: {
                                                      take: 1,
                                                      orderBy: { price: 'asc' },
                                                      select: { price: true, promotion_price: true }
                                                }
                                          },
                                          orderBy: { createdAt: 'desc' },
                                          take: 6
                                    }),

                                    // 销量最高商品
                                    prisma.product.findMany({
                                          where: {
                                                status: ProductStatus.ONLINE,
                                                salesCount: { gt: 0 }
                                          },
                                          include: {
                                                category: { select: { id: true, name: true } },
                                                skus: {
                                                      take: 1,
                                                      orderBy: { price: 'asc' },
                                                      select: { price: true, promotion_price: true }
                                                }
                                          },
                                          orderBy: { salesCount: 'desc' },
                                          take: 6
                                    }),

                                    // 最新更新的一条banner
                                    prisma.banner.findFirst({
                                          orderBy: { updatedAt: 'desc' }
                                    })
                              ]);

                              return {
                                    latestProducts,
                                    topSellingProducts,
                                    banner: latestBanner
                              };
                        },

                        // 可用促销查询
                        async () => {
                              const now = new Date();
                              return await prisma.promotion.findMany({
                                    where: {
                                          isActive: true,
                                          startTime: { lte: now },
                                          endTime: { gte: now }
                                    },
                                    orderBy: { thresholdAmount: 'asc' }
                              });
                        },

                        // 最新商品查询
                        async () => {
                              const [total, products] = await Promise.all([
                                    prisma.product.count({
                                          where: { status: ProductStatus.ONLINE }
                                    }),
                                    prisma.product.findMany({
                                          where: { status: ProductStatus.ONLINE },
                                          include: {
                                                category: { select: { id: true, name: true } },
                                                skus: {
                                                      take: 1,
                                                      orderBy: { price: 'asc' },
                                                      select: { price: true, promotion_price: true }
                                                }
                                          },
                                          orderBy: { createdAt: 'desc' },
                                          skip: 0,
                                          take: 10
                                    })
                              ]);

                              return {
                                    total,
                                    page: 1,
                                    limit: 10,
                                    data: products
                              };
                        },

                        // 热销商品查询
                        async () => {
                              const total = await prisma.product.count({
                                    where: {
                                          status: ProductStatus.ONLINE,
                                          salesCount: { gt: 0 }
                                    }
                              });

                              const products = await prisma.product.findMany({
                                    where: {
                                          status: ProductStatus.ONLINE,
                                          salesCount: { gt: 0 }
                                    },
                                    include: {
                                          category: { select: { id: true, name: true } },
                                          skus: {
                                                take: 1,
                                                orderBy: { price: 'asc' },
                                                select: { price: true, promotion_price: true }
                                          }
                                    },
                                    orderBy: { salesCount: 'desc' },
                                    skip: 0,
                                    take: 10
                              });

                              return {
                                    total,
                                    page: 1,
                                    limit: 10,
                                    data: products
                              };
                        },

                        // 促销商品查询
                        async () => {
                              const [total, products] = await Promise.all([
                                    prisma.product.count({
                                          where: {
                                                status: ProductStatus.ONLINE,
                                                is_promotion: 1
                                          }
                                    }),
                                    prisma.product.findMany({
                                          where: {
                                                status: ProductStatus.ONLINE,
                                                is_promotion: 1
                                          },
                                          include: {
                                                category: { select: { id: true, name: true } },
                                                skus: {
                                                      select: {
                                                            id: true,
                                                            price: true,
                                                            promotion_price: true,
                                                            stock: true
                                                      }
                                                }
                                          },
                                          orderBy: { createdAt: 'desc' },
                                          skip: 0,
                                          take: 10
                                    })
                              ]);

                              return {
                                    total,
                                    page: 1,
                                    limit: 10,
                                    data: products
                              };
                        }
                  ]
            );

            console.log('✅ Cache warmup completed successfully');
      } catch (error) {
            console.error('❌ Cache warmup failed:', error);
      }
}

// 设置缓存统计收集
function setupCacheStats() {
      console.log('📊 Setting up cache statistics collection');

      // 每小时收集统计数据
      const hourlyStats = setInterval(() => {
            const stats = cacheUtils.getCacheStats();
            console.log('📊 Hourly cache statistics:', JSON.stringify(stats, null, 2));

            // 记录关键指标到日志
            const memoryHitRate = stats.memory.hitRate.toFixed(2);
            const redisHitRate = stats.redis.hitRate.toFixed(2);
            console.log(`💾 Memory cache hit rate: ${memoryHitRate}%, Redis cache hit rate: ${redisHitRate}%`);

            // 重置统计数据
            cacheUtils.resetCacheStats();
      }, 3600000); // 1小时

      // 每天进行一次详细统计
      const dailyStats = setInterval(async () => {
            const stats = cacheUtils.getCacheStats();
            console.log('📊 Daily cache statistics:', JSON.stringify(stats, null, 2));

            // 记录缓存命中率到数据库或其他持久化存储
            try {
                  // 这里可以添加将统计数据写入数据库的代码
                  // 例如：await prisma.cacheStats.create({ data: { ...stats, timestamp: new Date() } });

                  console.log('✅ Daily cache statistics recorded');
            } catch (error) {
                  console.error('❌ Failed to record daily cache statistics:', error);
            }
      }, 86400000); // 24小时

      // 返回计时器，以便在服务器关闭时清理
      return { hourlyStats, dailyStats };
}

const app: Express = express();
const port = process.env.PORT || 3000;

// 中间件配置
app.use(morgan('dev'))
// src/app.ts 中修改 CORS 配置
app.use(cors({
      origin: '*', // 指定前端域名
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      maxAge: 86400 // 预检请求缓存1天
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(responseHandler);

// 基础路由 
app.get('/health', (req: Request, res: Response) => {
      res.sendSuccess({
            status: 'ok',
            timestamp: new Date().toISOString()
      });
});

// API 路由
app.use('/v1', routes);

// 错误处理
app.use(notFoundHandler);
app.use(globalErrorHandler);

// 优雅启动
// 修改 startServer 函数
const startServer = () => {
      const server = app.listen(port, async () => {
            console.log(`✅ Server is running at http://localhost:${port}`);
            // 启动订单定时任务
            orderScheduleService.startScheduleTasks();
            // 启动缓存统计
            const cacheStatsTimers = setupCacheStats();
            
            // 执行缓存预热
            await warmupCaches();
            
            // 将定时器绑定到app对象，以便在关闭时清理
            (app as any).cacheStatsTimers = cacheStatsTimers;
      });

      // 添加一个标志来防止多次关闭
      let isShuttingDown = false;

      // 优雅关闭处理
      const gracefulShutdown = async () => {
            if (isShuttingDown) {
                  console.log('💡 Shutdown already in progress...');
                  return;
            }

            isShuttingDown = true;
            console.log('🔄 Received shutdown signal. Closing server...');

            try {
                  // 清理缓存统计定时器
                  if ((app as any).cacheStatsTimers) {
                        clearInterval((app as any).cacheStatsTimers.hourlyStats);
                        clearInterval((app as any).cacheStatsTimers.dailyStats);
                        console.log('✅ Cache statistics timers cleared');
                  }
                  
                  
                  // 首先关闭 HTTP 服务器
                  await new Promise<void>((resolve, reject) => {
                        server.close((err) => {
                              if (err) reject(err);
                              else resolve();
                        });
                  });
                  console.log('✅ Server closed successfully');

                  // 检查 Redis 和 Prisma 的连接状态
                  const shutdownTasks = [];

                  // 只有在 Redis 客户端未关闭时才尝试关闭
                  if (redisClient.isOpen) {
                        shutdownTasks.push(redisClient.quit());
                  }

                  // Prisma 的关闭
                  shutdownTasks.push(prisma.$disconnect());

                  // 执行所有关闭任务
                  await Promise.all(shutdownTasks);
                  console.log('👋 All connections closed successfully');

                  process.exit(0);
            } catch (error) {
                  console.error('❌ Error during graceful shutdown:',
                        error instanceof Error ? error.message : 'Unknown error');
                  process.exit(1);
            }
      };

      // 处理服务器错误
      server.on('error', (error: NodeJS.ErrnoException) => {
            if (error.syscall !== 'listen') {
                  throw error;
            }

            switch (error.code) {
                  case 'EACCES':
                        console.error(`❌ Port ${port} requires elevated privileges`);
                        process.exit(1);
                        break;
                  case 'EADDRINUSE':
                        console.error(`❌ Port ${port} is already in use`);
                        process.exit(1);
                        break;
                  default:
                        throw error;
            }
      });

      // 监听进程终止信号
      process.on('SIGTERM', gracefulShutdown);
      process.on('SIGINT', gracefulShutdown);
      process.on('SIGHUP', gracefulShutdown);

      // 处理未捕获的异常和 Promise 拒绝
      process.on('uncaughtException', (error) => {
            console.error('❌ Uncaught Exception:', error);
            gracefulShutdown();
      });

      process.on('unhandledRejection', (reason, promise) => {
            console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
            gracefulShutdown();
      });

      // 返回服务器实例（可选）
      return server;
};

// 启动服务器
startServer();

export default app;