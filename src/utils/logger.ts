// src/utils/logger.ts
import winston from 'winston';
import path from 'path';
import fs from 'fs';

/**
 * 日志配置接口
 */
interface LoggerConfig {
      level: string;
      logDir: string;
      maxSize: string;
      maxFiles: string;
      enableConsole: boolean;
      enableFileLogging: boolean;
}

/**
 * 默认日志配置
 */
const defaultConfig: LoggerConfig = {
      level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
      logDir: process.env.LOG_DIR || path.resolve(process.cwd(), 'logs'),
      maxSize: process.env.LOG_MAX_SIZE || '10m',
      maxFiles: process.env.LOG_MAX_FILES || '14d',
      enableConsole: true,
      enableFileLogging: true
};

/**
 * 日志级别定义
 */
const levels = {
      error: 0,
      warn: 1,
      info: 2,
      http: 3,
      debug: 4,
};

/**
 * 日志颜色定义
 */
const colors = {
      error: 'red',
      warn: 'yellow',
      info: 'green',
      http: 'magenta',
      debug: 'blue',
};

/**
 * 日志管理类
 */
class LoggerService {
      private logger: winston.Logger;
      private config: LoggerConfig;

      /**
       * 构造函数
       * @param customConfig 自定义配置
       */
      constructor(customConfig: Partial<LoggerConfig> = {}) {
            // 合并配置
            this.config = { ...defaultConfig, ...customConfig };

            // 初始化日志系统
            this.logger = this.initializeLogger();

            // 设置全局错误处理
            this.setupGlobalErrorHandlers();

            this.logger.info('日志系统初始化完成');
      }

      /**
       * 确保日志目录存在
       * @returns 日志目录是否存在或创建成功
       */
      private ensureLogDirectory(): boolean {
            if (!fs.existsSync(this.config.logDir)) {
                  try {
                        fs.mkdirSync(this.config.logDir, { recursive: true });
                        console.log(`日志目录已创建: ${this.config.logDir}`);
                        return true;
                  } catch (error: any) {
                        console.error(`创建日志目录失败: ${(error as Error).message}`);
                        return false;
                  }
            }
            return true;
      }

      /**
       * 初始化日志系统
       * @returns winston 日志实例
       */
      private initializeLogger(): winston.Logger {
            // 添加颜色支持
            winston.addColors(colors);

            // 创建日志格式
            const format = winston.format.combine(
                  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
                  winston.format.errors({ stack: true }),
                  winston.format.metadata(),
                  this.getLogFormat()
            );

            // 准备传输器
            const transports: winston.transport[] = [];

            // 添加控制台传输器
            if (this.config.enableConsole) {
                  transports.push(new winston.transports.Console({
                        format: winston.format.combine(
                              winston.format.colorize({ all: true }),
                              winston.format.printf(this.formatLogMessage)
                        )
                  }));
            }

            // 添加文件传输器
            if (this.config.enableFileLogging && this.ensureLogDirectory()) {
                  // 所有日志文件
                  transports.push(new winston.transports.File({
                        filename: path.join(this.config.logDir, 'all.log'),
                        maxsize: parseInt(this.config.maxSize) * 1024 * 1024,
                        maxFiles: parseInt(this.config.maxFiles)
                  }));

                  // 错误日志文件
                  transports.push(new winston.transports.File({
                        filename: path.join(this.config.logDir, 'error.log'),
                        level: 'error',
                        maxsize: parseInt(this.config.maxSize) * 1024 * 1024,
                        maxFiles: parseInt(this.config.maxFiles)
                  }));
            }

            // 创建日志实例
            return winston.createLogger({
                  level: this.config.level,
                  levels,
                  format,
                  transports,
                  exitOnError: false
            });
      }

      /**
       * 获取日志格式
       */
      private getLogFormat() {
            return winston.format.printf(this.formatLogMessage);
      }

      /**
       * 格式化日志消息
       */
      private formatLogMessage = (info: any) => {
            const { timestamp, level, message } = info;

            // 安全处理 metadata，避免循环引用
            let metaStr = '';
            if (info.metadata && Object.keys(info.metadata).length) {
                  try {
                        // 过滤或处理可能包含循环引用的对象
                        const safeMetadata = this.sanitizeForLogging(info.metadata);
                        metaStr = JSON.stringify(safeMetadata);
                  } catch (err) {
                        metaStr = '[无法序列化的数据]';
                  }
            }

            return `${timestamp} ${level}: ${message} ${metaStr}`;
      };

      // 添加一个新方法来安全处理日志数据
      private sanitizeForLogging(data: any): any {
            if (!data) return data;

            // 处理错误对象
            if (data instanceof Error) {
                  return {
                        name: data.name,
                        message: data.message,
                        stack: data.stack
                  };
            }

            // 对象处理
            if (typeof data === 'object') {
                  const result: any = Array.isArray(data) ? [] : {};

                  // 只保留一级属性，避免深层循环引用
                  for (const key in data) {
                        if (Object.prototype.hasOwnProperty.call(data, key)) {
                              const value = data[key];

                              // 跳过函数、请求、响应对象等不可序列化的对象
                              if (typeof value === 'function' ||
                                    key === 'req' || key === 'res' ||
                                    key === 'request' || key === 'response') {
                                    continue;
                              }

                              // 处理基本类型和可序列化对象
                              if (value === null ||
                                    typeof value !== 'object' ||
                                    value instanceof Date) {
                                    result[key] = value;
                              } else {
                                    // 对象或数组使用简单描述替代
                                    result[key] = `[${Array.isArray(value) ? 'Array' : 'Object'}]`;
                              }
                        }
                  }
                  return result;
            }

            return data;
      }

      /**
       * 设置全局错误处理
       */
      private setupGlobalErrorHandlers() {
            process.on('exit', () => {
                  this.logger.info('应用正在退出，日志系统关闭');
            });

            process.on('uncaughtException', (error) => {
                  this.logger.error(`未捕获的异常: ${error.message}`, {
                        stack: error.stack,
                        name: error.name
                  });

                  // 给日志系统一点时间写入日志
                  setTimeout(() => {
                        process.exit(1);
                  }, 1000);
            });

            process.on('unhandledRejection', (reason, promise) => {
                  this.logger.error('未处理的Promise拒绝', { reason });
            });
      }

      /**
       * 获取日志实例
       */
      public getLogger(): winston.Logger {
            return this.logger;
      }

      // 便捷方法
      public error(message: string, meta?: any): void {
            this.logger.error(message, meta);
      }

      public warn(message: string, meta?: any): void {
            this.logger.warn(message, meta);
      }

      public info(message: string, meta?: any): void {
            this.logger.info(message, meta);
      }

      public http(message: string, meta?: any): void {
            this.logger.http(message, meta);
      }

      public debug(message: string, meta?: any): void {
            this.logger.debug(message, meta);
      }
}

// 创建默认日志服务实例
const loggerService = new LoggerService();

// 导出日志实例和服务
export const logger = loggerService.getLogger();
export default loggerService;