// src/routes/image.route.ts
import { Router } from 'express';
import { imageController } from '../../controllers/admin/image.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { authMiddleware } from '../../middlewares/auth.middleware';
import {
      batchDeleteSchema,
      deleteImageSchema,
      paginationSchema
} from '../../validators/admin/image.validator';
import { ossService } from '../../services/oss.service';

const router = Router();
const upload = ossService.getMulterStorage();

// 所有路由都需要认证
router.use(authMiddleware);

// 图片上传 - 支持多文件上传
router.post(
      '/upload',
      upload.array('files', 10), // 最多同时上传10张图片
      imageController.upload
);

// 删除单个图片
router.delete(
      '/:id',
      validateRequest(deleteImageSchema),
      imageController.delete
);

// 批量删除图片
router.post(
      '/batch-delete',
      validateRequest(batchDeleteSchema),
      imageController.batchDelete
);

// 获取图片列表
router.get(
      '/',
      validateRequest(paginationSchema),
      imageController.getList
);

export default router;