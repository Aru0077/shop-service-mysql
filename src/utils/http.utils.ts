// src/utils/http.utils.ts
import { Request, Response, NextFunction } from 'express';

// Custom error class for application-specific errors
export class AppError extends Error {
    constructor(
        public statusCode: number,
        public status: string,
        message: string
    ) {
        super(message);
        this.statusCode = statusCode;
        this.status = status;
        Error.captureStackTrace(this, this.constructor);
    }
}

// Express response extensions
declare global {
    namespace Express {
        interface Response {
            sendSuccess(data: any, message?: string): Response;
            sendError(error: string, statusCode?: number): Response;
        }
    }
}

/**
 * Middleware to add success and error response methods to Express Response object
 */
export const responseHandler = (req: Request, res: Response, next: NextFunction) => {
    res.sendSuccess = function(data: any, message = 'Success') {
        return this.status(200).json({
            success: true,
            message,
            data
        });
    };

    res.sendError = function(error: string, statusCode = 400) {
        return this.status(statusCode).json({
            success: false,
            message: error
        });
    };

    next();
};

/**
 * Utility function to wrap async route handlers
 */
export const asyncHandler = (fn: Function) => {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

/**
 * Middleware to handle 404 Not Found errors
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
    const error = new AppError(404, 'fail', `Can't find ${req.originalUrl} on this server!`);
    next(error);
};

/**
 * Global error handling middleware
 */
export const globalErrorHandler = (
    err: AppError,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    if (process.env.NODE_ENV === 'development') {
        res.status(err.statusCode).json({
            success: false,
            status: err.status,
            error: err,
            message: err.message,
            stack: err.stack
        });
    } else {
        res.status(err.statusCode).json({
            success: false,
            status: err.status,
            message: err.message
        });
    }
};