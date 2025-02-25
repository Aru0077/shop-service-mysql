// src/controllers/admin/spec.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';

export const specController = {
      // 创建规格
      create: asyncHandler(async (req: Request, res: Response) => {
            const { name, values } = req.body;

            // 检查规格名是否已存在
            const existingSpec = await prisma.spec.findUnique({
                  where: { name }
            });

            if (existingSpec) {
                  throw new AppError(400, 'fail', '规格名称已存在');
            }

            // 创建规格和规格值
            const spec = await prisma.spec.create({
                  data: {
                        name,
                        values: {
                              create: values.map((value: string) => ({ value }))
                        }
                  },
                  include: {
                        values: true
                  }
            });

            res.sendSuccess(spec, '规格创建成功');
      }),

      // 更新规格
      update: asyncHandler(async (req: Request, res: Response) => {
            const { id } = req.params;
            const { name, values } = req.body;
            const parsedId = parseInt(id);

            // 检查规格是否存在
            const existingSpec = await prisma.spec.findUnique({
                  where: { id: parsedId },
                  include: { skuSpecs: true }
            });

            if (!existingSpec) {
                  throw new AppError(404, 'fail', '规格不存在');
            }

            // 如果规格已被使用，不允许修改
            if (existingSpec.skuSpecs.length > 0) {
                  throw new AppError(400, 'fail', '规格已被使用，无法修改');
            }

            // 如果更新名称，检查是否与其他规格重名
            if (name) {
                  const duplicateName = await prisma.spec.findFirst({
                        where: {
                              name,
                              id: { not: parsedId }
                        }
                  });

                  if (duplicateName) {
                        throw new AppError(400, 'fail', '规格名称已存在');
                  }
            }

            // 更新规格和规格值
            const updateData: any = {};
            if (name) updateData.name = name;

            let spec = await prisma.spec.update({
                  where: { id: parsedId },
                  data: updateData
            });

            // 如果提供了新的规格值，更新规格值
            if (values) {
                  // 删除旧的规格值
                  await prisma.specValue.deleteMany({
                        where: { specId: parsedId }
                  });

                  // 创建新的规格值
                  spec = await prisma.spec.update({
                        where: { id: parsedId },
                        data: {
                              values: {
                                    create: values.map((value: string) => ({ value }))
                              }
                        },
                        include: {
                              values: true
                        }
                  });
            }

            res.sendSuccess(spec, '规格更新成功');
      }),

      // 删除规格
      delete: asyncHandler(async (req: Request, res: Response) => {
            const { id } = req.params;
            const parsedId = parseInt(id);

            // 检查规格是否存在
            const spec = await prisma.spec.findUnique({
                  where: { id: parsedId },
                  include: { skuSpecs: true }
            });

            if (!spec) {
                  throw new AppError(404, 'fail', '规格不存在');
            }

            // 检查规格是否被使用
            if (spec.skuSpecs.length > 0) {
                  throw new AppError(400, 'fail', '规格已被使用，无法删除');
            }

            // 删除规格和关联的规格值
            await prisma.$transaction([
                  prisma.specValue.deleteMany({
                        where: { specId: parsedId }
                  }),
                  prisma.spec.delete({
                        where: { id: parsedId }
                  })
            ]);

            res.sendSuccess(null, '规格删除成功');
      }),

      // 获取规格列表
      getList: asyncHandler(async (req: Request, res: Response) => {
            const specs = await prisma.spec.findMany({
                  include: {
                        values: true
                  }
            });

            res.sendSuccess(specs);
      }),

      // 获取单个规格详情
      getDetail: asyncHandler(async (req: Request, res: Response) => {
            const { id } = req.params;
            const parsedId = parseInt(id);

            const spec = await prisma.spec.findUnique({
                  where: { id: parsedId },
                  include: {
                        values: true
                  }
            });

            if (!spec) {
                  throw new AppError(404, 'fail', '规格不存在');
            }

            res.sendSuccess(spec);
      })
};