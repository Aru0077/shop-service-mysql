// src/controllers/shop/favorite.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { ProductStatus } from '@prisma/client';

export const favoriteController = {
      // 收藏商品
      addFavorite: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { productId } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 检查商品是否存在且状态为上架
            const product = await prisma.product.findFirst({
                  where: {
                        id: productId,
                        status: ProductStatus.ONLINE
                  }
            });

            if (!product) {
                  throw new AppError(404, 'fail', '商品不存在或已下架');
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
                  return res.sendSuccess(null, '商品已收藏');
            }

            // 添加收藏
            await prisma.userFavorite.create({
                  data: {
                        userId,
                        productId
                  }
            });

            res.sendSuccess(null, '收藏成功');
      }),

      // 取消收藏商品
      removeFavorite: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { productId } = req.params;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
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
                  return res.sendSuccess(null, '商品未收藏');
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

            res.sendSuccess(null, '取消收藏成功');
      }),

      // 批量取消收藏
      batchRemoveFavorites: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { productIds } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
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

            res.sendSuccess(null, '批量取消收藏成功');
      }),

      // 分页获取收藏商品列表
      getFavorites: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { page = '1', limit = '10', idsOnly = 'false' } = req.query;
            const pageNumber = Number(page);
            const limitNumber = Number(limit);
            const skip = (pageNumber - 1) * limitNumber;
            const getIdsOnly = idsOnly === 'true';

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 如果只需要ID列表，则直接查询ID（不分页）
            if (getIdsOnly) {
                  const favorites = await prisma.userFavorite.findMany({
                        where: { userId },
                        select: { productId: true }
                  });

                  return res.sendSuccess({
                        total: favorites.length,
                        data: favorites.map(item => item.productId)
                  });
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

            res.sendSuccess({
                  total,
                  page: pageNumber,
                  limit: limitNumber,
                  data: validFavorites
            });
      })
};