// src/controllers/admin/order.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { OrderStatus } from '../../constants/orderStatus.enum';

export const orderController = {
      // 分页获取订单列表
      getOrders: asyncHandler(async (req: Request, res: Response) => {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const orderStatus = req.query.orderStatus ? parseInt(req.query.orderStatus as string) : undefined;
            const orderNo = req.query.orderNo as string | undefined;
            const startDate = req.query.startDate as string | undefined;
            const endDate = req.query.endDate as string | undefined;
            const skip = (page - 1) * limit;

            // 构建查询条件
            const whereClause: any = {};

            if (orderStatus !== undefined) {
                  whereClause.orderStatus = orderStatus;
            }

            if (orderNo) {
                  whereClause.orderNo = {
                        contains: orderNo
                  };
            }

            if (startDate && endDate) {
                  whereClause.createdAt = {
                        gte: new Date(startDate),
                        lte: new Date(endDate)
                  };
            } else if (startDate) {
                  whereClause.createdAt = {
                        gte: new Date(startDate)
                  };
            } else if (endDate) {
                  whereClause.createdAt = {
                        lte: new Date(endDate)
                  };
            }

            // 执行查询
            const [total, orders] = await Promise.all([
                  prisma.order.count({
                        where: whereClause
                  }),
                  prisma.order.findMany({
                        where: whereClause,
                        skip,
                        take: limit,
                        include: {
                              user: {
                                    select: {
                                          id: true,
                                          username: true
                                    }
                              },
                              _count: {
                                    select: {
                                          orderItems: true
                                    }
                              }
                        },
                        orderBy: {
                              createdAt: 'desc'
                        }
                  })
            ]);

            res.sendSuccess({
                  total,
                  page,
                  limit,
                  data: orders
            });
      }),

      // 获取订单详情
      getOrderDetail: asyncHandler(async (req: Request, res: Response) => {
            const { id } = req.params;

            const order = await prisma.order.findUnique({
                  where: { id },
                  include: {
                        user: {
                              select: {
                                    id: true,
                                    username: true
                              }
                        },
                        orderItems: {
                              include: {
                                    sku: {
                                          select: {
                                                id: true,
                                                price: true,
                                                skuCode: true,
                                                image: true
                                          }
                                    }
                              }
                        },
                        paymentLogs: true
                  }
            });

            if (!order) {
                  throw new AppError(404, 'fail', '订单不存在');
            }

            res.sendSuccess(order);
      }),

      // 更新订单状态为已发货
      updateOrderStatus: asyncHandler(async (req: Request, res: Response) => {
            const { id } = req.params;
            const { orderStatus, trackingNumber, remark } = req.body;

            // 查询订单是否存在
            const order = await prisma.order.findUnique({
                  where: { id }
            });

            if (!order) {
                  throw new AppError(404, 'fail', '订单不存在');
            }

            // 特殊处理：如果要更新为已发货状态，需要确保订单状态为待发货
            if (orderStatus === OrderStatus.SHIPPED) {
                  if (order.orderStatus !== OrderStatus.PENDING_SHIPMENT) {
                        throw new AppError(400, 'fail', '只有待发货状态的订单才能更新为已发货');
                  }

                  if (!trackingNumber) {
                        throw new AppError(400, 'fail', '请提供物流单号');
                  }
            }

            // 更新订单状态
            const updatedOrder = await prisma.order.update({
                  where: { id },
                  data: {
                        orderStatus,
                        // 这里可以添加物流信息、备注等其他字段，取决于您的数据库结构
                        // trackingNumber: trackingNumber,
                        // 假设您的数据库存储了物流信息和备注的扩展字段
                        // 如果没有相应字段，需要先修改数据库模型
                  },
                  include: {
                        user: {
                              select: {
                                    id: true,
                                    username: true
                              }
                        }
                  }
            });

            // 返回更新后的订单信息
            res.sendSuccess(updatedOrder, '订单状态更新成功');
      })
};