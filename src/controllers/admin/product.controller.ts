// src/controllers/admin/product.controller.ts
import { Request, Response } from 'express';
import { prisma, redisClient } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { ProductStatus } from '@prisma/client';



export const productController = {
      // 创建商品基础信息
      create: asyncHandler(async (req: Request, res: Response) => {
            const { name, categoryId, content, mainImage, detailImages, is_promotion, productCode } = req.body;

            const category = await prisma.category.findUnique({
                  where: { id: categoryId }
            });

            if (!category) {
                  throw new AppError(400, 'fail', '商品分类不存在');
            }

            const existingProduct = await prisma.product.findUnique({
                  where: { productCode }
            });

            if (existingProduct) {
                  throw new AppError(400, 'fail', '商品编码已存在');
            }

            const product = await prisma.product.create({
                  data: {
                        name,
                        categoryId,
                        content,
                        mainImage,
                        detailImages: detailImages ? JSON.stringify(detailImages) : undefined, // 添加详情图片
                        is_promotion: is_promotion || 0,
                        productCode,
                        status: ProductStatus.DRAFT
                  }
            });

            res.sendSuccess(product, '商品创建成功');
      }),

      // 更新商品基础信息
      update: asyncHandler(async (req: Request, res: Response) => {
            const { id } = req.params;
            const updateData = { ...req.body };

            const existingProduct = await prisma.product.findUnique({
                  where: { id: parseInt(id) }
            });

            if (!existingProduct) {
                  throw new AppError(404, 'fail', '商品不存在');
            }

            if (updateData.categoryId) {
                  const category = await prisma.category.findUnique({
                        where: { id: parseInt(updateData.categoryId) }
                  });

                  if (!category) {
                        throw new AppError(400, 'fail', '商品分类不存在');
                  }
                  updateData.categoryId = parseInt(updateData.categoryId);
            }

            // 处理详情图片数组
            if (updateData.detailImages !== undefined) {
                  // 如果传入空数组或 null，则设置为 null
                  if (!updateData.detailImages || updateData.detailImages.length === 0) {
                        updateData.detailImages = null;
                  } else {
                        // 确保传入的是数组，并转换为 JSON 字符串
                        updateData.detailImages = Array.isArray(updateData.detailImages)
                              ? JSON.stringify(updateData.detailImages)
                              : null;
                  }
            } else {
                  // 如果未传入 detailImages，从更新数据中删除该字段
                  delete updateData.detailImages;
            }

            const product = await prisma.product.update({
                  where: { id: parseInt(id) },
                  data: updateData
            });

            res.sendSuccess(product, '商品更新成功');
      }),

      // 更新商品状态
      updateStatus: asyncHandler(async (req: Request, res: Response) => {
            const { id } = req.params;
            const { status: newStatus } = req.body;

            const product = await prisma.product.findUnique({
                  where: { id: parseInt(id) },
                  include: { skus: true }
            });

            if (!product) {
                  throw new AppError(404, 'fail', '商品不存在');
            }

            if (!product.status || !Object.values(ProductStatus).includes(product.status as ProductStatus)) {
                  throw new AppError(400, 'fail', '当前商品状态无效');
            }

            // 仅在切换到上架状态时验证 SKU 和库存
            if (newStatus === ProductStatus.ONLINE) {
                  if (!product.skus.length) {
                        throw new AppError(400, 'fail', '商品未配置SKU，无法上架');
                  }

                  const hasStock = product.skus.some(sku => (sku.stock || 0) > 0);
                  if (!hasStock) {
                        throw new AppError(400, 'fail', '商品库存为0，无法上架');
                  }

                  // 验证是否配置了价格
                  const hasPrice = product.skus.every(sku => sku.price > 0);
                  if (!hasPrice) {
                        throw new AppError(400, 'fail', '商品存在未配置价格的SKU，无法上架');
                  }
            }

            const updatedProduct = await prisma.product.update({
                  where: { id: parseInt(id) },
                  data: { status: newStatus as ProductStatus }
            });

            res.sendSuccess(updatedProduct, '商品状态更新成功');
      }),

      // 获取商品列表
      getList: asyncHandler(async (req: Request, res: Response) => {
            const {
                  page = '1',
                  limit = '10',
                  categoryId,
                  status,
                  is_promotion,
                  sort,
                  order,
                  keyword
            } = req.query;

            const cacheKey = `products:${JSON.stringify(req.query)}`;
            const cachedData = await redisClient.get(cacheKey);

            if (cachedData) {
                  return res.sendSuccess(JSON.parse(cachedData));
            }

            const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
            const where: any = {};

            if (categoryId) where.categoryId = parseInt(categoryId as string);
            if (status) where.status = status;
            if (is_promotion) where.is_promotion = parseInt(is_promotion as string);
            if (keyword) {
                  where.OR = [
                        { name: { contains: keyword as string } },
                        { productCode: { contains: keyword as string } }
                  ];
            }

            const orderBy: any = {};
            if (sort) {
                  switch (sort) {
                        case 'stock':
                              // 修改为正确的关联查询排序
                              orderBy.skus = { _count: order };
                              break;
                        case 'sales':
                              // 确保使用正确的字段名
                              orderBy.salesCount = order;
                              break;
                        case 'created':
                              // 使用正确的日期字段名
                              orderBy.createdAt = order;
                              break;
                  }
            }

            const [total, products] = await Promise.all([
                  prisma.product.count({ where }),
                  prisma.product.findMany({
                        where,
                        skip,
                        take: parseInt(limit as string),
                        orderBy,
                        include: {
                              category: true,
                              skus: true
                        }
                  })
            ]);

            const responseData = {
                  total,
                  page: parseInt(page as string),
                  limit: parseInt(limit as string),
                  data: products
            };

            await redisClient.setEx(cacheKey, 300, JSON.stringify(responseData));
            res.sendSuccess(responseData, '获取商品列表成功');
      }),

      // 获取商品统计数据
      getStats: asyncHandler(async (req: Request, res: Response) => {
            const [onlineCount, lowStockCount, soldOutCount] = await Promise.all([
                  // Count of online products
                  prisma.product.count({
                        where: { status: ProductStatus.ONLINE }
                  }),
                  // Count of products with low stock (less than 10)
                  prisma.product.count({
                        where: {
                              skus: {
                                    some: {
                                          stock: {
                                                lt: 10,
                                                gt: 0
                                          }
                                    }
                              },
                              status: ProductStatus.ONLINE
                        }
                  }),
                  // Count of sold out products
                  prisma.product.count({
                        where: {
                              skus: {
                                    every: {
                                          stock: 0
                                    }
                              },
                              status: ProductStatus.ONLINE
                        }
                  })
            ]);

            res.sendSuccess({
                  onlineCount,
                  lowStockCount,
                  soldOutCount
            }, '获取商品统计数据成功');
      }),

      // 获取商品库存记录
      getStockLogs: asyncHandler(async (req: Request, res: Response) => {
            const { id } = req.params;
            const { page = '1', limit = '10' } = req.query;

            const productId = parseInt(id);
            const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
            const take = parseInt(limit as string);

            // 验证商品是否存在
            const product = await prisma.product.findUnique({
                  where: { id: productId }
            });

            if (!product) {
                  throw new AppError(404, 'fail', '商品不存在');
            }

            // 获取该商品下所有SKU的ID
            const skus = await prisma.sku.findMany({
                  where: { productId },
                  select: { id: true }
            });

            const skuIds = skus.map(sku => sku.id);

            // 如果没有SKU，直接返回空数据
            if (skuIds.length === 0) {
                  return res.sendSuccess({
                        total: 0,
                        page: parseInt(page as string),
                        limit: parseInt(limit as string),
                        data: []
                  });
            }

            // 查询库存记录
            const [total, stockLogs] = await Promise.all([
                  prisma.stockLog.count({
                        where: {
                              skuId: { in: skuIds }
                        }
                  }),
                  prisma.stockLog.findMany({
                        where: {
                              skuId: { in: skuIds }
                        },
                        orderBy: {
                              createdAt: 'desc'
                        },
                        skip,
                        take,
                        include: {
                              sku: {
                                    select: {
                                          skuCode: true,
                                          sku_specs: {
                                                include: {
                                                      spec: true,
                                                      specValue: true
                                                }
                                          }
                                    }
                              }
                        }
                  })
            ]);

            res.sendSuccess({
                  total,
                  page: parseInt(page as string),
                  limit: parseInt(limit as string),
                  data: stockLogs
            }, '获取商品库存记录成功');
      }),

};