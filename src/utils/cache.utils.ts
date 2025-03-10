// src/utils/cache.utils.ts
import { redisClient } from '../config';

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
    }
};