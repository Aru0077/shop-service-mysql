// src/config/index.ts
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';

// 加载环境变量
dotenv.config();

// 创建 Prisma 客户端
const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
        db: {
            url: process.env.DATABASE_URL,
        }
    },
});

// 创建 Redis 客户端，添加更多的连接配置
const redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
    password: process.env.REDIS_PASSWORD,
    socket: {
        connectTimeout: 10000,
        keepAlive: 5000,
        reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    }
});

// Redis 连接处理
redisClient.connect()
    .then(() => console.log('✅ Redis connected'))
    .catch((error: Error) => console.error('❌ Redis connection error:', error));

// Prisma 错误处理
prisma.$connect()
    .then(() => console.log('✅ Database connected'))
    .catch((error: Error) => console.error('❌ Database connection error:', error));

// 优雅关闭
const gracefulShutdown = async () => {
    try {
        await Promise.all([
            prisma.$disconnect(),
            redisClient.quit()
        ]);
        console.log('👋 Gracefully shutdown complete');
        process.exit(0);
    } catch (error: unknown) {
        console.error('❌ Error during graceful shutdown:', error instanceof Error ? error.message : 'Unknown error');
        process.exit(1);
    }
};

// 监听进程终止信号
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// 添加全局错误处理
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    gracefulShutdown();
});

export {
    prisma,
    redisClient
};