// src/validators/admin/sku.validator.ts
import { z } from 'zod';

// 通用验证规则
const skuSpecSchema = z.object({
      specId: z.number().int().positive('规格ID必须是正整数'),
      specValueId: z.number().int().positive('规格值ID必须是正整数')
});

// 创建SKU基础信息验证
export const createSkusSchema = z.object({
      params: z.object({
            productId: z.string().regex(/^\d+$/, '无效的商品ID')
      }),
      body: z.object({
            skus: z.array(z.object({
                  specs: z.array(skuSpecSchema)
                        .min(1, '至少需要一个规格组合'),
                  skuCode: z.string()
                        .min(1, 'SKU编码不能为空')
                        .max(100, 'SKU编码不能超过100个字符')
            }))
                  .min(1, '至少需要一个SKU')
      })
});

// 批量设置SKU价格验证
export const updatePricesSchema = z.object({
      params: z.object({
            productId: z.string().regex(/^\d+$/, '无效的商品ID')
      }),
      body: z.object({
            items: z.array(z.object({
                  skuId: z.number().int().positive('SKU ID必须是正整数'),
                  price: z.number().int().positive('价格必须是正整数')
            }))
                  .min(1, '至少需要一个SKU')
      })
});

// 更新SKU库存验证
export const updateStockSchema = z.object({
      params: z.object({
            productId: z.string().regex(/^\d+$/, '无效的商品ID')
      }),
      body: z.object({
            items: z.array(z.object({
                  skuId: z.number().int().positive('SKU ID必须是正整数'),
                  changeQuantity: z.number().int().refine(value => value !== 0, '变更数量不能为0'),
                  remark: z.string().max(255, '备注不能超过255个字符').optional()
            }))
                  .min(1, '至少需要一个SKU')
      })
});

// 批量设置SKU促销价验证
export const updatePromotionPricesSchema = z.object({
      params: z.object({
            productId: z.string().regex(/^\d+$/, '无效的商品ID')
      }),
      body: z.object({
            items: z.array(z.object({
                  skuId: z.number().int().positive('SKU ID必须是正整数'),
                  promotionPrice: z.number().int().positive('促销价必须是正整数')
            }))
                  .min(1, '至少需要一个SKU')
      })
});

// 获取SKU列表验证
export const getSkuListSchema = z.object({
      params: z.object({
            productId: z.string().regex(/^\d+$/, '无效的商品ID')
      }),
      query: z.object({
            withSpecs: z.enum(['0', '1']).optional().default('1'),  // 是否包含规格信息
            withStock: z.enum(['0', '1']).optional().default('1')   // 是否包含库存记录
      }).optional()
});

// 取消商品促销验证
export const cancelPromotionSchema = z.object({
      params: z.object({
            productId: z.string().regex(/^\d+$/, '无效的商品ID')
      })
});