// src/types/express-rate-limit.d.ts
declare module 'express-rate-limit' {
      import { RequestHandler } from 'express';
      
      interface RateLimitOptions {
          windowMs?: number;
          max?: number;
          message?: any;
          statusCode?: number;
          standardHeaders?: boolean;
          legacyHeaders?: boolean;
      }
      
      function rateLimit(options?: RateLimitOptions): RequestHandler;
      export { rateLimit, RateLimitOptions };
  }