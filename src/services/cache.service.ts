// src/services/cache.service.ts
import { prisma } from '../config';
import { cacheUtils } from '../utils/cache.utils';
import { ProductStatus } from '@prisma/client';

class CacheService {
      // 缓存预热函数
      async warmupCaches() {
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
      setupCacheStats() {
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
}

// 导出缓存服务实例
export const cacheService = new CacheService();