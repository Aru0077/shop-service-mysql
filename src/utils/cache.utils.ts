// src/utils/cache.utils.ts
import { redisClient } from '../config';

// 添加分级缓存策略
const CACHE_LEVELS = {
    MICRO: 10,        // 10秒 - 超短时缓存，用于高频API
    SHORT: 60,        // 1分钟
    MEDIUM: 300,      // 5分钟
    LONG: 1800,       // 30分钟
    VERY_LONG: 3600   // 1小时
};


// src/utils/cache.utils.ts 扩展功能
export const cacheUtils = {
    async getOrSet(key: string, callback: () => Promise<any>, expireTime: number = 300) {
        const cachedData = await redisClient.get(key);
        if (cachedData) {
            return JSON.parse(cachedData);
        }

        const data = await callback();
        await redisClient.setEx(key, expireTime, JSON.stringify(data));
        return data;
    },

    async invalidateCache(pattern: string) {
        const keys = await redisClient.keys(pattern);
        if (keys.length > 0) {
            await redisClient.del(keys);
        }
    },

    async incrementCounter(key: string, increment: number = 1, expireTime: number = 86400) {
        const exists = await redisClient.exists(key);
        if (exists) {
            return await redisClient.incrBy(key, increment);
        } else {
            await redisClient.setEx(key, expireTime, increment.toString());
            return increment;
        }
    },

    async rateLimit(key: string, limit: number, period: number): Promise<boolean> {
        const current = await redisClient.incr(key);
        if (current === 1) {
            await redisClient.expire(key, period);
        }
        return current <= limit;
    },

    // 添加分级缓存方法
    async cachedByLevel(key: string, callback: () => Promise<any>, level: keyof typeof CACHE_LEVELS = 'MEDIUM') {
        const expireTime = CACHE_LEVELS[level];
        return this.getOrSet(key, callback, expireTime);
    },

    // 添加缓存预热方法
    async warmupCache(keys: string[], callbacks: (() => Promise<any>)[]) {
        const tasks = keys.map((key, index) => {
            const callback = callbacks[index];
            return this.getOrSet(key, callback);
        });

        return Promise.all(tasks);
    },

    // 添加批量失效方法
    async invalidateMany(patterns: string[]) {
        const tasks = patterns.map(pattern => this.invalidateCache(pattern));
        return Promise.all(tasks);
    },
};