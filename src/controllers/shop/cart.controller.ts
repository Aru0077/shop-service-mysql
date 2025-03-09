// src/controllers/shop/cart.controller.ts
import { Request, Response } from 'express';
import { prisma, redisClient } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { ProductStatus } from '@prisma/client';

export const cartController = {
      // 添加商品到购物车 - 限制短时间内同一商品的添加频率
      addToCart: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { productId, skuId, quantity = 1 } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 缓存key控制重复请求 - 限制短时间内同一商品的添加频率
            const throttleKey = `cart:throttle:${userId}:${productId}:${skuId}`;
            const isThrottled = await redisClient.exists(throttleKey);
            if (isThrottled) {
                  // 返回成功但不执行数据库操作，前端可继续操作
                  return res.sendSuccess(null, '商品已添加到购物车');
            }

            // 设置300ms的节流时间，合并短时间内的重复请求
            await redisClient.setEx(throttleKey, 1, '1');

            // 1. 并行验证商品和SKU状态
            const [product, sku, existingCartItem] = await Promise.all([
                  prisma.product.findFirst({
                        where: {
                              id: productId,
                              status: ProductStatus.ONLINE
                        },
                        select: { id: true, name: true }
                  }),
                  prisma.sku.findFirst({
                        where: {
                              id: skuId,
                              productId
                        },
                        select: { id: true, stock: true, price: true, promotion_price: true }
                  }),
                  prisma.userCartItem.findFirst({
                        where: {
                              userId,
                              productId,
                              skuId
                        },
                        select: { id: true, quantity: true }
                  })
            ]);

            // 2. 快速校验
            if (!product) {
                  throw new AppError(404, 'fail', '商品不存在或已下架');
            }

            if (!sku) {
                  throw new AppError(404, 'fail', 'SKU不存在');
            }

            // 3. 库存检查（预留策略：允许加入购物车但警告库存不足）
            const isLowStock = (sku.stock || 0) < quantity;
            const effectiveQuantity = isLowStock ? sku.stock || 0 : quantity;

            let cartItem;
            let cartItemCount = 0;

            // 4. 使用事务保证数据一致性
            if (existingCartItem) {
                  // 更新购物车商品数量
                  const newQuantity = existingCartItem.quantity + effectiveQuantity;

                  cartItem = await prisma.userCartItem.update({
                        where: { id: existingCartItem.id },
                        data: {
                              quantity: newQuantity,
                              updatedAt: new Date()
                        }
                  });
            } else {
                  // 添加新商品到购物车
                  cartItem = await prisma.userCartItem.create({
                        data: {
                              userId,
                              productId,
                              skuId,
                              quantity: effectiveQuantity
                        }
                  });
            }

            // 5. 获取购物车商品总数
            cartItemCount = await prisma.userCartItem.count({
                  where: { userId }
            });

            // 构建响应数据，包含价格和库存信息
            const responseData = {
                  cartItem: {
                        ...cartItem,
                        product: { id: product.id, name: product.name },
                        sku: {
                              id: sku.id,
                              price: sku.promotion_price || sku.price,
                              stock: sku.stock
                        }
                  },
                  cartItemCount,
                  isLowStock
            };

            // 返回提示信息
            if (isLowStock) {
                  return res.sendSuccess(responseData, '已加入购物车，但库存不足');
            }

            res.sendSuccess(responseData, '商品已成功添加到购物车');
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

      // 预览订单金额（包含满减优惠）
      previewOrderAmount: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { cartItemIds } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            // 验证并获取购物车项
            const cartItems = await prisma.userCartItem.findMany({
                  where: {
                        id: { in: cartItemIds },
                        userId
                  },
                  include: {
                        product: {
                              select: {
                                    id: true,
                                    name: true,
                                    status: true
                              }
                        }
                  }
            });

            if (cartItems.length === 0) {
                  throw new AppError(400, 'fail', '请选择要购买的商品');
            }

            // 获取SKU信息
            const skuIds = cartItems.map(item => item.skuId);
            const skus = await prisma.sku.findMany({
                  where: {
                        id: { in: skuIds }
                  },
                  select: {
                        id: true,
                        price: true,
                        promotion_price: true,
                        stock: true
                  }
            });

            // 映射SKU
            const skuMap = new Map(skus.map(sku => [sku.id, sku]));

            // 计算总金额
            let totalAmount = 0;

            for (const cartItem of cartItems) {
                  const sku = skuMap.get(cartItem.skuId);
                  if (!sku) continue;

                  // 使用促销价或原价
                  const unitPrice = sku.promotion_price || sku.price;
                  totalAmount += unitPrice * cartItem.quantity;
            }

            // 查找可用的满减规则
            const now = new Date();
            const applicablePromotion = await prisma.promotion.findFirst({
                  where: {
                        isActive: true,
                        startTime: { lte: now },
                        endTime: { gte: now },
                        thresholdAmount: { lte: totalAmount }
                  },
                  orderBy: {
                        thresholdAmount: 'desc' // 选择满足条件的最高阈值规则
                  }
            });

            // 计算折扣金额
            let discountAmount = 0;
            let promotionInfo = null;

            if (applicablePromotion) {
                  promotionInfo = {
                        id: applicablePromotion.id,
                        name: applicablePromotion.name,
                        type: applicablePromotion.type,
                        thresholdAmount: applicablePromotion.thresholdAmount,
                        discountAmount: applicablePromotion.discountAmount
                  };

                  if (applicablePromotion.type === 'AMOUNT_OFF') {
                        // 满减优惠
                        discountAmount = applicablePromotion.discountAmount;
                  } else if (applicablePromotion.type === 'PERCENT_OFF') {
                        // 折扣优惠
                        discountAmount = Math.floor(totalAmount * (applicablePromotion.discountAmount / 100));
                  }

                  // 确保折扣金额不超过订单总金额
                  discountAmount = Math.min(discountAmount, totalAmount);
            }

            // 计算最终支付金额
            const paymentAmount = totalAmount - discountAmount;

            res.sendSuccess({
                  totalAmount,
                  discountAmount,
                  paymentAmount,
                  promotion: promotionInfo,
                  cartItems: cartItems.map(item => ({
                        id: item.id,
                        quantity: item.quantity,
                        skuId: item.skuId,
                        productId: item.productId,
                        unitPrice: skuMap.get(item.skuId)?.promotion_price || skuMap.get(item.skuId)?.price || 0
                  }))
            });
      })

};