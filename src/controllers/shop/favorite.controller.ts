// src/controllers/shop/favorite.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { ProductStatus } from '@prisma/client';
import { cacheUtils } from '../../utils/cache.utils';

export const favoriteController = {
      // 收藏商品
      addFavorite: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { productId } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', 'Please login first');
            }

            // 检查商品是否存在且状态为上架
            const product = await prisma.product.findFirst({
                  where: {
                        id: productId,
                        status: ProductStatus.ONLINE
                  }
            });

            if (!product) {
                  throw new AppError(404, 'fail', 'Product does not exist or is no longer available');
            }

            // 检查是否已收藏
            const existingFavorite = await prisma.userFavorite.findUnique({
                  where: {
                        uk_user_product: {
                              userId,
                              productId
                        }
                  }
            });

            if (existingFavorite) {
                  return res.sendSuccess(null, 'Product already favorited');
            }

            // 添加收藏
            const favorite = await prisma.userFavorite.create({
                  data: {
                        userId,
                        productId
                  }
            });

            // 查询完整的收藏信息
            const completeFavorite = await prisma.userFavorite.findUnique({
                  where: { id: favorite.id },
                  include: {
                        product: {
                              include: {
                                    category: {
                                          select: {
                                                id: true,
                                                name: true
                                          }
                                    },
                                    skus: {
                                          select: {
                                                id: true,
                                                price: true,
                                                promotion_price: true,
                                                stock: true
                                          },
                                          take: 1,
                                          orderBy: {
                                                price: 'asc'
                                          }
                                    }
                              }
                        }
                  }
            });

            // 清除相关缓存
            await cacheUtils.invalidateModuleCache('user', userId);
            await cacheUtils.invalidateCache(`favorites:${userId}:*`);

            res.sendSuccess(completeFavorite, 'Added to favorites successfully');
      }),

      // 取消收藏商品
      removeFavorite: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { productId } = req.params;

            if (!userId) {
                  throw new AppError(401, 'fail', 'Please login first');
            }

            const parsedProductId = parseInt(productId);

            // 检查是否已收藏
            const existingFavorite = await prisma.userFavorite.findUnique({
                  where: {
                        uk_user_product: {
                              userId,
                              productId: parsedProductId
                        }
                  }
            });

            if (!existingFavorite) {
                  return res.sendSuccess(null, 'Product not in favorites');
            }

            // 删除收藏
            await prisma.userFavorite.delete({
                  where: {
                        uk_user_product: {
                              userId,
                              productId: parsedProductId
                        }
                  }
            });
            await cacheUtils.invalidateCache(`favorites:${userId}:*`);
            res.sendSuccess(null, 'Removed from favorites successfully');
      }),

      // 批量取消收藏
      batchRemoveFavorites: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { productIds } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', 'Please login first');
            }

            // 批量删除收藏
            await prisma.userFavorite.deleteMany({
                  where: {
                        userId,
                        productId: {
                              in: productIds
                        }
                  }
            });
            await cacheUtils.invalidateCache(`favorites:${userId}:*`);
            res.sendSuccess(null, 'Batch removal from favorites successful');
      }),

      // 分页获取收藏商品列表
      // 分页获取收藏商品列表
      getFavorites: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { page = '1', limit = '10', idsOnly = 'false' } = req.query;
            const pageNumber = Number(page);
            const limitNumber = Number(limit);
            const skip = (pageNumber - 1) * limitNumber;
            const getIdsOnly = idsOnly === 'true';

            if (!userId) {
                  throw new AppError(401, 'fail', 'Please login first');
            }

            // 使用缓存，针对不同查询模式使用不同的缓存键
            const cacheKey = `favorites:${userId}:${getIdsOnly ? 'ids' : 'list'}:${pageNumber}:${limitNumber}`;

            // 使用自适应缓存策略，收藏列表更新频率中等
            const favoriteData = await cacheUtils.adaptiveCaching(
                  cacheKey,
                  async () => {
                        // 如果只需要ID列表，则直接查询ID（不分页）
                        if (getIdsOnly) {
                              const favorites = await prisma.userFavorite.findMany({
                                    where: { userId },
                                    select: { productId: true }
                              });

                              return {
                                    total: favorites.length,
                                    data: favorites.map(item => item.productId)
                              };
                        }

                        // 查询收藏商品总数
                        const total = await prisma.userFavorite.count({
                              where: {
                                    userId,
                                    product: {
                                          status: ProductStatus.ONLINE
                                    }
                              }
                        });

                        // 查询收藏商品列表
                        const favorites = await prisma.userFavorite.findMany({
                              where: {
                                    userId,
                                    product: {
                                          status: ProductStatus.ONLINE
                                    }
                              },
                              include: {
                                    product: {
                                          include: {
                                                category: {
                                                      select: {
                                                            id: true,
                                                            name: true
                                                      }
                                                },
                                                skus: {
                                                      select: {
                                                            id: true,
                                                            price: true,
                                                            promotion_price: true,
                                                            stock: true
                                                      },
                                                      take: 1,
                                                      orderBy: {
                                                            price: 'asc'
                                                      }
                                                }
                                          }
                                    }
                              },
                              orderBy: {
                                    createdAt: 'desc'
                              },
                              skip,
                              take: limitNumber
                        });

                        // 过滤掉已下架或删除的商品
                        const validFavorites = favorites.filter(
                              favorite => favorite.product && favorite.product.status === ProductStatus.ONLINE
                        );

                        // 增强返回数据，添加计算字段
                        const enhancedFavorites = validFavorites.map(favorite => {
                              const sku = favorite.product.skus[0];
                              const displayPrice = sku?.promotion_price || sku?.price || 0;

                              return {
                                    ...favorite,
                                    product: {
                                          ...favorite.product,
                                          displayPrice
                                    }
                              };
                        });

                        return {
                              total,
                              page: pageNumber,
                              limit: limitNumber,
                              data: enhancedFavorites
                        };
                  },
                  'SHORT',  // 基础缓存级别(5分钟)
                  'medium'  // 流量级别
            );

            res.sendSuccess(favoriteData);
      }),
};