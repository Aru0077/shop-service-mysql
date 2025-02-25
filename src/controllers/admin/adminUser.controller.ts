// src/controllers/admin.controller.ts
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config';
import { redisClient } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { hash, compare } from 'bcrypt';
import { sign } from 'jsonwebtoken';

const SALT_ROUNDS = 10;
const TOKEN_EXPIRE_TIME = 24 * 60 * 60; // 24 hours in seconds

// Login
export const login = asyncHandler(async (req: Request, res: Response) => {
    const { username, password } = req.body;

    const admin = await prisma.adminUser.findUnique({
        where: { username }
    });

    if (!admin || admin.status !== 1) {
        return res.sendError('Invalid credentials or inactive account', 401);
    }

    const isPasswordValid = await compare(password, admin.password);
    if (!isPasswordValid) {
        return res.sendError('Invalid credentials', 401);
    }

    // Update last login time
    await prisma.adminUser.update({
        where: { id: admin.id },
        data: { lastLoginTime: new Date() }
    });

    // Generate JWT token
    const token = sign({ id: admin.id }, process.env.JWT_SECRET as string, {
        expiresIn: TOKEN_EXPIRE_TIME
    });

    // Store token in Redis
    await redisClient.setEx(`admin:${admin.id}:token`, TOKEN_EXPIRE_TIME, token);

    const adminData = { ...admin, password: undefined };
    return res.sendSuccess({ token, admin: adminData });
});

// Create admin (super admin only)
export const createAdmin = asyncHandler(async (req: Request, res: Response) => {
    const { username, password, isSuper = false } = req.body;

    const existingAdmin = await prisma.adminUser.findUnique({
        where: { username }
    });

    if (existingAdmin) {
        return res.sendError('Username already exists', 400);
    }

    const hashedPassword = await hash(password, SALT_ROUNDS);
    const admin = await prisma.adminUser.create({
        data: {
            username,
            password: hashedPassword,
            isSuper
        }
    });

    const adminData = { ...admin, password: undefined };
    return res.sendSuccess(adminData);
});

// Update admin status (super admin only)
export const updateAdminStatus = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;

    const admin = await prisma.adminUser.update({
        where: { id: parseInt(id) },
        data: { status }
    });

    const adminData = { ...admin, password: undefined };
    return res.sendSuccess(adminData);
});

// Reset admin password (super admin only)
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { newPassword } = req.body;

    const hashedPassword = await hash(newPassword, SALT_ROUNDS);
    const admin = await prisma.adminUser.update({
        where: { id: parseInt(id) },
        data: { password: hashedPassword }
    });

    await redisClient.del(`admin:${id}:token`);

    const adminData = { ...admin, password: undefined };
    return res.sendSuccess(adminData);
});

// Delete admin (super admin only)
export const deleteAdmin = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    await prisma.adminUser.delete({
        where: { id: parseInt(id) }
    });

    return res.sendSuccess({ message: 'Admin deleted successfully' });
});

// Get admin list (paginated)
export const getAdminList = asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const [total, admins] = await Promise.all([
        prisma.adminUser.count(),
        prisma.adminUser.findMany({
            skip,
            take: limit,
            select: {
                id: true,
                username: true,
                status: true,
                isSuper: true,
                lastLoginTime: true,
                createdAt: true,
                updatedAt: true
            }
        })
    ]);

    return res.sendSuccess({
        total,
        page,
        limit,
        data: admins
    });
});

// Logout
export const logout = asyncHandler(async (req: Request, res: Response) => {
    const admin = req.user;
    await redisClient.del(`admin:${admin!.id}:token`);
    return res.sendSuccess({ message: 'Logged out successfully' });
});
