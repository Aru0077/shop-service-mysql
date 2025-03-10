// 添加到 src/services/inventory.service.ts
import { prisma, redisClient } from '../config';
import { StockChangeType } from '../constants/stock.constants';

class InventoryService {
      // 库存预占
      async preOccupyInventory(skuId: number, quantity: number, orderNo: string, timeout: number = 600): Promise<boolean> {
            try {
                  // 1. 先检查库存是否足够
                  const sku = await prisma.sku.findUnique({
                        where: { id: skuId },
                        select: { id: true, stock: true, lockedStock: true }
                  });

                  if (!sku || (sku.stock || 0) < quantity) {
                        return false;
                  }

                  // 2. 加锁进行库存锁定
                  const lockKey = `inventory:lock:${skuId}`;
                  const acquireLock = await redisClient.set(lockKey, '1', {
                        EX: 5,  // 5秒锁超时
                        NX: true
                  });

                  if (!acquireLock) {
                        // 获取锁失败，稍后重试
                        return false;
                  }

                  try {
                        // 3. 再次检查库存并执行预占
                        const currentSku = await prisma.sku.findUnique({
                              where: { id: skuId },
                              select: { id: true, stock: true, lockedStock: true }
                        });

                        if (!currentSku || (currentSku.stock || 0) < quantity) {
                              return false;
                        }

                        // 4. 更新锁定库存
                        await prisma.sku.update({
                              where: { id: skuId },
                              data: {
                                    lockedStock: { increment: quantity }
                              }
                        });

                        // 5. 记录库存变更日志
                        await prisma.stockLog.create({
                              data: {
                                    skuId,
                                    changeQuantity: -quantity,
                                    currentStock: currentSku.stock || 0,
                                    type: StockChangeType.ORDER_LOCK,
                                    orderNo,
                                    remark: `订单${orderNo}预占库存`,
                                    operator: 'system'
                              }
                        });

                        // 6. 设置预占超时自动释放
                        const releaseKey = `inventory:release:${skuId}:${orderNo}`;
                        await redisClient.setEx(releaseKey, timeout, quantity.toString());

                        return true;
                  } finally {
                        // 释放库存锁
                        await redisClient.del(lockKey);
                  }
            } catch (error) {
                  console.error('库存预占失败:', error);
                  return false;
            }
      }

      // 确认扣减预占库存
      async confirmPreOccupied(skuId: number, quantity: number, orderNo: string): Promise<boolean> {
            try {
                  // 1. 获取库存锁
                  const lockKey = `inventory:lock:${skuId}`;
                  const acquireLock = await redisClient.set(lockKey, '1', {
                        EX: 5,
                        NX: true
                  });

                  if (!acquireLock) {
                        return false;
                  }

                  try {
                        // 2. 删除预占释放标记
                        const releaseKey = `inventory:release:${skuId}:${orderNo}`;
                        await redisClient.del(releaseKey);

                        // 3. 更新实际库存
                        const sku = await prisma.sku.findUnique({
                              where: { id: skuId },
                              select: { id: true, stock: true, lockedStock: true }
                        });

                        if (!sku) {
                              return false;
                        }

                        const newStock = Math.max(0, (sku.stock || 0) - quantity);
                        const newLockedStock = Math.max(0, (sku.lockedStock || 0) - quantity);

                        await prisma.sku.update({
                              where: { id: skuId },
                              data: {
                                    stock: newStock,
                                    lockedStock: newLockedStock
                              }
                        });

                        // 4. 记录库存变更日志
                        await prisma.stockLog.create({
                              data: {
                                    skuId,
                                    changeQuantity: -quantity,
                                    currentStock: newStock,
                                    type: StockChangeType.STOCK_OUT,
                                    orderNo,
                                    remark: `订单${orderNo}确认扣减库存`,
                                    operator: 'system'
                              }
                        });

                        return true;
                  } finally {
                        // 释放锁
                        await redisClient.del(lockKey);
                  }
            } catch (error) {
                  console.error('确认库存扣减失败:', error);
                  return false;
            }
      }

      // 释放预占库存
      async releasePreOccupied(skuId: number, quantity: number, orderNo: string): Promise<boolean> {
            try {
                  // 1. 获取锁
                  const lockKey = `inventory:lock:${skuId}`;
                  const acquireLock = await redisClient.set(lockKey, '1', {
                        EX: 5,
                        NX: true
                  });

                  if (!acquireLock) {
                        return false;
                  }

                  try {
                        // 2. 更新锁定库存
                        const sku = await prisma.sku.findUnique({
                              where: { id: skuId },
                              select: { id: true, lockedStock: true }
                        });

                        if (!sku) {
                              return false;
                        }

                        const newLockedStock = Math.max(0, (sku.lockedStock || 0) - quantity);

                        await prisma.sku.update({
                              where: { id: skuId },
                              data: {
                                    lockedStock: newLockedStock
                              }
                        });

                        // 3. 记录库存变更日志
                        await prisma.stockLog.create({
                              data: {
                                    skuId,
                                    changeQuantity: quantity,
                                    currentStock: sku.lockedStock || 0,
                                    type: StockChangeType.ORDER_RELEASE,
                                    orderNo,
                                    remark: `订单${orderNo}释放预占库存`,
                                    operator: 'system'
                              }
                        });

                        return true;
                  } finally {
                        // 释放锁
                        await redisClient.del(lockKey);
                  }
            } catch (error) {
                  console.error('释放预占库存失败:', error);
                  return false;
            }
      }

      // 库存批量更新优化 - 在inventoryService中添加
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

            // 批量处理库存更新
            await prisma.$transaction(async (tx) => {
                  for (const [skuId, data] of updatesBySkuId.entries()) {
                        const { totalQuantity, details } = data;

                        // 一次性更新SKU库存
                        const sku = await tx.sku.update({
                              where: { id: skuId },
                              data: { stock: { decrement: Math.abs(totalQuantity) } },
                              select: { id: true, stock: true }
                        });

                        // 批量创建库存日志
                        await tx.stockLog.createMany({
                              data: details.map((detail: { quantity: any; type: any; orderNo: any; }) => ({
                                    skuId,
                                    changeQuantity: detail.quantity,
                                    currentStock: sku.stock,
                                    type: detail.type,
                                    orderNo: detail.orderNo,
                                    remark: `批量库存更新`,
                                    operator: 'system'
                              }))
                        });
                  }
            });

            return true;
      }
}

export const inventoryService = new InventoryService();