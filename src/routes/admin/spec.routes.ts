// src/routes/admin/spec.routes.ts
import { Router } from 'express';
import { specController } from '../../controllers/admin/spec.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { authMiddleware } from '../../middlewares/auth.middleware';
import {
      createSpecSchema,
      updateSpecSchema,
      deleteSpecSchema
} from '../../validators/admin/spec.validator';

const router = Router();

// 所有路由都需要认证
router.use(authMiddleware);

// 创建规格
router.post(
      '/',
      validateRequest(createSpecSchema),
      specController.create
);

// 更新规格
router.put(
      '/:id',
      validateRequest(updateSpecSchema),
      specController.update
);
 
// 删除规格
router.delete(
      '/:id',
      validateRequest(deleteSpecSchema),
      specController.delete
);

// 获取规格列表
router.get('/', specController.getList);

// 获取规格详情
router.get('/:id', specController.getDetail);

export default router;