// src/controllers/category.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';

export const categoryController = {
    // 创建分类
    create: asyncHandler(async (req: Request, res: Response) => {
        const { name, parentId } = req.body;

        // 检查父级分类是否存在（如果指定了父级）
        let level = 1;
        if (parentId !== 0) {
            const parentCategory = await prisma.category.findUnique({
                where: { id: parseInt(parentId) }
            });
            if (!parentCategory) {
                throw new AppError(400, 'fail', '父级分类不存在');
            }
            level = parentCategory.level + 1;
        }

        const category = await prisma.category.create({
            data: {
                name,
                parentId: parentId || 0,
                level
            }
        });

        res.sendSuccess(category, '分类创建成功');
    }),

    // 更新分类
    update: asyncHandler(async (req: Request, res: Response) => {
        const { id } = req.params;
        const { name, parentId } = req.body;

        // 检查分类是否存在
        const existingCategory = await prisma.category.findUnique({
            where: { id: parseInt(id) }
        });

        if (!existingCategory) {
            throw new AppError(404, 'fail', '分类不存在');
        }

        // 如果更新父级ID，需要检查新的父级分类是否存在
        let level = existingCategory.level;
        if (parentId !== undefined) {
            if (parentId === parseInt(id)) {
                throw new AppError(400, 'fail', '不能将分类的父级设置为自己');
            }

            if (parentId !== 0) {
                const parentCategory = await prisma.category.findUnique({
                    where: { id: parseInt(parentId) }
                });
                if (!parentCategory) {
                    throw new AppError(400, 'fail', '父级分类不存在');
                }
                level = parentCategory.level + 1;
            } else {
                level = 1;
            }
        }

        const category = await prisma.category.update({
            where: { id: parseInt(id) },
            data: {
                name,
                parentId: parentId !== undefined ? parseInt(parentId) : undefined,
                level
            }
        });

        res.sendSuccess(category, '分类更新成功');
    }),

    // 删除分类
    delete: asyncHandler(async (req: Request, res: Response) => {
        const { id } = req.params;
        const parsedId = parseInt(id);

        // 检查是否存在子分类
        const hasChildren = await prisma.category.findFirst({
            where: { parentId: parsedId }
        });

        if (hasChildren) {
            throw new AppError(400, 'fail', '请先删除子分类');
        }

        // 检查分类是否存在
        const category = await prisma.category.findUnique({
            where: { id: parsedId }
        });

        if (!category) {
            throw new AppError(404, 'fail', '分类不存在');
        }

        // 检查分类是否被产品使用
        const hasProducts = await prisma.product.findFirst({
            where: { categoryId: parsedId }
        });

        if (hasProducts) {
            throw new AppError(400, 'fail', '该分类下存在商品，无法删除');
        }

        await prisma.category.delete({
            where: { id: parsedId }
        });

        res.sendSuccess(null, '分类删除成功');
    }),

    // 获取分类树
    getTree: asyncHandler(async (req: Request, res: Response) => {
        const categories = await prisma.category.findMany({
            orderBy: [
                { level: 'asc' },
                { id: 'asc' }
            ]
        });

        // 构建分类树
        const buildTree = (parentId: number = 0): any[] => {
            return categories
                .filter(category => category.parentId === parentId)
                .map(category => ({
                    ...category,
                    children: buildTree(category.id)
                }));
        };

        const categoryTree = buildTree();
        res.sendSuccess(categoryTree, '获取分类树成功');
    })
};