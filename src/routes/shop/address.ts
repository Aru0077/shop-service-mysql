// src/routes/shop/address.ts
import { Router } from 'express';
import { addressController } from '../../controllers/shop/address.controller';
import { validateRequest } from '../../middlewares/validateResult';
import {
    createAddressSchema,
    updateAddressSchema,
    deleteAddressSchema,
    getAddressesSchema,
    setDefaultAddressSchema
} from '../../validators/shop/address.validator';
import { shopAuthMiddleware } from '../../middlewares/shopAuth.middleware';

const router = Router();

// 所有地址路由都需要用户认证
router.use(shopAuthMiddleware);

// 新增收货地址
router.post(
    '/',
    validateRequest(createAddressSchema),
    addressController.createAddress
);

// 更新收货地址
router.put(
    '/:id',
    validateRequest(updateAddressSchema),
    addressController.updateAddress
);

// 删除收货地址
router.delete(
    '/:id',
    validateRequest(deleteAddressSchema),
    addressController.deleteAddress
);

// 获取收货地址列表
router.get(
    '/',
    validateRequest(getAddressesSchema),
    addressController.getAddresses
);

// 设置默认收货地址
router.patch(
    '/:id/default',
    validateRequest(setDefaultAddressSchema),
    addressController.setDefaultAddress
);

export default router;