// src/controllers/admin/promotion.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';

export const promotionController = {
  // 创建满减规则
  create: asyncHandler(async (req: Request, res: Response) => {
    const { 
      name, 
      description, 
      type, 
      thresholdAmount, 
      discountAmount, 
      startTime, 
      endTime, 
      isActive = true 
    } = req.body;

    // 验证优惠金额不能大于阈值金额(满减类型)
    if (type === 'AMOUNT_OFF' && discountAmount >= thresholdAmount) {
      throw new AppError(400, 'fail', '优惠金额不能大于或等于满减阈值');
    }

    const promotion = await prisma.promotion.create({
      data: {
        name,
        description,
        type,
        thresholdAmount,
        discountAmount,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        isActive
      }
    });

    res.sendSuccess(promotion, '满减规则创建成功');
  }),

  // 获取满减规则列表
  getList: asyncHandler(async (req: Request, res: Response) => {
    const { page = '1', limit = '10', isActive } = req.query;
    const pageNumber = parseInt(page as string);
    const limitNumber = parseInt(limit as string);
    const skip = (pageNumber - 1) * limitNumber;
    
    const where: any = {};
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    const [total, promotions] = await Promise.all([
      prisma.promotion.count({ where }),
      prisma.promotion.findMany({
        where,
        skip,
        take: limitNumber,
        orderBy: { createdAt: 'desc' }
      })
    ]);

    res.sendSuccess({
      total,
      page: pageNumber,
      limit: limitNumber,
      data: promotions
    });
  }),

  // 获取单个满减规则
  getDetail: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const promotion = await prisma.promotion.findUnique({
      where: { id: parseInt(id) }
    });

    if (!promotion) {
      throw new AppError(404, 'fail', '满减规则不存在');
    }

    res.sendSuccess(promotion);
  }),

  // 更新满减规则
  update: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { 
      name, 
      description, 
      type, 
      thresholdAmount, 
      discountAmount, 
      startTime, 
      endTime, 
      isActive 
    } = req.body;

    // 验证规则是否存在
    const existingPromotion = await prisma.promotion.findUnique({
      where: { id: parseInt(id) }
    });

    if (!existingPromotion) {
      throw new AppError(404, 'fail', '满减规则不存在');
    }

    // 验证优惠金额(如果是满减类型)
    if (type === 'AMOUNT_OFF' && thresholdAmount && discountAmount) {
      if (discountAmount >= thresholdAmount) {
        throw new AppError(400, 'fail', '优惠金额不能大于或等于满减阈值');
      }
    }

    // 准备更新数据
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (type !== undefined) updateData.type = type;
    if (thresholdAmount !== undefined) updateData.thresholdAmount = thresholdAmount;
    if (discountAmount !== undefined) updateData.discountAmount = discountAmount;
    if (startTime !== undefined) updateData.startTime = new Date(startTime);
    if (endTime !== undefined) updateData.endTime = new Date(endTime);
    if (isActive !== undefined) updateData.isActive = isActive;

    const promotion = await prisma.promotion.update({
      where: { id: parseInt(id) },
      data: updateData
    });

    res.sendSuccess(promotion, '满减规则更新成功');
  }),

  // 删除满减规则
  delete: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    
    // 检查规则是否存在
    const promotion = await prisma.promotion.findUnique({
      where: { id: parseInt(id) }
    });

    if (!promotion) {
      throw new AppError(404, 'fail', '满减规则不存在');
    }

    // 检查是否有关联的订单
    const hasOrders = await prisma.order.findFirst({
      where: { promotionId: parseInt(id) }
    });

    if (hasOrders) {
      throw new AppError(400, 'fail', '该规则已被订单使用，无法删除');
    }

    await prisma.promotion.delete({
      where: { id: parseInt(id) }
    });

    res.sendSuccess(null, '满减规则删除成功');
  }),
  
  // 启用/禁用规则
  toggleStatus: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { isActive } = req.body;
    
    const promotion = await prisma.promotion.update({
      where: { id: parseInt(id) },
      data: { isActive }
    });

    const statusText = isActive ? '启用' : '禁用';
    res.sendSuccess(promotion, `满减规则${statusText}成功`);
  })
};