// src/queues/order.queue.ts
import Queue from 'bull';
import { prisma } from '../config';
import { StockChangeType } from '../constants/stock.constants';
import { OrderStatus } from '../constants/orderStatus.enum';

// 创建订单处理队列
export const orderQueue = new Queue('order-processing', {
      redis: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            password: process.env.REDIS_PASSWORD,
            retryStrategy: (times) => {
                  return Math.min(times * 100, 3000);
            }
      }
});

// 添加类型定义
interface OrderItemPayload {
      id: number;
      skuId: number;
      productId: number | null;
      quantity: number;
}


// 处理订单库存和订单项创建 
orderQueue.process('processOrderInventory', async (job) => {
      const { orderId, orderNo, orderItems, inventoryUpdates, cartItemIds } = job.data;

      try {
            // 1. 先创建订单项 - 单独事务
            await prisma.$transaction(async (tx) => {
                  await tx.orderItem.createMany({
                        data: orderItems.map((item: any) => ({
                              orderId,
                              ...item
                        }))
                  });
            }, { timeout: 10000 });

            // 2. 分批处理库存锁定 - 较小批次事务
            const BATCH_SIZE = 5; // 每批处理5个商品
            for (let i = 0; i < inventoryUpdates.length; i += BATCH_SIZE) {
                  const batch = inventoryUpdates.slice(i, i + BATCH_SIZE);

                  await prisma.$transaction(async (tx) => {
                        for (const update of batch) {
                              // 检查库存
                              const sku = await tx.sku.findUnique({
                                    where: { id: update.skuId },
                                    select: { id: true, stock: true }
                              });

                              if (!sku || (sku.stock || 0) < update.quantity) {
                                    continue; // 库存不足，跳过
                              }

                              // 锁定库存
                              await tx.sku.update({
                                    where: { id: update.skuId },
                                    data: { lockedStock: { increment: update.quantity } }
                              });

                              // 记录库存变更
                              await tx.stockLog.create({
                                    data: {
                                          skuId: update.skuId,
                                          changeQuantity: -update.quantity,
                                          currentStock: sku.stock || 0,
                                          type: StockChangeType.ORDER_LOCK,
                                          orderNo,
                                          remark: `创建订单锁定库存 ${orderNo}`,
                                          operator: 'system'
                                    }
                              });
                        }
                  }, { timeout: 10000 });
            }

            // 3. 删除购物车项 - 单独事务
            if (cartItemIds.length > 0) {
                  await prisma.userCartItem.deleteMany({
                        where: { id: { in: cartItemIds } }
                  });
            }

            // 4. 更新订单状态 - 单独事务
            await prisma.order.update({
                  where: { id: orderId },
                  data: {} // 可添加处理完成标记
            });

            return { success: true, orderId, orderNo };
      } catch (error) {
            throw error;
      }
});
// 处理订单支付后的库存扣减 
orderQueue.process('processOrderPayment', async (job) => {
      const { orderId, orderNo, orderItems } = job.data;

      try {
            // 1. 预先加载所有SKU信息
            const skuIds = orderItems.map((item: OrderItemPayload) => item.skuId);
            const skus = await prisma.sku.findMany({
                  where: { id: { in: skuIds } },
                  select: { id: true, stock: true, lockedStock: true }
            });
            const skuMap = new Map(skus.map(sku => [sku.id, sku]));

            // 2. 预先加载所有产品ID - 类型保护
            const productIds = orderItems
                  .map((item: OrderItemPayload) => item.productId)
                  .filter((id:any): id is number => id !== null && id !== undefined);

            // 3. 批量处理库存和销量更新
            const BATCH_SIZE = 5;
            for (let i = 0; i < orderItems.length; i += BATCH_SIZE) {
                  const batch = orderItems.slice(i, i + BATCH_SIZE);

                  await prisma.$transaction(async (tx) => {
                        for (const item of batch as OrderItemPayload[]) {
                              const sku = skuMap.get(item.skuId);
                              if (!sku) continue;

                              // 更新SKU库存
                              await tx.sku.update({
                                    where: { id: item.skuId },
                                    data: {
                                          lockedStock: { decrement: item.quantity },
                                          stock: { decrement: item.quantity }
                                    }
                              });

                              // 记录库存日志
                              await tx.stockLog.create({
                                    data: {
                                          skuId: item.skuId,
                                          changeQuantity: -item.quantity,
                                          currentStock: (sku.stock || 0) - item.quantity,
                                          type: StockChangeType.STOCK_OUT,
                                          orderNo,
                                          remark: `订单支付扣减库存 ${orderNo}`,
                                          operator: 'system'
                                    }
                              });
                        }
                  }, { timeout: 10000 });
            }

            // 4. 批量更新商品销量（单独事务）
            if (productIds.length > 0) {
                  // 按产品ID分组数量 - 使用明确的类型
                  const productQuantities: Record<number, number> = {};
                  for (const item of orderItems as OrderItemPayload[]) {
                        if (!item.productId) continue;
                        productQuantities[item.productId] = (productQuantities[item.productId] || 0) + item.quantity;
                  }

                  // 逐个更新产品销量
                  for (const productIdStr of Object.keys(productQuantities)) {
                        const productId = Number(productIdStr); // 将字符串键转换回数字
                        const quantity = productQuantities[productId];

                        await prisma.product.update({
                              where: { id: productId },
                              data: { salesCount: { increment: quantity } }
                        });
                  }
            }

            return { success: true, orderId, orderNo };
      } catch (error) {
            throw error;
      }
});

// 监听队列错误
orderQueue.on('error', (error) => {
      // logger.error('订单队列错误:', error);
});

orderQueue.on('failed', (job, error) => {
      // logger.error(`任务${job.id}失败:`, error);
});