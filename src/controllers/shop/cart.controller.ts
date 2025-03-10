// src/controllers/shop/cart.controller.ts
import { Request, Response } from 'express';
import { prisma, redisClient } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { ProductStatus } from '@prisma/client';

export const cartController = {
      // 优化后的addToCart方法
      addToCart: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { productId, skuId, quantity = 1 } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }


            // 使用Redis缓存控制重复请求
            const throttleKey = `cart:throttle:${userId}:${productId}:${skuId}`;
            const isThrottled = await redisClient.exists(throttleKey);
            if (isThrottled) {
                  return res.sendSuccess(null, '商品已添加到购物车');
            }

            // 设置短暂的节流时间 - 300ms
            await redisClient.setEx(throttleKey, 1, '1');

            try {
                  // 单次查询获取所有必要数据
                  const [existingCartItem, productAndSku] = await Promise.all([
                        // 查询购物车中是否已存在
                        prisma.userCartItem.findFirst({
                              where: { userId, productId, skuId }
                        }),
                        // 单次查询获取商品和SKU信息
                        prisma.product.findFirst({
                              where: {
                                    id: productId,
                                    status: ProductStatus.ONLINE
                              },
                              select: {
                                    id: true,
                                    name: true,
                                    mainImage: true,
                                    skus: {
                                          where: { id: skuId },
                                          select: {
                                                id: true,
                                                price: true,
                                                promotion_price: true,
                                                stock: true
                                          }
                                    }
                              }
                        })
                  ]);

                  // 商品或SKU不存在
                  if (!productAndSku || productAndSku.skus.length === 0) {
                        throw new AppError(404, 'fail', '商品不存在或已下架');
                  }

                  const product = productAndSku;
                  const sku = productAndSku.skus[0];

                  // 库存检查
                  const isLowStock = (sku.stock || 0) < quantity;
                  const effectiveQuantity = isLowStock ? sku.stock || 0 : quantity;

                  if (effectiveQuantity <= 0) {
                        throw new AppError(400, 'fail', '商品库存不足');
                  }

                  // 使用单个事务处理购物车更新和计数
                  const result = await prisma.$transaction(async (tx) => {
                        let cartItem;

                        if (existingCartItem) {
                              // 更新购物车项
                              cartItem = await tx.userCartItem.update({
                                    where: { id: existingCartItem.id },
                                    data: {
                                          quantity: existingCartItem.quantity + effectiveQuantity,
                                          updatedAt: new Date()
                                    }
                              });
                        } else {
                              // 创建新购物车项
                              cartItem = await tx.userCartItem.create({
                                    data: {
                                          userId,
                                          productId,
                                          skuId,
                                          quantity: effectiveQuantity
                                    }
                              });
                        }

                        // 直接在事务中获取购物车总数
                        const cartItemCount = await tx.userCartItem.count({
                              where: { userId }
                        });

                        return { cartItem, cartItemCount };
                  });

                  // 构建响应数据
                  const responseData = {
                        cartItem: {
                              ...result.cartItem,
                              product: { id: product.id, name: product.name },
                              sku: {
                                    id: sku.id,
                                    price: sku.promotion_price || sku.price,
                                    stock: sku.stock
                              }
                        },
                        cartItemCount: result.cartItemCount,
                        isLowStock
                  };

                  // 返回适当的提示
                  if (isLowStock) {
                        return res.sendSuccess(responseData, '已加入购物车，但库存不足');
                  }

                  res.sendSuccess(responseData, '商品已成功添加到购物车');
            } catch (error) {
                  if (error instanceof AppError) throw error;
                  throw new AppError(500, 'fail', '添加购物车失败，请稍后重试');
            }
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
        
            // 获取购物车项，只包含允许的关联
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
        
            // 获取SKU信息 - 单独查询
            const skuIds = cartItems.map(item => item.skuId);
            const skus = await prisma.sku.findMany({
                where: {
                    id: { in: skuIds }
                },
                include: {
                    sku_specs: {
                        include: {
                            spec: true,
                            specValue: true
                        }
                    }
                }
            });
        
            // 创建SKU映射以便快速查找
            const skuMap = new Map(skus.map(sku => [sku.id, sku]));
        
            // 处理数据并检查商品状态和库存
            const processedCartItems = cartItems.map(item => {
                const sku = skuMap.get(item.skuId);
                return {
                    id: item.id,
                    userId: item.userId,
                    productId: item.productId,
                    skuId: item.skuId,
                    quantity: item.quantity,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt,
                    product: item.product,
                    skuData: sku || null, // 使用不同的属性名避免类型冲突
                    isAvailable: 
                        item.product.status === ProductStatus.ONLINE && 
                        sku && (sku.stock || 0) > 0
                };
            });
        
            res.sendSuccess({
                total,
                page: pageNumber,
                limit: limitNumber,
                data: processedCartItems
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
      // src/controllers/shop/cart.controller.ts 中优化预览订单API
      previewOrderAmount: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { cartItemIds, productInfo } = req.body;

            if (!userId) {
                  throw new AppError(401, 'fail', '请先登录');
            }

            let totalAmount = 0;
            let items = [];

            // 处理购物车模式
            if (cartItemIds && cartItemIds.length > 0) {
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
                  for (const cartItem of cartItems) {
                        const sku = skuMap.get(cartItem.skuId);
                        if (!sku) continue;

                        // 使用促销价或原价
                        const unitPrice = sku.promotion_price || sku.price;
                        totalAmount += unitPrice * cartItem.quantity;

                        items.push({
                              id: cartItem.id,
                              quantity: cartItem.quantity,
                              skuId: cartItem.skuId,
                              productId: cartItem.productId,
                              unitPrice: sku.promotion_price || sku.price || 0
                        });
                  }
            }
            // 处理直接购买模式
            else if (productInfo) {
                  const { productId, skuId, quantity } = productInfo;

                  // 验证商品和SKU
                  const [product, sku] = await Promise.all([
                        prisma.product.findFirst({
                              where: {
                                    id: productId,
                                    status: ProductStatus.ONLINE
                              }
                        }),
                        prisma.sku.findFirst({
                              where: {
                                    id: skuId,
                                    productId
                              }
                        })
                  ]);

                  if (!product) {
                        throw new AppError(404, 'fail', '商品不存在或已下架');
                  }

                  if (!sku) {
                        throw new AppError(404, 'fail', 'SKU不存在');
                  }

                  // 计算金额
                  const unitPrice = sku.promotion_price || sku.price;
                  totalAmount = unitPrice * quantity;

                  items.push({
                        quantity,
                        skuId,
                        productId,
                        unitPrice
                  });
            } else {
                  throw new AppError(400, 'fail', '参数错误');
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
                  items
            });
      }),

};