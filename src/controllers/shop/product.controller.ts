// src/controllers/shop/product.controller.ts
import { Request, Response } from 'express';
import { prisma, redisClient } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { ProductStatus, } from '@prisma/client';
import { cacheUtils } from '../../utils/cache.utils';

export const productController = {
      // 获取分类树
      getCategoryTree: asyncHandler(async (req: Request, res: Response) => {
            const cacheKey = 'shop:category:tree';

            const categoryTree = await cacheUtils.getOrSet(cacheKey, async () => {
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
            }, 3600); // 缓存1小时

            res.sendSuccess(categoryTree);
      }),

      // 获取新上架商品
      getLatestProducts: asyncHandler(async (req: Request, res: Response) => {
            const { page = '1', limit = '10' } = req.query;
            const pageNumber = Number(page);
            const limitNumber = Number(limit);
            const skip = (pageNumber - 1) * limitNumber;

            const cacheKey = `shop:products:latest:${page}:${limit}`;

            const latestProductsData = await cacheUtils.getOrSet(cacheKey, async () => {
                  const [total, products] = await Promise.all([
                        prisma.product.count({
                              where: {
                                    status: ProductStatus.ONLINE
                              }
                        }),
                        prisma.product.findMany({
                              where: {
                                    status: ProductStatus.ONLINE
                              },
                              include: {
                                    category: {
                                          select: {
                                                id: true,
                                                name: true
                                          }
                                    },
                                    skus: {
                                          take: 1,
                                          orderBy: {
                                                price: 'asc'
                                          },
                                          select: {
                                                price: true,
                                                promotion_price: true
                                          }
                                    }
                              },
                              orderBy: {
                                    createdAt: 'desc'
                              },
                              skip,
                              take: limitNumber
                        })
                  ]);

                  return {
                        total,
                        page: pageNumber,
                        limit: limitNumber,
                        data: products
                  };
            }, 900); // 缓存15分钟

            res.sendSuccess(latestProductsData);
      }),

      // 获取销量最高商品 
      getTopSellingProducts: asyncHandler(async (req: Request, res: Response) => {
            const { page = '1', limit = '10' } = req.query;
            const pageNumber = Number(page);
            const limitNumber = Number(limit);
            const skip = (pageNumber - 1) * limitNumber;

            const cacheKey = `shop:products:top-selling:${page}:${limit}`;

            const topSellingProductsData = await cacheUtils.getOrSet(cacheKey, async () => {
                  // 使用标准 Prisma 查询获取总数
                  const total = await prisma.product.count({
                        where: {
                              status: ProductStatus.ONLINE,
                              salesCount: {
                                    gt: 0
                              }
                        }
                  });

                  // 获取产品数据
                  const products = await prisma.product.findMany({
                        where: {
                              status: ProductStatus.ONLINE,
                              salesCount: {
                                    gt: 0
                              }
                        },
                        include: {
                              category: {
                                    select: {
                                          id: true,
                                          name: true
                                    }
                              },
                              skus: {
                                    take: 1,
                                    orderBy: {
                                          price: 'asc'
                                    },
                                    select: {
                                          price: true,
                                          promotion_price: true
                                    }
                              }
                        },
                        orderBy: {
                              salesCount: 'desc'
                        },
                        skip,
                        take: limitNumber
                  });

                  return {
                        total,
                        page: pageNumber,
                        limit: limitNumber,
                        data: products
                  };
            }, 1800); // 缓存30分钟

            res.sendSuccess(topSellingProductsData);
      }),

      // 分页获取促销商品
      getPromotionProducts: asyncHandler(async (req: Request, res: Response) => {
            const { page = 1, limit = 10 } = req.query;
            const pageNumber = Number(page);
            const limitNumber = Number(limit);
            const skip = (pageNumber - 1) * limitNumber;

            const cacheKey = `shop:products:promotion:${page}:${limit}`;

            const promotionData = await cacheUtils.getOrSet(cacheKey, async () => {
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
                                          }
                                    }
                              },
                              orderBy: {
                                    createdAt: 'desc'
                              },
                              skip,
                              take: limitNumber
                        })
                  ]);

                  return {
                        total,
                        page: pageNumber,
                        limit: limitNumber,
                        data: products
                  };
            }, 600); // 缓存10分钟

            res.sendSuccess(promotionData);
      }),

      // 分页获取分类下的商品列表
      getCategoryProducts: asyncHandler(async (req: Request, res: Response) => {
            const { categoryId } = req.params;
            const { page = 1, limit = 10, sort = 'newest' } = req.query;
            const pageNumber = Number(page);
            const limitNumber = Number(limit);
            const skip = (pageNumber - 1) * limitNumber;
            const categoryIdNumber = Number(categoryId);

            // 验证分类是否存在
            const category = await prisma.category.findUnique({
                  where: { id: categoryIdNumber }
            });

            if (!category) {
                  throw new AppError(404, 'fail', '分类不存在');
            }

            // 获取子分类ID（如果是父分类）
            let categoryIds = [categoryIdNumber];
            if (category.level === 1) {
                  const subCategories = await prisma.category.findMany({
                        where: { parentId: categoryIdNumber }
                  });
                  categoryIds = [...categoryIds, ...subCategories.map(cat => cat.id)];
            }

            // 构建排序条件
            let orderBy: any = { createdAt: 'desc' };
            if (sort === 'price-asc' || sort === 'price-desc') {
                  // 这里需要按SKU最低价格排序，但Prisma不直接支持
                  // 在实际项目中可能需要使用原生SQL或其他方案
                  orderBy = { createdAt: 'desc' }; // 临时使用创建时间排序
            } else if (sort === 'sales') {
                  orderBy = { salesCount: 'desc' };
            }

            const cacheKey = `shop:products:category:${categoryId}:${page}:${limit}:${sort}`;

            const categoryProductsData = await cacheUtils.getOrSet(cacheKey, async () => {
                  // 查询商品总数
                  const total = await prisma.product.count({
                        where: {
                              status: ProductStatus.ONLINE,
                              categoryId: {
                                    in: categoryIds
                              }
                        }
                  });

                  // 查询商品列表
                  const products = await prisma.product.findMany({
                        where: {
                              status: ProductStatus.ONLINE,
                              categoryId: {
                                    in: categoryIds
                              }
                        },
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
                                    }
                              }
                        },
                        orderBy,
                        skip,
                        take: limitNumber
                  });

                  return {
                        total,
                        page: pageNumber,
                        limit: limitNumber,
                        data: products
                  };
            }, 600); // 缓存10分钟

            res.sendSuccess(categoryProductsData);
      }),

      // 获取商品详情
      getProductDetail: asyncHandler(async (req: Request, res: Response) => {
            const { id } = req.params;
            const productId = Number(id);

            // 1. 优先返回基础信息 - 使用更短的缓存时间
            const basicCacheKey = `shop:product:basic:${productId}`;
            const basicProductDetail = await cacheUtils.getOrSet(basicCacheKey, async () => {
                  const product = await prisma.product.findUnique({
                        where: {
                              id: productId,
                              status: ProductStatus.ONLINE
                        },
                        select: {
                              id: true,
                              name: true,
                              content: true,
                              mainImage: true,
                              detailImages: true,
                              is_promotion: true,
                              categoryId: true,
                              category: {
                                    select: {
                                          id: true,
                                          name: true
                                    }
                              }
                        }
                  });

                  if (!product) {
                        throw new AppError(404, 'fail', '商品不存在或已下架');
                  }

                  return product;
            }, 600); // 10分钟缓存

            // 2. 异步加载SKU和规格信息 - 使用独立缓存键
            const skuCacheKey = `shop:product:skus:${productId}`;
            const skuData = await cacheUtils.getOrSet(skuCacheKey, async () => {
                  const skus = await prisma.sku.findMany({
                        where: {
                              productId,
                              product: {
                                    status: ProductStatus.ONLINE
                              }
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

                  // 获取规格矩阵，用于前端渲染规格选择器
                  const specs = await prisma.spec.findMany({
                        where: {
                              skuSpecs: {
                                    some: {
                                          skus: { productId }
                                    }
                              }
                        },
                        include: {
                              values: {
                                    where: {
                                          skuSpecs: {
                                                some: {
                                                      skus: { productId }
                                                }
                                          }
                                    }
                              }
                        }
                  });

                  // 构建有效规格组合映射，辅助前端规格选择
                  const validSpecCombinations = buildSpecCombinationsMap(skus);

                  return {
                        skus,
                        specs,
                        validSpecCombinations
                  };
            }, 300); // 5分钟缓存

            // 3. 合并数据并返回
            const completeProductDetail = {
                  ...basicProductDetail,
                  ...skuData
            };

            // 4. 异步记录商品访问（不阻塞响应）
            setImmediate(() => {
                  try {
                        // 此处可添加访问统计逻辑，如Redis计数器递增
                        // 可放入队列进行异步处理
                  } catch (err) {
                        // 记录错误但不影响主流程
                        console.error('记录商品访问统计失败:', err);
                  }
            });

            res.sendSuccess(completeProductDetail);
      }),

      // 获取首页数据（最新商品、热销商品和最新banner）
      getHomePageData: asyncHandler(async (req: Request, res: Response) => {
            const cacheKey = 'shop:home:data';

            const homeData = await cacheUtils.getOrSet(cacheKey, async () => {
                  // 并行获取三种数据
                  const [latestProducts, topSellingProducts, latestBanner] = await Promise.all([
                        // 最新上架商品
                        prisma.product.findMany({
                              where: {
                                    status: ProductStatus.ONLINE
                              },
                              include: {
                                    category: {
                                          select: {
                                                id: true,
                                                name: true
                                          }
                                    },
                                    skus: {
                                          take: 1,
                                          orderBy: {
                                                price: 'asc'
                                          },
                                          select: {
                                                price: true,
                                                promotion_price: true
                                          }
                                    }
                              },
                              orderBy: {
                                    createdAt: 'desc'
                              },
                              take: 6
                        }),

                        // 销量最高商品
                        prisma.product.findMany({
                              where: {
                                    status: ProductStatus.ONLINE,
                                    salesCount: {
                                          gt: 0
                                    }
                              },
                              include: {
                                    category: {
                                          select: {
                                                id: true,
                                                name: true
                                          }
                                    },
                                    skus: {
                                          take: 1,
                                          orderBy: {
                                                price: 'asc'
                                          },
                                          select: {
                                                price: true,
                                                promotion_price: true
                                          }
                                    }
                              },
                              orderBy: {
                                    salesCount: 'desc'
                              },
                              take: 6
                        }),

                        // 最新更新的一条banner
                        prisma.banner.findFirst({
                              orderBy: {
                                    updatedAt: 'desc'
                              }
                        })
                  ]);

                  return {
                        latestProducts,
                        topSellingProducts,
                        banner: latestBanner
                  };
            }, 900); // 缓存15分钟

            res.sendSuccess(homeData);
      }),

      // 搜索商品
      searchProducts: asyncHandler(async (req: Request, res: Response) => {
            const { keyword, page = '1', limit = '10' } = req.query;
            const pageNumber = Number(page);
            const limitNumber = Number(limit);
            const skip = (pageNumber - 1) * limitNumber;

            const cacheKey = `shop:products:search:${keyword}:${page}:${limit}`;

            const searchResults = await cacheUtils.getOrSet(cacheKey, async () => {
                  // 查询匹配商品总数
                  const total = await prisma.product.count({
                        where: {
                              status: ProductStatus.ONLINE,
                              name: {
                                    contains: keyword as string
                              }
                        }
                  });

                  // 查询匹配商品列表
                  const products = await prisma.product.findMany({
                        where: {
                              status: ProductStatus.ONLINE,
                              name: {
                                    contains: keyword as string
                              }
                        },
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
                                    }
                              }
                        },
                        orderBy: {
                              createdAt: 'desc'
                        },
                        skip,
                        take: limitNumber
                  });

                  return {
                        total,
                        page: pageNumber,
                        limit: limitNumber,
                        data: products
                  };
            }, 300); // 缓存5分钟

            res.sendSuccess(searchResults);
      }),
};


// 辅助函数：构建有效规格组合映射
function buildSpecCombinationsMap(skus: any[]) {
      const combinations: Record<string, { skuId: number, stock: number, price: number }> = {};

      skus.forEach(sku => {
            // 将sku的规格组合转换为唯一键
            const specValues = sku.sku_specs.map((spec: any) => spec.specValueId).sort().join('_');
            combinations[specValues] = {
                  skuId: sku.id,
                  stock: sku.stock || 0,
                  price: sku.promotion_price || sku.price
            };
      });

      return combinations;
}