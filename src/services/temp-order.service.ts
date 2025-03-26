// src/services/temp-order.service.ts
import { prisma, redisClient } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../utils/http.utils';
import { OrderStatus, PaymentStatus } from '../constants/orderStatus.enum';
import { ProductStatus } from '@prisma/client';
import { orderService } from './order.service';
import NodeCache from 'node-cache';
import { StockChangeType } from '../constants/stock.constants';
import { cacheUtils, CACHE_LEVELS } from '../utils/cache.utils';
import { inventoryService } from './inventory.service';
import { orderQueue } from '../queues/order.queue';

// 内存缓存，提高频繁访问的临时订单读取性能
const memoryCache = new NodeCache({ stdTTL: 60, checkperiod: 30 });

// 临时订单默认过期时间：15分钟
const TEMP_ORDER_EXPIRY = 15 * 60;

// 临时订单项接口
interface TempOrderItem {
    productId: number;
    skuId: number;
    quantity: number;
    productName: string;
    mainImage: string;
    skuSpecs: any;
    unitPrice: number;
    totalPrice: number;
}

// 临时订单接口
interface TempOrder {
    id: string;
    userId: string;
    mode: 'cart' | 'quick-buy';
    cartItemIds?: number[];
    productInfo?: {
        productId: number;
        skuId: number;
        quantity: number;
    };
    items: TempOrderItem[];
    totalAmount: number;
    discountAmount: number;
    paymentAmount: number;
    addressId?: number;
    paymentType?: string;
    remark?: string;
    promotion?: {
        id: number;
        name: string;
        type: string;
        discountAmount: number;
    } | null;
    expireTime: string;
    createdAt: string;
    updatedAt?: string;
}

export const tempOrderService = {
    /**
     * 获取结账页面所需的所有信息
     * @param userId 用户ID
     * @returns 结账信息，包括地址、可用促销、支付方式等
     */
    async getCheckoutInfo(userId: string) {
        // 添加缓存 - 使用用户ID作为缓存键的一部分
        const cacheKey = `checkout:${userId}:info`;
        return await cacheUtils.multiLevelCache(cacheKey, async () => {
            // 并行获取所有需要的数据
            const [addresses, availablePromotions, recentOrders] = await Promise.all([
                // 获取用户地址，默认地址排在前面
                prisma.userAddress.findMany({
                    where: { userId },
                    orderBy: [
                        { isDefault: 'desc' },
                        { updatedAt: 'desc' }
                    ],
                    take: 3 // 只取最近使用的3个地址
                }),

                // 获取可用的满减规则
                prisma.promotion.findMany({
                    where: {
                        isActive: true,
                        startTime: { lte: new Date() },
                        endTime: { gte: new Date() }
                    },
                    orderBy: {
                        thresholdAmount: 'asc'
                    }
                }),

                // 获取用户最近的订单用于展示支付偏好
                prisma.order.findMany({
                    where: {
                        userId,
                        paymentStatus: 1 // 已支付
                    },
                    include: {
                        paymentLogs: {
                            select: {
                                paymentType: true
                            },
                            orderBy: {
                                createdAt: 'desc'
                            },
                            take: 1
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 1
                })
            ]);

            // QPay是唯一支持的支付方式
            const paymentType = 'qpay'; 

            // 构建响应数据 
            return {
                addresses,
                defaultAddressId: addresses.length > 0 ?
                    addresses.find(addr => addr.isDefault === 1)?.id || addresses[0].id
                    : null,
                availablePromotions,
                preferredPaymentType: paymentType, // 始终使用QPay
                paymentMethods: [
                    { id: 'qpay', name: 'QPay支付' }
                ]
            };
        }, CACHE_LEVELS.SHORT); // 使用10秒短期缓存，结账信息要求较新鲜
    },


    /**
     * 创建临时订单
     * @param userId 用户ID
     * @param mode 订单模式：cart(购物车结算) 或 quick-buy(直接购买)
     * @param cartItemIds 购物车项ID数组（购物车模式）
     * @param productInfo 商品信息（直接购买模式）
     * @returns 临时订单信息
     */
    async createTempOrder(
        userId: string,
        mode: 'cart' | 'quick-buy',
        cartItemIds?: number[],
        productInfo?: { productId: number; skuId: number; quantity: number }
    ): Promise<TempOrder> {
        // 添加并发控制，防止用户短时间内创建多个临时订单
        const lockKey = `temp_order:lock:${userId}`;
        const lockAcquired = await redisClient.set(lockKey, '1', {
            NX: true,
            EX: 3 // 3秒锁定时间
        });

        if (!lockAcquired) {
            throw new AppError(429, 'fail', '操作过于频繁，请稍后再试');
        }

        try {
            // 生成临时订单ID
            const id = uuidv4();

            // 设置过期时间
            const expireTime = new Date(Date.now() + TEMP_ORDER_EXPIRY * 1000);

            // 根据不同模式获取订单项
            let orderItems: any[] = [];
            let totalAmount = 0;

            if (mode === 'cart' && cartItemIds && cartItemIds.length > 0) {
                // 从购物车获取商品
                const cartItems = await this.getCartItems(userId, cartItemIds);

                // 验证购物车项
                if (cartItems.length === 0) {
                    throw new AppError(400, 'fail', '请选择要结算的商品');
                }

                // 获取SKU信息并计算订单金额
                const { items, totalAmount: amount } = await this.calculateOrderAmount(cartItems);
                orderItems = items;
                totalAmount = amount;
            } else if (mode === 'quick-buy' && productInfo) {
                // 从商品直接购买
                const { productId, skuId, quantity } = productInfo;

                // 验证商品和SKU
                const product = await prisma.product.findFirst({
                    where: {
                        id: productId,
                        status: ProductStatus.ONLINE
                    },
                    select: {
                        id: true,
                        name: true,
                        mainImage: true
                    }
                });

                if (!product) {
                    throw new AppError(404, 'fail', '商品不存在或已下架');
                }

                const sku = await prisma.sku.findFirst({
                    where: {
                        id: skuId,
                        productId
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

                if (!sku) {
                    throw new AppError(404, 'fail', 'SKU不存在');
                }

                // 验证库存
                if ((sku.stock || 0) < quantity) {
                    throw new AppError(400, 'fail', '商品库存不足');
                }

                // 准备SKU规格信息
                const skuSpecs = sku.sku_specs.map(spec => ({
                    specId: spec.specId,
                    specName: spec.spec.name,
                    specValueId: spec.specValueId,
                    specValue: spec.specValue.value
                }));

                // 计算商品价格
                const unitPrice = sku.promotion_price || sku.price;
                const itemTotalPrice = unitPrice * quantity;

                // 添加到订单项
                orderItems = [{
                    productId,
                    skuId,
                    quantity,
                    productName: product.name,
                    mainImage: product.mainImage || '',
                    skuSpecs,
                    unitPrice,
                    totalPrice: itemTotalPrice
                }];

                totalAmount = itemTotalPrice;
            } else {
                throw new AppError(400, 'fail', '无效的订单模式或参数');
            }

            // 查找适用的促销规则
            const promotion = await this.findPromotionForAmount(totalAmount);

            // 计算折扣
            let discountAmount = 0;
            let promotionInfo = null;

            if (promotion) {
                promotionInfo = {
                    id: promotion.id,
                    name: promotion.name,
                    type: promotion.type,
                    discountAmount: promotion.discountAmount
                };

                if (promotion.type === 'AMOUNT_OFF') {
                    // 满减优惠
                    discountAmount = promotion.discountAmount;
                } else if (promotion.type === 'PERCENT_OFF') {
                    // 折扣优惠
                    discountAmount = Math.floor(totalAmount * (promotion.discountAmount / 100));
                }

                // 确保折扣金额不超过订单总金额
                discountAmount = Math.min(discountAmount, totalAmount);
            }

            const paymentAmount = totalAmount - discountAmount;

            // 构建临时订单数据
            const tempOrderData: TempOrder = {
                id,
                userId,
                mode,
                cartItemIds: mode === 'cart' ? cartItemIds : undefined,
                productInfo: mode === 'quick-buy' ? productInfo : undefined,
                items: orderItems,
                totalAmount,
                discountAmount,
                paymentAmount,
                promotion: promotionInfo,
                expireTime: expireTime.toISOString(),
                createdAt: new Date().toISOString()
            };

            // 存储临时订单数据到Redis
            const redisKey = `temp_order:${id}`;
            await redisClient.setEx(
                redisKey,
                TEMP_ORDER_EXPIRY,
                JSON.stringify(tempOrderData)
            );

            // 也缓存到内存中，提高后续访问速度
            memoryCache.set(redisKey, tempOrderData, 60); // 1分钟内存缓存

            return tempOrderData;
        } finally {
            // 释放锁
            await redisClient.del(lockKey);
        }
    },

    /**
     * 获取临时订单
     * @param id 临时订单ID
     * @param userId 用户ID
     * @returns 临时订单信息
     */
    async getTempOrder(id: string, userId: string): Promise<TempOrder> {
        // 先从内存缓存获取
        const cacheKey = `temp_order:${id}`;
        const cached = memoryCache.get<TempOrder>(cacheKey);

        if (cached) {
            // 验证所有权
            if (cached.userId !== userId) {
                throw new AppError(403, 'fail', '无权访问此临时订单');
            }
            return cached;
        }

        // 从Redis获取
        const data = await redisClient.get(cacheKey);

        if (!data) {
            throw new AppError(404, 'fail', '临时订单不存在或已过期');
        }

        const tempOrder = JSON.parse(data) as TempOrder;

        // 验证所有权
        if (tempOrder.userId !== userId) {
            throw new AppError(403, 'fail', '无权访问此临时订单');
        }

        // 存入内存缓存，短时间有效
        memoryCache.set(cacheKey, tempOrder, 60); // 60秒

        return tempOrder;
    },

    /**
     * 更新临时订单
     * @param id 临时订单ID
     * @param userId 用户ID
     * @param updates 更新内容
     * @returns 更新后的临时订单
     */
    async updateTempOrder(
        id: string,
        userId: string,
        updates: {
            addressId?: number;
            paymentType?: string;
            remark?: string;
        }
    ): Promise<TempOrder> {
        // 获取临时订单
        const tempOrder = await this.getTempOrder(id, userId);

        // 检查订单是否过期
        if (new Date(tempOrder.expireTime) < new Date()) {
            throw new AppError(400, 'fail', '临时订单已过期，请重新下单');
        }

        // 验证地址（如果提供）
        if (updates.addressId) {
            const address = await prisma.userAddress.findFirst({
                where: {
                    id: updates.addressId,
                    userId
                }
            });

            if (!address) {
                throw new AppError(404, 'fail', '收货地址不存在');
            }
        }

        // 合并更新
        const updated: TempOrder = {
            ...tempOrder,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        // 更新Redis中的临时订单
        const redisKey = `temp_order:${id}`;
        await redisClient.setEx(
            redisKey,
            TEMP_ORDER_EXPIRY, // 维持原有过期时间
            JSON.stringify(updated)
        );

        // 更新内存缓存
        memoryCache.set(redisKey, updated, 60);

        return updated;
    },

    /**
     * 刷新临时订单有效期
     * @param id 临时订单ID
     * @param userId 用户ID
     * @returns 刷新后的临时订单
     */
    async refreshTempOrder(id: string, userId: string): Promise<TempOrder> {
        // 获取临时订单
        const tempOrder = await this.getTempOrder(id, userId);

        // 设置新的过期时间
        const expireTime = new Date(Date.now() + TEMP_ORDER_EXPIRY * 1000);

        // 更新过期时间
        const updated: TempOrder = {
            ...tempOrder,
            expireTime: expireTime.toISOString(),
            updatedAt: new Date().toISOString()
        };

        // 更新Redis中的临时订单
        const redisKey = `temp_order:${id}`;
        await redisClient.setEx(
            redisKey,
            TEMP_ORDER_EXPIRY, // 重置过期时间
            JSON.stringify(updated)
        );

        // 更新内存缓存
        memoryCache.set(redisKey, updated, 60);

        return updated;
    },

    /**
     * 从临时订单创建正式订单
     * @param id 临时订单ID
     * @param userId 用户ID
     * @returns 创建的订单基本信息
     */
    async createOrderFromTemp(id: string, userId: string) {
        // 获取临时订单
        const tempOrder = await this.getTempOrder(id, userId);

        // 验证临时订单是否过期
        const expireTime = new Date(tempOrder.expireTime);
        if (expireTime < new Date()) {
            throw new AppError(400, 'fail', '临时订单已过期，请重新下单');
        }

        // 验证必要信息是否完整
        if (!tempOrder.addressId) {
            throw new AppError(400, 'fail', '请选择收货地址');
        }

        // 使用分布式锁确保同一时间只有一个请求能处理此订单
        const lockKey = `order:create:lock:${id}`;
        const lockAcquired = await redisClient.set(lockKey, '1', {
            NX: true,
            EX: 30 // 30秒锁定时间
        });

        if (!lockAcquired) {
            throw new AppError(429, 'fail', '订单正在处理中，请勿重复提交');
        }

        try {
            // 生成订单号
            const orderNo = await orderService.generateOrderNo();

            // 查询地址信息
            const address = await prisma.userAddress.findFirst({
                where: {
                    id: tempOrder.addressId,
                    userId
                }
            });

            if (!address) {
                throw new AppError(404, 'fail', '收货地址不存在');
            }

            // 准备地址数据
            const addressData = {
                receiverName: address.receiverName,
                receiverPhone: address.receiverPhone,
                province: address.province,
                city: address.city,
                detailAddress: address.detailAddress
            };

            // 准备订单项
            const orderItems = tempOrder.items.map(item => ({
                skuId: item.skuId,
                productName: item.productName,
                mainImage: item.mainImage,
                skuSpecs: item.skuSpecs,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice
            }));

            // 开始事务
            const result = await prisma.$transaction(async (tx) => {
                // 1. 创建订单记录
                const order = await tx.order.create({
                    data: {
                        id: uuidv4(), // 订单ID
                        orderNo,
                        userId,
                        orderStatus: OrderStatus.PENDING_PAYMENT,
                        paymentStatus: PaymentStatus.UNPAID,
                        shippingAddress: addressData,
                        totalAmount: tempOrder.totalAmount,
                        discountAmount: tempOrder.discountAmount,
                        paymentAmount: tempOrder.paymentAmount,
                        promotionId: tempOrder.promotion?.id || null,
                    }
                });

                // 2. 创建订单项记录
                for (const item of orderItems) {
                    await tx.orderItem.create({
                        data: {
                            orderId: order.id,
                            skuId: item.skuId,
                            productName: item.productName,
                            mainImage: item.mainImage,
                            skuSpecs: item.skuSpecs,
                            quantity: item.quantity,
                            unitPrice: item.unitPrice,
                            totalPrice: item.totalPrice
                        }
                    });
                }

                // 3. 锁定商品库存 - 修正：使用inventoryService统一处理库存
                for (const item of tempOrder.items) {
                    // 获取当前库存
                    const sku = await tx.sku.findUnique({
                        where: { id: item.skuId }
                    });

                    if (!sku || (sku.stock || 0) < item.quantity) {
                        throw new AppError(400, 'fail', `商品"${item.productName}"库存不足`);
                    }

                    // 使用inventoryService锁定库存
                    const success = await inventoryService.preOccupyInventory(
                        item.skuId,
                        item.quantity,
                        orderNo,
                        600
                    );

                    if (!success) {
                        throw new AppError(400, 'fail', `锁定商品"${item.productName}"库存失败`);
                    }
                }

                return order;
            });

            // 异步处理购物车清理（如果是购物车模式）
            if (tempOrder.mode === 'cart' && tempOrder.cartItemIds) {
                // 使用队列系统处理异步任务
                await orderQueue.add('cleanupCart', {
                    userId,
                    cartItemIds: tempOrder.cartItemIds
                }, {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 2000
                    }
                });
            }

            // 删除临时订单
            await redisClient.del(`temp_order:${id}`);
            memoryCache.del(`temp_order:${id}`);

            // 返回订单信息
            return {
                id: result.id,
                orderNo: result.orderNo,
                totalAmount: result.totalAmount,
                discountAmount: result.discountAmount,
                paymentAmount: result.paymentAmount,
                orderStatus: result.orderStatus,
                paymentStatus: result.paymentStatus,
                createdAt: result.createdAt,
                timeoutSeconds: 600, // 10分钟支付超时
                promotion: tempOrder.promotion
            };
        } finally {
            // 确保在任何情况下都释放锁
            await redisClient.del(lockKey);
        }
    },

    /**
     * 获取购物车商品信息
     * @param userId 用户ID
     * @param cartItemIds 购物车项ID数组
     * @returns 购物车商品信息
     */
    async getCartItems(userId: string, cartItemIds: number[]) {
        // 获取购物车项
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
                        mainImage: true,
                        status: true
                    }
                }
            }
        });

        return cartItems;
    },

    /**
     * 计算订单金额
     * @param cartItems 购物车项
     * @returns 订单金额和订单项
     */
    async calculateOrderAmount(cartItems: any[]) {
        // 获取SKU信息
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

        // 映射SKU
        const skuMap = new Map();
        skus.forEach(sku => skuMap.set(sku.id, sku));

        // 计算订单项和总金额
        let totalAmount = 0;
        const items = [];

        for (const cartItem of cartItems) {
            const sku = skuMap.get(cartItem.skuId);
            if (!sku) continue;

            // 验证商品状态
            if (cartItem.product.status !== ProductStatus.ONLINE) {
                throw new AppError(400, 'fail', `商品"${cartItem.product.name}"已下架`);
            }

            // 验证库存
            if ((sku.stock || 0) < cartItem.quantity) {
                throw new AppError(400, 'fail', `商品"${cartItem.product.name}"库存不足`);
            }

            // 准备SKU规格信息
            const skuSpecs = sku.sku_specs.map((spec: { specId: any; spec: { name: any; }; specValueId: any; specValue: { value: any; }; }) => ({
                specId: spec.specId,
                specName: spec.spec.name,
                specValueId: spec.specValueId,
                specValue: spec.specValue.value
            }));

            // 使用促销价或原价
            const unitPrice = sku.promotion_price || sku.price;
            const itemTotalPrice = unitPrice * cartItem.quantity;

            // 添加到订单项
            items.push({
                productId: cartItem.productId,
                skuId: cartItem.skuId,
                quantity: cartItem.quantity,
                productName: cartItem.product.name,
                mainImage: cartItem.product.mainImage || '',
                skuSpecs,
                unitPrice,
                totalPrice: itemTotalPrice
            });

            // 累加总金额
            totalAmount += itemTotalPrice;
        }

        return { items, totalAmount };
    },

    /**
     * 查找适合订单金额的促销规则
     * @param amount 订单金额
     * @returns 促销规则
     */
    async findPromotionForAmount(amount: number) {
        const now = new Date();
        return await prisma.promotion.findFirst({
            where: {
                isActive: true,
                startTime: { lte: now },
                endTime: { gte: now },
                thresholdAmount: { lte: amount }
            },
            orderBy: {
                thresholdAmount: 'desc' // 选择满足条件的最高阈值规则
            }
        });
    }
};