// src/app.ts
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import routes from './routes';
import {
      responseHandler,
      notFoundHandler,
      globalErrorHandler
} from './utils/http.utils';
import './config';  // 导入配置，会自动初始化数据库和Redis连接
import { prisma, redisClient } from './config';
// 导入订单定时任务服务
import { orderScheduleService } from './services/orderSchedule.service';

const app: Express = express();
const port = process.env.PORT || 3000;

// 中间件配置
app.use(morgan('dev'))
// src/app.ts 中修改 CORS 配置
app.use(cors({
      origin: '*', // 指定前端域名
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      maxAge: 86400 // 预检请求缓存1天
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(responseHandler);

// 基础路由 
app.get('/health', (req: Request, res: Response) => {
      res.sendSuccess({
            status: 'ok',
            timestamp: new Date().toISOString()
      });
});

// API 路由
app.use('/v1', routes);

// 错误处理
app.use(notFoundHandler);
app.use(globalErrorHandler);

// 优雅启动
// 修改 startServer 函数
const startServer = () => {
      const server = app.listen(port, () => {
            console.log(`✅ Server is running at http://localhost:${port}`);
            // 启动订单定时任务
            orderScheduleService.startScheduleTasks();
      });

      // 添加一个标志来防止多次关闭
      let isShuttingDown = false;

      // 优雅关闭处理
      const gracefulShutdown = async () => {
            if (isShuttingDown) {
                  console.log('💡 Shutdown already in progress...');
                  return;
            }

            isShuttingDown = true;
            console.log('🔄 Received shutdown signal. Closing server...');

            try {
                  // 首先关闭 HTTP 服务器
                  await new Promise<void>((resolve, reject) => {
                        server.close((err) => {
                              if (err) reject(err);
                              else resolve();
                        });
                  });
                  console.log('✅ Server closed successfully');

                  // 检查 Redis 和 Prisma 的连接状态
                  const shutdownTasks = [];

                  // 只有在 Redis 客户端未关闭时才尝试关闭
                  if (redisClient.isOpen) {
                        shutdownTasks.push(redisClient.quit());
                  }

                  // Prisma 的关闭
                  shutdownTasks.push(prisma.$disconnect());

                  // 执行所有关闭任务
                  await Promise.all(shutdownTasks);
                  console.log('👋 All connections closed successfully');

                  process.exit(0);
            } catch (error) {
                  console.error('❌ Error during graceful shutdown:',
                        error instanceof Error ? error.message : 'Unknown error');
                  process.exit(1);
            }
      };

      // 处理服务器错误
      server.on('error', (error: NodeJS.ErrnoException) => {
            if (error.syscall !== 'listen') {
                  throw error;
            }

            switch (error.code) {
                  case 'EACCES':
                        console.error(`❌ Port ${port} requires elevated privileges`);
                        process.exit(1);
                        break;
                  case 'EADDRINUSE':
                        console.error(`❌ Port ${port} is already in use`);
                        process.exit(1);
                        break;
                  default:
                        throw error;
            }
      });

      // 监听进程终止信号
      process.on('SIGTERM', gracefulShutdown);
      process.on('SIGINT', gracefulShutdown);
      process.on('SIGHUP', gracefulShutdown);

      // 处理未捕获的异常和 Promise 拒绝
      process.on('uncaughtException', (error) => {
            console.error('❌ Uncaught Exception:', error);
            gracefulShutdown();
      });

      process.on('unhandledRejection', (reason, promise) => {
            console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
            gracefulShutdown();
      });

      // 返回服务器实例（可选）
      return server;
};

// 启动服务器
startServer();

export default app;