// src/services/oss.service.ts
import OSS from 'ali-oss';
import { Request } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import path from 'path';

// OSS客户端配置接口
interface OSSConfig {
      region: string;
      accessKeyId: string;
      accessKeySecret: string;
      bucket: string;
      secure: boolean;
}

class OSSService {
      private client: OSS;
      private static instance: OSSService;

      private constructor() {
            // 从环境变量获取配置
            const ossConfig: OSSConfig = {
                  region: process.env.OSS_REGION || '',
                  accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
                  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
                  bucket: process.env.OSS_BUCKET || '',
                  secure: true // 使用 HTTPS
            };

            // 验证必要的配置
            this.validateConfig(ossConfig);

            // 初始化 OSS 客户端
            this.client = new OSS(ossConfig);
      }

      private validateConfig(config: OSSConfig): void {
            const requiredFields = ['region', 'accessKeyId', 'accessKeySecret', 'bucket'];
            const missingFields = requiredFields.filter(field => !config[field as keyof OSSConfig]);

            if (missingFields.length > 0) {
                  throw new Error(`Missing required OSS configuration: ${missingFields.join(', ')}`);
            }
      }

      // 单例模式获取实例
      public static getInstance(): OSSService {
            if (!OSSService.instance) {
                  OSSService.instance = new OSSService();
            }
            return OSSService.instance;
      }

      // 配置 multer 用于处理文件上传
      public getMulterStorage() {
            const storage = multer.memoryStorage();
            return multer({
                  storage,
                  limits: {
                        fileSize: 5 * 1024 * 1024, // 限制文件大小为 5MB
                  },
                  fileFilter: (req, file, cb) => {
                        // 检查文件类型
                        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                        if (allowedMimes.includes(file.mimetype)) {
                              cb(null, true);
                        } else {
                              cb(new Error('Invalid file type. Only JPEG, PNG, GIF and WebP are allowed.'));
                        }
                  }
            });
      }

      // 上传文件到 OSS
      public async uploadFile(file: Express.Multer.File): Promise<string> {
            try {
                  const extension = path.extname(file.originalname);
                  const filename = `uploads/${uuidv4()}${extension}`;

                  const result = await this.client.put(filename, file.buffer);

                  if (!result.url) {
                        throw new Error('Upload failed: No URL returned');
                  }

                  // 返回文件的公共访问URL
                  return result.url;
            } catch (error) {
                  console.error('❌ OSS upload error:', error instanceof Error ? error.message : 'Unknown error');
                  throw error;
            }
      }

      // 删除 OSS 文件
      public async deleteFile(fileUrl: string): Promise<void> {
            try {
                  const objectName = new URL(fileUrl).pathname.slice(1);
                  await this.client.delete(objectName);
            } catch (error) {
                  console.error('❌ OSS delete error:', error instanceof Error ? error.message : 'Unknown error');
                  throw error;
            }
      }
}

export const ossService = OSSService.getInstance();