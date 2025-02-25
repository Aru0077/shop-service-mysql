// src/utils/cache.utils.ts
import { redisClient } from '../config';

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
    }
};