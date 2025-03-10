// src/services/inventory.service.ts
import { prisma, redisClient } from '../config';
import { StockChangeType } from '../constants/stock.constants';
import { cacheUtils } from '../utils/cache.utils';

class InventoryService {
      // 改进库存预占 - 使用分布式锁和 Lua 脚本保证原子性
      async preOccupyInventory(skuId: number, quantity: number, orderNo: string, timeout: number = 600): Promise<boolean> {
            try {
                  // 使用 Lua 脚本确保库存检查和锁定的原子性
                  const luaScript = `
        local skuKey = KEYS[1]
        local lockKey = KEYS[2]
        local releaseKey = KEYS[3]
        local quantity = tonumber(ARGV[1])
        local timeout = tonumber(ARGV[2])
        
        -- 检查是否已经有锁
        if redis.call('exists', lockKey) == 1 then
          return false
        end
        
        -- 设置锁
        redis.call('set', lockKey, 1, 'EX', 5)
        
        -- 检查当前库存（从缓存获取）
        local currentStock = tonumber(redis.call('get', skuKey) or -1)
        
        -- 如果缓存中没有库存数据，返回失败
        if currentStock == -1 then
          redis.call('del', lockKey)
          return false
        end
        
        -- 检查库存是否足够
        if currentStock < quantity then
          redis.call('del', lockKey)
          return false
        end
        
        -- 更新缓存中的库存
        redis.call('decrby', skuKey, quantity)
        
        -- 设置释放键，用于自动释放
        redis.call('set', releaseKey, quantity, 'EX', timeout)
        
        -- 释放锁
        redis.call('del', lockKey)
        
        return true
      `;

                  // 准备 Redis 键和参数
                  const skuStockKey = `inventory:stock:${skuId}`;
                  const lockKey = `inventory:lock:${skuId}`;
                  const releaseKey = `inventory:release:${skuId}:${orderNo}`;

                  // 首先确保库存缓存存在
                  await this.ensureStockCache(skuId);

                  // 执行 Lua 脚本
                  const result = await redisClient.eval(
                        luaScript,
                        {
                          keys: [skuStockKey, lockKey, releaseKey],
                          arguments: [quantity.toString(), timeout.toString()]
                        }
                      );

                  if (!result) {
                        return false;
                  }

                  // 异步更新数据库库存
                  await this.updateDatabaseStock(skuId, -quantity, StockChangeType.ORDER_LOCK, orderNo);
                  return true;
            } catch (error) {
                  console.error('库存预占失败:', error);
                  return false;
            }
      }

      // 确保库存缓存存在
      private async ensureStockCache(skuId: number): Promise<void> {
            const skuStockKey = `inventory:stock:${skuId}`;
            const exists = await redisClient.exists(skuStockKey);

            if (!exists) {
                  // 从数据库获取最新库存
                  const sku = await prisma.sku.findUnique({
                        where: { id: skuId },
                        select: { stock: true }
                  });

                  if (sku) {
                        // 设置库存缓存，有效期1小时
                        await redisClient.set(skuStockKey, sku.stock || 0, { EX: 3600 });
                  }
            }
      }

      // 更新数据库库存记录
      private async updateDatabaseStock(
            skuId: number,
            changeQuantity: number,
            type: StockChangeType,
            orderNo: string
      ): Promise<void> {
            try {
                  await prisma.$transaction(async (tx) => {
                        // 获取当前SKU
                        const sku = await tx.sku.findUnique({
                              where: { id: skuId },
                              select: { id: true, stock: true, lockedStock: true }
                        });

                        if (!sku) return;

                        // 更新库存状态
                        if (type === StockChangeType.ORDER_LOCK) {
                              // 锁定库存 - 增加锁定数量
                              await tx.sku.update({
                                    where: { id: skuId },
                                    data: {
                                          lockedStock: { increment: Math.abs(changeQuantity) }
                                    }
                              });
                        } else if (type === StockChangeType.ORDER_RELEASE) {
                              // 释放锁定库存
                              const newLockedStock = Math.max(0, (sku.lockedStock || 0) - Math.abs(changeQuantity));
                              await tx.sku.update({
                                    where: { id: skuId },
                                    data: { lockedStock: newLockedStock }
                              });
                        } else if (type === StockChangeType.STOCK_OUT) {
                              // 实际扣减库存和锁定库存
                              const newStock = Math.max(0, (sku.stock || 0) - Math.abs(changeQuantity));
                              const newLockedStock = Math.max(0, (sku.lockedStock || 0) - Math.abs(changeQuantity));
                              await tx.sku.update({
                                    where: { id: skuId },
                                    data: {
                                          stock: newStock,
                                          lockedStock: newLockedStock
                                    }
                              });
                        }

                        // 记录库存变更日志
                        await tx.stockLog.create({
                              data: {
                                    skuId,
                                    changeQuantity,
                                    currentStock: sku.stock || 0,
                                    type,
                                    orderNo,
                                    remark: this.getStockChangeRemark(type, orderNo),
                                    operator: 'system'
                              }
                        });
                  });
            } catch (error) {
                  console.error('更新数据库库存失败:', error);
                  // 在这里重试或记录错误，但不抛出异常
            }
      }

      // 获取库存变更备注
      private getStockChangeRemark(type: StockChangeType, orderNo: string): string {
            switch (type) {
                  case StockChangeType.ORDER_LOCK:
                        return `订单${orderNo}预占库存`;
                  case StockChangeType.ORDER_RELEASE:
                        return `订单${orderNo}释放预占库存`;
                  case StockChangeType.STOCK_OUT:
                        return `订单${orderNo}确认扣减库存`;
                  default:
                        return `库存变更 - 订单${orderNo}`;
            }
      }

      // 确认扣减预占库存
      async confirmPreOccupied(skuId: number, quantity: number, orderNo: string): Promise<boolean> {
            try {
                  // 删除预占释放标记
                  const releaseKey = `inventory:release:${skuId}:${orderNo}`;
                  await redisClient.del(releaseKey);

                  // 更新数据库库存
                  await this.updateDatabaseStock(skuId, -quantity, StockChangeType.STOCK_OUT, orderNo);
                  return true;
            } catch (error) {
                  console.error('确认库存扣减失败:', error);
                  return false;
            }
      }

      // 释放预占库存
      async releasePreOccupied(skuId: number, quantity: number, orderNo: string): Promise<boolean> {
            try {
                  // 删除预占释放标记
                  const releaseKey = `inventory:release:${skuId}:${orderNo}`;
                  await redisClient.del(releaseKey);

                  // 更新缓存中的库存
                  const skuStockKey = `inventory:stock:${skuId}`;
                  await redisClient.incrBy(skuStockKey, quantity);

                  // 更新数据库库存
                  await this.updateDatabaseStock(skuId, quantity, StockChangeType.ORDER_RELEASE, orderNo);
                  return true;
            } catch (error) {
                  console.error('释放预占库存失败:', error);
                  return false;
            }
      }

      // 批量更新库存 - 优化为单个事务
      async batchUpdateInventory(updates: Array<{ skuId: number, quantity: number, type: StockChangeType, orderNo: string }>) {
            // 按SKU ID对更新进行分组
            const updatesBySkuId = new Map();

            for (const update of updates) {
                  if (!updatesBySkuId.has(update.skuId)) {
                        updatesBySkuId.set(update.skuId, {
                              totalQuantity: 0,
                              details: []
                        });
                  }

                  const entry = updatesBySkuId.get(update.skuId);
                  entry.totalQuantity += update.quantity;
                  entry.details.push(update);
            }

            // 批量处理库存更新，使用单一事务
            await prisma.$transaction(async (tx) => {
                  for (const [skuId, data] of updatesBySkuId.entries()) {
                        const { totalQuantity, details } = data;

                        // 获取当前SKU
                        const sku = await tx.sku.findUnique({
                              where: { id: skuId },
                              select: { id: true, stock: true, lockedStock: true }
                        });

                        if (!sku) continue;

                        // 计算新的库存和锁定库存
                        let newStock = sku.stock || 0;
                        let newLockedStock = sku.lockedStock || 0;

                        // 根据操作类型调整库存
                        for (const detail of details) {
                              if (detail.type === StockChangeType.ORDER_LOCK) {
                                    newLockedStock += Math.abs(detail.quantity);
                              } else if (detail.type === StockChangeType.ORDER_RELEASE) {
                                    newLockedStock = Math.max(0, newLockedStock - Math.abs(detail.quantity));
                              } else if (detail.type === StockChangeType.STOCK_OUT) {
                                    newStock = Math.max(0, newStock - Math.abs(detail.quantity));
                                    newLockedStock = Math.max(0, newLockedStock - Math.abs(detail.quantity));
                              }
                        }

                        // 更新SKU库存
                        await tx.sku.update({
                              where: { id: skuId },
                              data: {
                                    stock: newStock,
                                    lockedStock: newLockedStock
                              }
                        });

                        // 批量创建库存日志
                        await tx.stockLog.createMany({
                              data: details.map((detail: { quantity: any; type: StockChangeType; orderNo: string; }) => ({
                                    skuId,
                                    changeQuantity: detail.quantity,
                                    currentStock: newStock,
                                    type: detail.type,
                                    orderNo: detail.orderNo,
                                    remark: this.getStockChangeRemark(detail.type, detail.orderNo),
                                    operator: 'system'
                              }))
                        });

                        // 更新库存缓存
                        const skuStockKey = `inventory:stock:${skuId}`;
                        await redisClient.set(skuStockKey, newStock, { EX: 3600 });
                  }
            });

            return true;
      }

      // 获取商品库存 - 带缓存
      async getProductStock(productId: number): Promise<{ skuId: number, stock: number }[]> {
            return await cacheUtils.multiLevelCache(
                  `product:${productId}:stock`,
                  async () => {
                        const skus = await prisma.sku.findMany({
                              where: { productId },
                              select: { id: true, stock: true }
                        });
                        return skus.map(sku => ({ skuId: sku.id, stock: sku.stock || 0 }));
                  },
                  60 // 1分钟缓存
            );
      }
}

export const inventoryService = new InventoryService();