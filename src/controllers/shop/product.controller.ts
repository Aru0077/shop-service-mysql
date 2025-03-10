// src/controllers/shop/product.controller.ts
import { Request, Response } from 'express';
import { prisma, redisClient } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { ProductStatus, } from '@prisma/client';
import { cacheUtils } from '../../utils/cache.utils';
import { CACHE_LEVELS } from '../../utils/cache.utils';

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
            }, CACHE_LEVELS.MEDIUM); // 缓存15分钟

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
      // 改进商品详情查询方法
      getProductDetail: asyncHandler(async (req: Request, res: Response) => {
            const { id } = req.params;
            const productId = Number(id);

            // 1. 获取商品基础信息（不包含SKU），优先从缓存获取
            const basicCacheKey = `shop:product:basic:${productId}`;
            const basicProductDetail = await cacheUtils.multiLevelCache(basicCacheKey, async () => {
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
            }, CACHE_LEVELS.SHORT); // 5分钟缓存

            // 2. 立即返回基础信息，告知客户端SKU信息将稍后加载
            res.sendSuccess({
                  ...basicProductDetail,
                  skus: [],
                  specs: [],
                  validSpecCombinations: {},
                  loadingSkus: true
            });
      }),

      // 新增SKU信息单独获取端点 
      getProductSkus: asyncHandler(async (req: Request, res: Response) => {
            const { id } = req.params;
            const productId = Number(id);

            const skuCacheKey = `shop:product:skus:${productId}`;
            const skuData = await cacheUtils.multiLevelCache(skuCacheKey, async () => {
                  // 使用索引优化查询
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

                  // 高效获取规格矩阵
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

                  // 构建有效规格组合映射
                  const validSpecCombinations = buildSpecCombinationsMap(skus);

                  return {
                        skus,
                        specs,
                        validSpecCombinations
                  };
            }, CACHE_LEVELS.MICRO); // 短时间缓存，保证价格准确性

            res.sendSuccess(skuData);
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
            const { keyword, page = '1', limit = '10', sortBy = 'relevance', categoryId } = req.query;
            const pageNumber = Number(page);
            const limitNumber = Number(limit);
            const skip = (pageNumber - 1) * limitNumber;

            // 使用短时间缓存，因为搜索结果较为个性化
            const cacheKey = `shop:products:search:${keyword}:${categoryId || ''}:${sortBy}:${page}:${limit}`;
            const searchResults = await cacheUtils.multiLevelCache(cacheKey, async () => {
                  // 1. 构建优化的搜索条件
                  let searchCondition: any = {
                        status: ProductStatus.ONLINE
                  };

                  // 2. 智能处理关键词搜索
                  if (keyword) {
                        // 拆分关键词实现更智能的搜索
                        const keywords = (keyword as string).trim().split(/\s+/).filter(Boolean);

                        if (keywords.length > 0) {
                              // 使用组合搜索条件，按重要性排序
                              searchCondition.OR = [
                                    // 精确匹配名称（最高优先级）
                                    { name: { contains: keyword as string } },
                                    // 匹配商品编码
                                    { productCode: { contains: keyword as string } },
                                    // 匹配分词后的关键词（次优先级）
                                    ...keywords.map(kw => ({ name: { contains: kw } }))
                              ];
                        }
                  }

                  // 3. 分类过滤
                  if (categoryId) {
                        // 如果有分类ID，检查该分类是否有子分类
                        const category = await prisma.category.findUnique({
                              where: { id: parseInt(categoryId as string) },
                              select: { id: true, level: true }
                        });

                        if (category) {
                              if (category.level === 1) {
                                    // 一级分类：查询所有子分类
                                    const subCategories = await prisma.category.findMany({
                                          where: { parentId: parseInt(categoryId as string) },
                                          select: { id: true }
                                    });

                                    const categoryIds = [parseInt(categoryId as string), ...subCategories.map(c => c.id)];
                                    searchCondition.categoryId = { in: categoryIds };
                              } else {
                                    // 二级分类：直接查询
                                    searchCondition.categoryId = parseInt(categoryId as string);
                              }
                        }
                  }

                  // 4. 通过计数查询获取总数
                  const total = await prisma.product.count({ where: searchCondition });

                  // 5. 构建优化的排序条件
                  let orderBy: any = {};
                  switch (sortBy) {
                        case 'price_asc':
                              // 使用子查询获取最低价格，通过Prisma原生SQL
                              orderBy = {
                                    skus: {
                                          _min: {
                                                price: 'asc'
                                          }
                                    }
                              };
                              break;
                        case 'price_desc':
                              orderBy = {
                                    skus: {
                                          _min: {
                                                price: 'desc'
                                          }
                                    }
                              };
                              break;
                        case 'sales':
                              orderBy = { salesCount: 'desc' };
                              break;
                        case 'newest':
                              orderBy = { createdAt: 'desc' };
                              break;
                        case 'relevance':
                        default:
                              // 相关性排序 - 首先按匹配度，然后按销量和创建时间
                              orderBy = [
                                    { salesCount: 'desc' },
                                    { createdAt: 'desc' }
                              ];
                              break;
                  }

                  // 6. 查询匹配商品数据，使用索引优化
                  const products = await prisma.product.findMany({
                        where: searchCondition,
                        include: {
                              category: {
                                    select: {
                                          id: true,
                                          name: true
                                    }
                              },
                              skus: {
                                    orderBy: { price: 'asc' },
                                    take: 1,
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

                  // 7. 增强返回结果
                  const enhancedProducts = products.map(product => {
                        // 计算显示价格和折扣率
                        const sku = product.skus[0];
                        const displayPrice = sku?.promotion_price || sku?.price || 0;
                        const discount = sku?.promotion_price && sku?.price ?
                              Math.round((sku.promotion_price / sku.price) * 100) : null;

                        return {
                              ...product,
                              displayPrice,
                              discount
                        };
                  });

                  return {
                        total,
                        page: pageNumber,
                        limit: limitNumber,
                        data: enhancedProducts,
                        // 添加搜索元数据，帮助客户端优化UI
                        meta: {
                              hasMoreResults: total > skip + products.length,
                              searchTerm: keyword,
                              appliedFilters: categoryId ? { categoryId } : {}
                        }
                  };
            }, CACHE_LEVELS.MICRO); // 10秒缓存

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