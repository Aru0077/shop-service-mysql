// src/controllers/image.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { ossService } from '../../services/oss.service';

export const imageController = {
    // 批量上传图片
    upload: asyncHandler(async (req: Request, res: Response) => {
        if (!req.files || !Array.isArray(req.files)) {
            throw new AppError(400, 'fail', '请选择要上传的图片');
        }

        const uploadPromises = req.files.map(async (file) => {
            const imageUrl = await ossService.uploadFile(file);
            return prisma.image.create({
                data: {
                    imageUrl,
                    isUsed: 0
                }
            });
        });

        const images = await Promise.all(uploadPromises);
        res.sendSuccess(images, '图片上传成功');
    }),

    // 删除单个图片
    delete: asyncHandler(async (req: Request, res: Response) => {
        const { id } = req.params;
        const image = await prisma.image.findUnique({
            where: { id: parseInt(id) }
        });

        if (!image) {
            throw new AppError(404, 'fail', '图片不存在');
        }

        if (image.isUsed === 1) {
            throw new AppError(400, 'fail', '图片正在使用中，无法删除');
        }

        await Promise.all([
            prisma.image.delete({
                where: { id: parseInt(id) }
            }),
            ossService.deleteFile(image.imageUrl)
        ]);

        res.sendSuccess(null, '图片删除成功');
    }),

    // 批量删除图片
    batchDelete: asyncHandler(async (req: Request, res: Response) => {
        const { ids } = req.body;
        const parsedIds = ids.map((id: string) => parseInt(id));

        const images = await prisma.image.findMany({
            where: {
                id: {
                    in: parsedIds
                }
            }
        });

        const usedImages = images.filter(image => image.isUsed === 1);
        if (usedImages.length > 0) {
            throw new AppError(400, 'fail', '部分图片正在使用中，无法删除');
        }

        await Promise.all([
            prisma.image.deleteMany({
                where: {
                    id: {
                        in: parsedIds
                    }
                }
            }),
            ...images.map(image => ossService.deleteFile(image.imageUrl))
        ]);

        res.sendSuccess(null, '批量删除成功');
    }),

    // 获取图片列表
    getList: asyncHandler(async (req: Request, res: Response) => {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const isUsed = req.query.isUsed ? parseInt(req.query.isUsed as string) : undefined;

        const where = isUsed !== undefined ? { isUsed } : {};
        const skip = (page - 1) * limit;

        const [total, images] = await Promise.all([
            prisma.image.count({ where }),
            prisma.image.findMany({
                where,
                skip,
                take: limit,
                orderBy: {
                    createdAt: 'desc'
                }
            })
        ]);

        res.sendSuccess({
            total,
            page,
            limit,
            data: images
        });
    })
};