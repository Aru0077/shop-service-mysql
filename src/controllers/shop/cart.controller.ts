// src/controllers/shop/cart.controller.ts
import { Request, Response } from 'express';
import { prisma, redisClient } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { ProductStatus } from '@prisma/client';

export const cartController = {
      // 添加商品到购物车
      addToCart: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { productId, skuId, quantity = 1 } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 验证商品和SKU是否存在且可购买
            const product = await prisma.product.findFirst({
                  where: {
                        id: productId,
                        status: ProductStatus.ONLINE
                  }
            });

            if (!product) {
                  throw new AppError(404, 'fail', '商品不存在或已下架');
            }

            const sku = await prisma.sku.findFirst({
                  where: {
                        id: skuId,
                        productId
                  }
            });

            if (!sku) {
                  throw new AppError(404, 'fail', 'SKU不存在');
            }

            if ((sku.stock || 0) <= 0) {
                  throw new AppError(400, 'fail', '商品库存不足');
            }

            // 检查购物车中是否已有该SKU
            const existingCartItem = await prisma.userCartItem.findFirst({
                  where: {
                        userId,
                        productId,
                        skuId
                  }
            });

            let cartItem;

            if (existingCartItem) {
                  // 更新购物车商品数量
                  cartItem = await prisma.userCartItem.update({
                        where: { id: existingCartItem.id },
                        data: {
                              quantity: existingCartItem.quantity + quantity
                        }
                  });
            } else {
                  // 添加新商品到购物车
                  cartItem = await prisma.userCartItem.create({
                        data: {
                              userId,
                              productId,
                              skuId,
                              quantity
                        }
                  });
            }

            res.sendSuccess(cartItem, '商品已添加到购物车');
      }),

      // 更新购物车商品数量
      updateCartItem: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;
            const { quantity } = req.body;
            const cartItemId = parseInt(id);

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 检查购物车项是否存在且属于当前用户
            const cartItem = await prisma.userCartItem.findFirst({
                  where: {
                        id: cartItemId,
                        userId
                  },
                  include: {
                        product: true
                  }
            });

            if (!cartItem) {
                  throw new AppError(404, 'fail', '购物车项不存在');
            }

            // 验证商品是否仍然上架
            if (cartItem.product.status !== ProductStatus.ONLINE) {
                  throw new AppError(400, 'fail', '商品已下架');
            }

            // 检查库存是否足够
            const sku = await prisma.sku.findUnique({
                  where: { id: cartItem.skuId }
            });

            if (!sku || (sku.stock || 0) < quantity) {
                  throw new AppError(400, 'fail', '商品库存不足');
            }

            // 更新购物车项
            const updatedCartItem = await prisma.userCartItem.update({
                  where: { id: cartItemId },
                  data: { quantity }
            });

            res.sendSuccess(updatedCartItem, '购物车已更新');
      }),

      // 删除购物车商品
      deleteCartItem: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;
            const cartItemId = parseInt(id);

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 检查购物车项是否存在且属于当前用户
            const cartItem = await prisma.userCartItem.findFirst({
                  where: {
                        id: cartItemId,
                        userId
                  }
            });

            if (!cartItem) {
                  throw new AppError(404, 'fail', '购物车项不存在');
            }

            // 删除购物车项
            await prisma.userCartItem.delete({
                  where: { id: cartItemId }
            });

            res.sendSuccess(null, '商品已从购物车移除');
      }),

      // 获取购物车列表
      getCartList: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { page = '1', limit = '10' } = req.query;
            const pageNumber = parseInt(page as string);
            const limitNumber = parseInt(limit as string);
            const skip = (pageNumber - 1) * limitNumber;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 获取购物车总数
            const total = await prisma.userCartItem.count({
                  where: { userId }
            });

            // 获取购物车项
            const cartItems = await prisma.userCartItem.findMany({
                  where: { userId },
                  include: {
                        product: {
                              select: {
                                    id: true,
                                    name: true,
                                    mainImage: true,
                                    status: true
                              }
                        }
                  },
                  orderBy: { updatedAt: 'desc' },
                  skip,
                  take: limitNumber
            });

            // 获取购物车中商品的SKU信息
            const cartItemsWithSkuInfo = await Promise.all(
                  cartItems.map(async (item) => {
                        const sku = await prisma.sku.findUnique({
                              where: { id: item.skuId },
                              include: {
                                    sku_specs: {
                                          include: {
                                                spec: true,
                                                specValue: true
                                          }
                                    }
                              }
                        });

                        return {
                              ...item,
                              sku,
                              isAvailable:
                                    item.product.status === ProductStatus.ONLINE &&
                                    sku && (sku.stock || 0) > 0
                        };
                  })
            );

            res.sendSuccess({
                  total,
                  page: pageNumber,
                  limit: limitNumber,
                  data: cartItemsWithSkuInfo
            });
      }),

      // 清空购物车
      clearCart: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 删除用户的所有购物车项
            await prisma.userCartItem.deleteMany({
                  where: { userId }
            });

            res.sendSuccess(null, '购物车已清空');
      }),


};