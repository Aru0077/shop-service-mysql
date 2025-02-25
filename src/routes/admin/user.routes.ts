// src/routes/admin/user.routes.ts
import { Router } from 'express';
import { userController } from '../../controllers/admin/user.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { authMiddleware } from '../../middlewares/auth.middleware';
import {
      userPaginationSchema,
      blacklistStatusSchema,
      getUserDetailsSchema
} from '../../validators/admin/user.validator';

const router = Router();

// 所有路由都需要管理员认证
router.use(authMiddleware);

// 获取用户列表（支持分页和用户名搜索）
router.get(
      '/',
      validateRequest(userPaginationSchema),
      userController.getUsers
);

// 获取单个用户详情
router.get(
      '/:id',
      validateRequest(getUserDetailsSchema),
      userController.getUserDetails
);

// 设置用户黑名单状态
router.put(
      '/:id/blacklist',
      validateRequest(blacklistStatusSchema),
      userController.setBlacklistStatus
);

export default router;