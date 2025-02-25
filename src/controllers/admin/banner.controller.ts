// src/controllers/banner.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';

export const bannerController = {
    // 创建首页banner
    create: asyncHandler(async (req: Request, res: Response) => {
        const { imageUrl, title, content } = req.body;

        // 检查是否已存在banner
        const existingBanner = await prisma.banner.findFirst();
        if (existingBanner) {
            return res.sendError('首页Banner已存在，请使用更新接口');
        }

        const banner = await prisma.banner.create({
            data: {
                imageUrl,
                title,
                content
            }
        });

        res.sendSuccess(banner, 'Banner创建成功');
    }),

    // 更新首页banner
    update: asyncHandler(async (req: Request, res: Response) => {
        const { imageUrl, title, content } = req.body;

        const banner = await prisma.banner.findFirst();
        if (!banner) {
            return res.sendError('Banner不存在，请先创建');
        }

        const updatedBanner = await prisma.banner.update({
            where: { id: banner.id },
            data: {
                imageUrl,
                title,
                content
            }
        });

        res.sendSuccess(updatedBanner, 'Banner更新成功');
    }),

    // 删除首页banner
    delete: asyncHandler(async (req: Request, res: Response) => {
        const banner = await prisma.banner.findFirst();
        if (!banner) {
            return res.sendError('Banner不存在');
        }

        await prisma.banner.delete({
            where: { id: banner.id }
        });

        res.sendSuccess(null, 'Banner删除成功');
    }),

    // 获取首页banner
    get: asyncHandler(async (req: Request, res: Response) => {
        const banner = await prisma.banner.findFirst();
        res.sendSuccess(banner);
    })
};