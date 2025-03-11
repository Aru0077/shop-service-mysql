// src/utils/cache.utils.ts
import { redisClient } from '../config';
import NodeCache from 'node-cache';

// 定义缓存时间级别
export const CACHE_LEVELS = {
    MICRO: 10,         // 10秒 - 价格等敏感数据
    SHORT: 300,        // 5分钟 - 商品详情
    MEDIUM: 1800,      // 30分钟 - 商品列表
    LONG: 7200,        // 2小时 - 分类树等基础数据
    VERY_LONG: 86400   // 1天 - 静态数据
};

// 创建内存缓存实例
const memoryCache = new NodeCache({
    stdTTL: 120,       // 默认2分钟
    checkperiod: 60,   // 每分钟检查过期
    useClones: false   // 不克隆对象，提高性能
});

// 内存缓存状态指标
let memoryCacheHits = 0;
let memoryCacheMisses = 0;
let redisCacheHits = 0;
let redisCacheMisses = 0;

// 缓存工具类
export const cacheUtils = {
    // 基础获取或设置缓存方法
    async getOrSet(key: string, callback: () => Promise<any>, expireTime: number = 300) {
        const cachedData = await redisClient.get(key);
        if (cachedData) {
            return JSON.parse(cachedData);
        }

        const data = await callback();
        await redisClient.setEx(key, expireTime, JSON.stringify(data));
        return data;
    },

    // 多级缓存获取或设置方法
    async multiLevelCache(key: string, callback: () => Promise<any>, ttl: number = 300) {
        // 1. 查询内存缓存
        const memCached = memoryCache.get(key);
        if (memCached) {
            memoryCacheHits++;
            return memCached;
        }
        memoryCacheMisses++;

        // 2. 查询Redis缓存
        const redisCached = await redisClient.get(key);
        if (redisCached) {
            redisCacheHits++;
            // 找到Redis缓存，填充内存缓存
            const parsed = JSON.parse(redisCached);
            memoryCache.set(key, parsed, Math.min(ttl / 2, 300)); // 内存缓存时间短于Redis缓存
            return parsed;
        }
        redisCacheMisses++;

        // 3. 执行回调生成数据
        const data = await callback();

        // 4. 同时写入两级缓存
        const jsonData = JSON.stringify(data);
        await redisClient.setEx(key, ttl, jsonData);
        memoryCache.set(key, data, Math.min(ttl / 2, 300));

        return data;
    },

    // 按缓存级别获取或设置缓存
    async cachedByLevel(key: string, callback: () => Promise<any>, level: keyof typeof CACHE_LEVELS = 'MEDIUM') {
        const expireTime = CACHE_LEVELS[level];
        return this.multiLevelCache(key, callback, expireTime);
    },

    // 根据流量动态调整缓存时间
    async adaptiveCaching(key: string, callback: () => Promise<any>, baseLevel: keyof typeof CACHE_LEVELS = 'MEDIUM', traffic: 'low' | 'medium' | 'high' = 'medium') {
        const baseTime = CACHE_LEVELS[baseLevel];
        const multipliers = { low: 2, medium: 1, high: 0.5 };
        const adaptedTime = Math.floor(baseTime * multipliers[traffic]);

        return this.multiLevelCache(key, callback, adaptedTime);
    },

    // 缓存预热
    async warmupCache(keys: string[], callbacks: (() => Promise<any>)[]) {
        const tasks = keys.map((key, index) => {
            const callback = callbacks[index];
            return this.multiLevelCache(key, callback, CACHE_LEVELS.MEDIUM);
        });

        return Promise.all(tasks);
    },

    // 针对性清除缓存
    async invalidateCache(pattern: string) {
        const keys = await redisClient.keys(pattern);

        // 清除Redis缓存
        if (keys.length > 0) {
            await redisClient.del(keys);
        }

        // 清除内存缓存
        const memKeys = memoryCache.keys().filter(k => k.includes(pattern.replace('*', '')));
        memKeys.forEach(k => memoryCache.del(k));

        return keys.length + memKeys.length;
    },

    // 批量清除缓存
    async invalidateMany(patterns: string[]) {
        const tasks = patterns.map(pattern => this.invalidateCache(pattern));
        return Promise.all(tasks);
    },

    // 计数器增加方法
    async incrementCounter(key: string, increment: number = 1, expireTime: number = 86400) {
        const exists = await redisClient.exists(key);
        if (exists) {
            return await redisClient.incrBy(key, increment);
        } else {
            await redisClient.setEx(key, expireTime, increment.toString());
            return increment;
        }
    },

    // 限流器
    async rateLimit(key: string, limit: number, period: number): Promise<boolean> {
        const current = await redisClient.incr(key);
        if (current === 1) {
            await redisClient.expire(key, period);
        }
        return current <= limit;
    },

    // 获取缓存命中率统计
    getCacheStats() {
        const memoryTotal = memoryCacheHits + memoryCacheMisses;
        const redisTotal = redisCacheHits + redisCacheMisses;

        return {
            memory: {
                hits: memoryCacheHits,
                misses: memoryCacheMisses,
                hitRate: memoryTotal > 0 ? (memoryCacheHits / memoryTotal) * 100 : 0
            },
            redis: {
                hits: redisCacheHits,
                misses: redisCacheMisses,
                hitRate: redisTotal > 0 ? (redisCacheHits / redisTotal) * 100 : 0
            }
        };
    },

    // 添加按模块清除缓存的方法
    async invalidateModuleCache(module: 'product' | 'order' | 'cart' | 'user' | 'promotion', id?: string | number): Promise<number> {
        const patterns: string[] = [];

        switch (module) {
            case 'product':
                patterns.push(`product:*`);
                if (id) {
                    patterns.push(`product:${id}:*`);
                    // 商品详情，SKU信息等
                    patterns.push(`product:${id}:basic`);
                    patterns.push(`product:${id}:skus`);
                    // 影响分类商品列表
                    patterns.push(`shop:products:category:*`);
                }
                // 各类商品列表缓存
                patterns.push(`shop:products:latest:*`);
                patterns.push(`shop:products:top-selling:*`);
                patterns.push(`shop:products:promotion:*`);
                patterns.push(`shop:home:data`);
                break;

            case 'order':
                if (id) {
                    patterns.push(`order:${id}:*`);
                    patterns.push(`orders:*:${id}:*`);
                }
                // 用户订单列表
                patterns.push(`orders:*`);
                break;

            case 'cart':
                if (id) {
                    patterns.push(`cart:${id}:*`);
                } else {
                    patterns.push(`cart:*`);
                }
                break;

            case 'user':
                if (id) {
                    patterns.push(`user:${id}:*`);
                    // 用户相关缓存
                    patterns.push(`cart:${id}:*`);
                    patterns.push(`orders:${id}:*`);
                    patterns.push(`favorites:${id}:*`);
                }
                break;

            case 'promotion':
                patterns.push(`promotion:*`);
                // 影响首页和促销商品列表
                patterns.push(`shop:products:promotion:*`);
                patterns.push(`shop:home:data`);
                break;

            default:
                return 0;
        }

        // 批量清除缓存
        const cleared = await this.invalidateMany(patterns);
        return cleared.reduce((sum, count) => sum + count, 0);
    },

    // 重置统计数据
    resetCacheStats() {
        memoryCacheHits = 0;
        memoryCacheMisses = 0;
        redisCacheHits = 0;
        redisCacheMisses = 0;
    }
};