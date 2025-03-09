// src/queues/order.queue.ts
import Queue from 'bull';
import { prisma } from '../config';
import { StockChangeType } from '../constants/stock.constants';
import { OrderStatus } from '../constants/orderStatus.enum';
import { inventoryService } from '../services/inventory.service';

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


// 创建适当的接口定义
interface InventoryUpdate {
      skuId: number;
      quantity: number;
      productId?: number;
      productName?: string;
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

            // 2. 使用库存服务预占库存
            const preOccupyResults = await Promise.all(
                  inventoryUpdates.map(async (update: InventoryUpdate) => {
                        // 使用库存服务预占库存
                        const success = await inventoryService.preOccupyInventory(
                              update.skuId,
                              update.quantity,
                              orderNo,
                              600 // 10分钟超时
                        );

                        return {
                              skuId: update.skuId,
                              success,
                              quantity: update.quantity
                        };
                  })
            );

            // 检查是否所有库存预占都成功
            const failedItems = preOccupyResults.filter(item => !item.success);
            if (failedItems.length > 0) {
                  // 对失败的预占进行释放处理
                  await Promise.all(
                        preOccupyResults
                              .filter(item => item.success)
                              .map(item => inventoryService.releasePreOccupied(
                                    item.skuId,
                                    item.quantity,
                                    orderNo
                              ))
                  );

                  throw new Error(`库存锁定失败: ${failedItems.map(item => item.skuId).join(',')}`);
            }

            // 3. 删除购物车项
            if (cartItemIds.length > 0) {
                  await prisma.userCartItem.deleteMany({
                        where: { id: { in: cartItemIds } }
                  });
            }

            // 4. 更新订单状态
            await prisma.order.update({
                  where: { id: orderId },
                  data: {}
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
            // 1. 确认扣减预占库存
            const confirmResults = await Promise.all(
                  orderItems.map(async (item: OrderItemPayload) => {
                        // 使用库存服务确认扣减
                        const success = await inventoryService.confirmPreOccupied(
                              item.skuId,
                              item.quantity,
                              orderNo
                        );

                        return {
                              skuId: item.skuId,
                              success,
                              productId: item.productId,
                              quantity: item.quantity
                        };
                  })
            );

            // 处理可能的失败情况 (实际生产环境应有补偿措施)
            const failedItems = confirmResults.filter(item => !item.success);
            if (failedItems.length > 0) {
                  console.error(`订单${orderNo}部分商品库存扣减失败`, failedItems);
                  // 在实际系统中这里应该有预警和人工介入机制
            }

            // 2. 按产品ID分组数量，更新销量
            const productQuantities: Record<number, number> = {};
            for (const result of confirmResults) {
                  if (!result.productId || !result.success) continue;
                  productQuantities[result.productId] = (productQuantities[result.productId] || 0) + result.quantity;
            }

            // 3. 逐个更新产品销量
            for (const productIdStr of Object.keys(productQuantities)) {
                  const productId = Number(productIdStr);
                  const quantity = productQuantities[productId];

                  await prisma.product.update({
                        where: { id: productId },
                        data: { salesCount: { increment: quantity } }
                  });
            }

            return { success: true, orderId, orderNo };
      } catch (error) {
            throw error;
      }
});
 
// 修改处理订单库存和订单项的方法
orderQueue.process('processOrderItems', async (job) => {
      const { orderId, orderItems, orderNo, inventoryUpdates, cartItemIds } = job.data;

      try {
            // 1. 如果订单项还未创建（大批量情况）
            if (orderItems.length > 5) {
                  await prisma.$transaction(async (tx) => {
                        await tx.orderItem.createMany({
                              data: orderItems.map((item: any) => ({
                                    orderId,
                                    ...item
                              }))
                        });
                  }, { timeout: 10000 });
            }

            // 2. 使用库存服务预占库存
            const preOccupyResults = await Promise.all(
                  inventoryUpdates.map(async (update: { skuId: number; quantity: number; }) => {
                        const success = await inventoryService.preOccupyInventory(
                              update.skuId,
                              update.quantity,
                              orderNo,
                              600 // 10分钟超时
                        );

                        return {
                              skuId: update.skuId,
                              success,
                              quantity: update.quantity
                        };
                  })
            );

            // 检查是否所有库存预占都成功
            const failedItems = preOccupyResults.filter(item => !item.success);
            if (failedItems.length > 0) {
                  // 记录失败情况
                  console.error(`订单 ${orderNo} 库存锁定失败: ${failedItems.map(item => item.skuId).join(',')}`);

                  // 释放已成功预占的库存
                  await Promise.all(
                        preOccupyResults
                              .filter(item => item.success)
                              .map(item => inventoryService.releasePreOccupied(
                                    item.skuId,
                                    item.quantity,
                                    orderNo
                              ))
                  );

                  // 标记订单为取消状态
                  await prisma.order.update({
                        where: { id: orderId },
                        data: { orderStatus: OrderStatus.CANCELLED }
                  });

                  throw new Error(`订单 ${orderNo} 库存锁定失败`);
            }

            // 3. 删除购物车项
            if (cartItemIds.length > 0) {
                  await prisma.userCartItem.deleteMany({
                        where: { id: { in: cartItemIds } }
                  });
            }

            return { success: true, orderId, orderNo };
      } catch (error) {
            // 这里的错误已经在上面进行了处理
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