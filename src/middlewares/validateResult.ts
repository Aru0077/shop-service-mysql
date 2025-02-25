// src/middlewares/validateRequest.ts
import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';

export const validateRequest = (schema: AnyZodObject) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await schema.parseAsync({
                body: req.body,
                query: req.query,
                params: req.params,
            });
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                // 返回所有验证错误
                const errors = error.errors.map(err => ({
                    path: err.path.join('.'),
                    message: err.message
                }));
                res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors: errors
                });
                return;
            }
            res.status(400).json({
                success: false,
                message: '验证失败',
                error: error instanceof Error ? error.message : '未知错误'
            });
            return;
        }
    };
};