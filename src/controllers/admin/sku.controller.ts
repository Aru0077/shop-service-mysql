// src/controllers/admin/sku.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { StockChangeType } from '../../constants/stock.constants';

// 添加类型定义
interface SkuSpec {
      specId: number;
      specValueId: number;
}

interface CreateSkuData {
      specs: SkuSpec[];
      skuCode: string;
      image: string;
}

interface updateStockItem {
      skuId: number;
      changeQuantity: number;
      remark?: string
}

export const skuController = {

      // 新增SKU基础信息
      createSkus: asyncHandler(async (req: Request, res: Response) => {
            const { productId } = req.params;
            const { skus } = req.body as { skus: CreateSkuData[] };
            const parsedProductId = parseInt(productId);

            const product = await prisma.product.findUnique({
                  where: { id: parsedProductId }
            });

            if (!product) {
                  throw new AppError(404, 'fail', '商品不存在');
            }

            await prisma.$transaction(async (prisma) => {
                  for (const sku of skus) {
                        await prisma.sku.create({
                              data: {
                                    productId: parsedProductId,
                                    skuCode: sku.skuCode,
                                    image: sku.image,
                                    price: 0,
                                    stock: 0,
                                    sku_specs: {
                                          create: sku.specs.map((spec: SkuSpec) => ({
                                                specId: spec.specId,
                                                specValueId: spec.specValueId
                                          }))
                                    }
                              }
                        });
                  }
            });

            res.sendSuccess(null, 'SKU创建成功');
      }),

      // 批量设置SKU价格
      updatePrices: asyncHandler(async (req: Request, res: Response) => {
            const { productId } = req.params;
            const { items } = req.body as { items: { skuId: number; price: number }[] };
            const parsedProductId = parseInt(productId);

            try {
                  // 验证商品是否存在
                  const product = await prisma.product.findUnique({
                        where: { id: parsedProductId }
                  });

                  if (!product) {
                        throw new AppError(404, 'fail', '商品不存在');
                  }

                  // 预先获取所有相关的SKU信息
                  const skuIds = items.map(item => item.skuId);
                  const existingSkus = await prisma.sku.findMany({
                        where: {
                              id: { in: skuIds },
                              productId: parsedProductId
                        }
                  });

                  // 验证所有SKU是否存在和价格是否有效
                  const skuMap = new Map(existingSkus.map(sku => [sku.id, sku]));
                  items.forEach(item => {
                        if (!skuMap.has(item.skuId)) {
                              throw new AppError(404, 'fail', `SKU ID ${item.skuId} 不存在`);
                        }
                        if (item.price <= 0) {
                              throw new AppError(400, 'fail', `SKU ID ${item.skuId} 价格必须大于0`);
                        }
                  });

                  // 使用事务批量处理更新，设置更长的超时时间
                  await prisma.$transaction(async (tx) => {
                        // 使用 Promise.all 并行处理所有更新
                        await Promise.all(
                              items.map(item =>
                                    tx.sku.update({
                                          where: { id: item.skuId },
                                          data: { price: item.price }
                                    })
                              )
                        );
                  }, {
                        timeout: 15000, // 设置事务超时时间为 15 秒
                        maxWait: 10000 // 设置最大等待时间为 10 秒
                  });

                  res.sendSuccess(null, 'SKU价格更新成功');

            } catch (error) {
                  if (error instanceof AppError) {
                        throw error;
                  }
                  console.error('价格更新失败:', error);
                  throw new AppError(500, 'fail', '价格更新失败，请稍后重试');
            }
      }),

      // 批量设置SKU库存
      updateStock: asyncHandler(async (req: Request, res: Response) => {
            const { productId } = req.params;
            const { items } = req.body;
            const parsedProductId = parseInt(productId);

            try {
                  const product = await prisma.product.findUnique({
                        where: { id: parsedProductId },
                        include: { skus: true }
                  });

                  if (!product) {
                        throw new AppError(404, 'fail', '商品不存在');
                  }

                  // 预先获取所有相关的 SKU 信息
                  const skuIds = items.map((item: updateStockItem) => item.skuId);
                  const existingSkus = await prisma.sku.findMany({
                        where: {
                              id: { in: skuIds },
                              productId: parsedProductId
                        }
                  });

                  // 验证所有 SKU 是否存在和库存是否足够
                  const skuMap = new Map(existingSkus.map(sku => [sku.id, sku]));
                  items.forEach((item: updateStockItem) => {
                        const sku = skuMap.get(item.skuId);
                        if (!sku) {
                              throw new AppError(404, 'fail', `SKU ID ${item.skuId} 不存在`);
                        }
                        const newStock = (sku.stock || 0) + item.changeQuantity;
                        if (newStock < 0) {
                              throw new AppError(400, 'fail', `SKU ID ${item.skuId} 库存不足`);
                        }
                  });

                  // 使用事务批量处理更新
                  await prisma.$transaction(async (tx) => {
                        const updatePromises = items.map((item: updateStockItem) => {
                              const sku = skuMap.get(item.skuId)!;
                              const newStock = (sku.stock || 0) + item.changeQuantity;

                              return Promise.all([
                                    tx.sku.update({
                                          where: { id: item.skuId },
                                          data: { stock: newStock }
                                    }),
                                    tx.stockLog.create({
                                          data: {
                                                skuId: item.skuId,
                                                changeQuantity: item.changeQuantity,
                                                currentStock: newStock,
                                                type: 1,
                                                remark: item.remark || '人工修改库存',
                                                operator: req.user?.username
                                          }
                                    })
                              ]);
                        });

                        await Promise.all(updatePromises);
                  }, {
                        timeout: 15000,
                        maxWait: 10000
                  });

                  // 获取更新后的商品 SKU 列表
                  const updatedSkus = await prisma.sku.findMany({
                        where: { productId: parsedProductId },
                        orderBy: { createdAt: 'asc' }
                  });

                  res.sendSuccess(updatedSkus, '库存更新成功');

            } catch (error) {
                  if (error instanceof AppError) {
                        throw error;
                  }
                  console.error('库存更新失败:', error);
                  throw new AppError(500, 'fail', '库存更新失败，请稍后重试');
            }
      }),

      // 批量设置SKU促销价 
      updatePromotionPrices: asyncHandler(async (req: Request, res: Response) => {
            const { productId } = req.params;
            const { items } = req.body as { items: { skuId: number; promotionPrice: number }[] };
            const parsedProductId = parseInt(productId);

            try {
                  // 验证商品是否存在
                  const product = await prisma.product.findUnique({
                        where: { id: parsedProductId }
                  });

                  if (!product) {
                        throw new AppError(404, 'fail', '商品不存在');
                  }

                  // 预先获取所有相关的SKU信息
                  const skuIds = items.map(item => item.skuId);
                  const existingSkus = await prisma.sku.findMany({
                        where: {
                              id: { in: skuIds },
                              productId: parsedProductId
                        }
                  });

                  // 验证所有SKU是否存在和促销价是否有效
                  const skuMap = new Map(existingSkus.map(sku => [sku.id, sku]));
                  items.forEach(item => {
                        const sku = skuMap.get(item.skuId);
                        if (!sku) {
                              throw new AppError(404, 'fail', `SKU ID ${item.skuId} 不存在`);
                        }
                        if (item.promotionPrice <= 0 || item.promotionPrice >= sku.price) {
                              throw new AppError(400, 'fail', `SKU ID ${item.skuId} 促销价必须大于0且小于原价`);
                        }
                  });

                  // 使用事务批量处理更新，设置更长的超时时间
                  await prisma.$transaction(async (tx) => {
                        // 更新商品促销状态
                        await tx.product.update({
                              where: { id: parsedProductId },
                              data: { is_promotion: 1 }
                        });

                        // 使用 Promise.all 并行处理所有SKU更新
                        await Promise.all(
                              items.map(item =>
                                    tx.sku.update({
                                          where: { id: item.skuId },
                                          data: { promotion_price: item.promotionPrice }
                                    })
                              )
                        );
                  }, {
                        timeout: 15000, // 设置事务超时时间为 15 秒
                        maxWait: 10000 // 设置最大等待时间为 10 秒
                  });

                  res.sendSuccess(null, 'SKU促销价更新成功');

            } catch (error) {
                  if (error instanceof AppError) {
                        throw error;
                  }
                  console.error('促销价更新失败:', error);
                  throw new AppError(500, 'fail', '促销价更新失败，请稍后重试');
            }
      }),

      // 获取商品SKU列表
      getSkuList: asyncHandler(async (req: Request, res: Response) => {
            const { productId } = req.params;
            const { withSpecs = '1', withStock = '1' } = req.query;
            const parsedProductId = parseInt(productId);

            // 验证商品是否存在
            const product = await prisma.product.findUnique({
                  where: { id: parsedProductId }
            });

            if (!product) {
                  throw new AppError(404, 'fail', '商品不存在');
            }

            // 构建查询条件
            const include: any = {
                  sku_specs: withSpecs === '1' ? {
                        include: {
                              spec: true,
                              specValue: true
                        }
                  } : false
            };

            // 查询SKU列表
            const skus = await prisma.sku.findMany({
                  where: { productId: parsedProductId },
                  include,
                  orderBy: { createdAt: 'asc' }
            });

            // 如果需要库存记录
            if (withStock === '1') {
                  const skusWithStock = await Promise.all(
                        skus.map(async (sku) => {
                              const stockLogs = await prisma.stockLog.findMany({
                                    where: { skuId: sku.id },
                                    orderBy: { createdAt: 'desc' },
                                    take: 10  // 最近10条记录
                              });

                              return {
                                    ...sku,
                                    stockLogs
                              };
                        })
                  );

                  res.sendSuccess({
                        total: skusWithStock.length,
                        items: skusWithStock
                  });
                  return;
            }

            res.sendSuccess({
                  total: skus.length,
                  items: skus
            }, '获取SKU成功');
      }),

      // 取消商品促销
      cancelPromotion: asyncHandler(async (req: Request, res: Response) => {
            const { productId } = req.params;
            const parsedProductId = parseInt(productId);

            try {
                  // 验证商品是否存在
                  const product = await prisma.product.findUnique({
                        where: { id: parsedProductId }
                  });

                  if (!product) {
                        throw new AppError(404, 'fail', '商品不存在');
                  }

                  // 使用事务批量处理更新
                  await prisma.$transaction(async (tx) => {
                        // 更新商品促销状态为0
                        await tx.product.update({
                              where: { id: parsedProductId },
                              data: { is_promotion: 0 }
                        });

                        // 清除所有SKU的促销价
                        await tx.sku.updateMany({
                              where: { productId: parsedProductId },
                              data: { promotion_price: null }
                        });
                  }, {
                        timeout: 15000, // 设置事务超时时间为 15 秒
                        maxWait: 10000 // 设置最大等待时间为 10 秒
                  });

                  res.sendSuccess(null, '商品促销已取消');

            } catch (error) {
                  if (error instanceof AppError) {
                        throw error;
                  }
                  console.error('取消促销失败:', error);
                  throw new AppError(500, 'fail', '取消促销失败，请稍后重试');
            }
      }),

};