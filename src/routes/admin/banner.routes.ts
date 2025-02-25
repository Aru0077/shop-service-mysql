// src/routes/banner.routes.ts
import { Router } from 'express';
import { bannerController } from '../../controllers/admin/banner.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { createBannerSchema, updateBannerSchema } from '../../validators/admin/banner.validator';
import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();

// 获取banner不需要认证
router.get('/', bannerController.get);

// 其他操作需要认证
router.use(authMiddleware);
router.post('/', validateRequest(createBannerSchema), bannerController.create);
router.put('/', validateRequest(updateBannerSchema), bannerController.update);
router.delete('/', bannerController.delete);

export default router;