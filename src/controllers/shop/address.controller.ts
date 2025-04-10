// src/controllers/shop/address.controller.ts
import { Request, Response } from 'express';
import { prisma } from '../../config';
import { asyncHandler } from '../../utils/http.utils';
import { AppError } from '../../utils/http.utils';
import { cacheUtils, CACHE_LEVELS } from '../../utils/cache.utils';

export const addressController = {
      // 新增收货地址
      createAddress: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            if (!userId) {
                  throw new AppError(401, 'fail', 'Please login first');
            }

            // 检查用户已有地址数量
            const addressCount = await prisma.userAddress.count({
                  where: { userId }
            });

            if (addressCount >= 20) {
                  throw new AppError(400, 'fail', 'You can only add up to 20 shipping addresses');
            }

            const { receiverName, receiverPhone, province, city, detailAddress, isDefault = 0 } = req.body;

            // 检查是否为第一个地址，如果是则自动设为默认
            const isFirstAddress = addressCount === 0;
            const shouldBeDefault = isFirstAddress ? 1 : isDefault;

            // 如果设置为默认地址，先将其他地址的默认标志清除
            if (shouldBeDefault === 1) {
                  await prisma.userAddress.updateMany({
                        where: { userId, isDefault: 1 },
                        data: { isDefault: 0 }
                  });
            }

            // 创建新地址
            const address = await prisma.userAddress.create({
                  data: {
                        userId,
                        receiverName,
                        receiverPhone,
                        province,
                        city,
                        detailAddress,
                        isDefault: shouldBeDefault
                  }
            });

            await cacheUtils.invalidateModuleCache('user', userId);

            res.sendSuccess(address, 'Shipping address added successfully');
      }),

      // 更新收货地址
      updateAddress: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;
            const addressId = parseInt(id);

            if (!userId) {
                  throw new AppError(401, 'fail', 'Please login first');
            }

            // 检查地址是否存在且属于当前用户
            const existingAddress = await prisma.userAddress.findFirst({
                  where: {
                        id: addressId,
                        userId
                  }
            });

            if (!existingAddress) {
                  throw new AppError(404, 'fail', 'Shipping address does not exist');
            }

            const { receiverName, receiverPhone, province, city, detailAddress, isDefault = 0 } = req.body;

            // 如果设置为默认地址，先将其他地址的默认标志清除
            if (isDefault === 1 && existingAddress.isDefault !== 1) {
                  await prisma.userAddress.updateMany({
                        where: { userId, isDefault: 1 },
                        data: { isDefault: 0 }
                  });
            }

            // 更新地址
            const updatedAddress = await prisma.userAddress.update({
                  where: { id: addressId },
                  data: {
                        receiverName,
                        receiverPhone,
                        province,
                        city,
                        detailAddress,
                        isDefault
                  }
            });
            // 清除用户相关缓存
            await cacheUtils.invalidateModuleCache('user', userId);

            res.sendSuccess(updatedAddress, 'Shipping address updated successfully');
      }),

      // 删除收货地址
      deleteAddress: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;
            const addressId = parseInt(id);

            if (!userId) {
                  throw new AppError(401, 'fail', 'Please login first');
            }

            // 检查地址是否存在且属于当前用户
            const existingAddress = await prisma.userAddress.findFirst({
                  where: {
                        id: addressId,
                        userId
                  }
            });

            if (!existingAddress) {
                  throw new AppError(404, 'fail', 'Shipping address does not exist');
            }

            // 删除地址
            await prisma.userAddress.delete({
                  where: { id: addressId }
            });

            // 如果删除的是默认地址，且还有其他地址，则将第一个地址设为默认
            if (existingAddress.isDefault === 1) {
                  const remainingAddress = await prisma.userAddress.findFirst({
                        where: { userId },
                        orderBy: { createdAt: 'asc' }
                  });

                  if (remainingAddress) {
                        await prisma.userAddress.update({
                              where: { id: remainingAddress.id },
                              data: { isDefault: 1 }
                        });
                  }
            }

            // 清除用户相关缓存
            await cacheUtils.invalidateModuleCache('user', userId);

            res.sendSuccess(null, 'Shipping address deleted successfully');
      }),

      // 获取收货地址列表
      getAddresses: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;

            if (!userId) {
                  throw new AppError(401, 'fail', 'Please login first');
            }

            // 添加缓存
            const cacheKey = `user:${userId}:addresses`;
            const addresses = await cacheUtils.multiLevelCache(cacheKey, async () => {
                  return await prisma.userAddress.findMany({
                        where: { userId },
                        orderBy: [
                              { isDefault: 'desc' },
                              { updatedAt: 'desc' }
                        ]
                  });
            }, CACHE_LEVELS.SHORT); // 5分钟缓存

            res.sendSuccess(addresses);
      }),

      // 设置默认收货地址
      setDefaultAddress: asyncHandler(async (req: Request, res: Response) => {
            const userId = req.shopUser?.id;
            const { id } = req.params;
            const addressId = parseInt(id);

            if (!userId) {
                  throw new AppError(401, 'fail', 'Please login first');
            }

            // 检查地址是否存在且属于当前用户
            const existingAddress = await prisma.userAddress.findFirst({
                  where: {
                        id: addressId,
                        userId
                  }
            });

            if (!existingAddress) {
                  throw new AppError(404, 'fail', 'Shipping address does not exist');
            }

            // 如果已经是默认地址，不需要操作
            if (existingAddress.isDefault === 1) {
                  return res.sendSuccess(existingAddress, 'This address is already the default address');
            }

            // 使用事务保证数据一致性
            await prisma.$transaction([
                  // 清除其他默认地址
                  prisma.userAddress.updateMany({
                        where: { userId, isDefault: 1 },
                        data: { isDefault: 0 }
                  }),
                  // 设置新的默认地址
                  prisma.userAddress.update({
                        where: { id: addressId },
                        data: { isDefault: 1 }
                  })
            ]);

            // 重新查询更新后的地址
            const updatedAddress = await prisma.userAddress.findUnique({
                  where: { id: addressId }
            });

            // 清除用户相关缓存
            await cacheUtils.invalidateModuleCache('user', userId);
            
            res.sendSuccess(updatedAddress, 'Default address set successfully');
      })
};