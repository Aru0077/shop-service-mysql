// src/validators/shop/address.validator.ts
import { z } from 'zod';

// 基础地址字段验证
const baseAddressSchema = {
    receiverName: z.string()
        .min(2, '收货人姓名不能少于2个字符')
        .max(50, '收货人姓名不能超过50个字符'),
    receiverPhone: z.string()
        .min(5, '联系电话不能少于5个字符')
        .max(20, '联系电话不能超过20个字符'),
    province: z.string()
        .min(2, '省份不能少于2个字符')
        .max(50, '省份不能超过50个字符'),
    city: z.string()
        .min(2, '城市不能少于2个字符')
        .max(50, '城市不能超过50个字符'),
    detailAddress: z.string()
        .min(5, '详细地址不能少于5个字符')
        .max(255, '详细地址不能超过255个字符'),
    isDefault: z.number()
        .int()
        .min(0, '默认状态必须为0或1')
        .max(1, '默认状态必须为0或1')
        .optional()
        .default(0)
};

// 新增地址验证
export const createAddressSchema = z.object({
    body: z.object(baseAddressSchema)
});

// 更新地址验证
export const updateAddressSchema = z.object({
    params: z.object({
        id: z.string().regex(/^\d+$/, '无效的地址ID')
    }),
    body: z.object(baseAddressSchema)
});

// 删除地址验证
export const deleteAddressSchema = z.object({
    params: z.object({
        id: z.string().regex(/^\d+$/, '无效的地址ID')
    })
});

// 获取地址列表验证
export const getAddressesSchema = z.object({
    query: z.object({}).optional()
});

// 设置默认地址验证
export const setDefaultAddressSchema = z.object({
    params: z.object({
        id: z.string().regex(/^\d+$/, '无效的地址ID')
    })
});