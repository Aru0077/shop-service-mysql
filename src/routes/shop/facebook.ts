// src/routes/shop/facebook.ts
import { Router } from 'express';
import { facebookController } from '../../controllers/shop/facebook.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { facebookCallbackSchema, facebookTokenLoginSchema } from '../../validators/shop/facebook.validator';

const router = Router();

// 获取Facebook登录URL
router.get('/auth-url', facebookController.getLoginUrl);

// 处理Facebook OAuth回调
router.get(
      '/callback',
      validateRequest(facebookCallbackSchema),
      facebookController.handleCallback
);

// 通过访问令牌直接登录（用于前端SDK集成）
router.post(
      '/token-login',
      validateRequest(facebookTokenLoginSchema),
      facebookController.loginWithToken
);

export default router;