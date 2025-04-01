// src/routes/shop/facebook.ts
import { Router } from 'express';
import { facebookController } from '../../controllers/shop/facebook.controller';
import { validateRequest } from '../../middlewares/validateResult';
import { facebookTokenLoginSchema } from '../../validators/shop/facebook.validator';

const router = Router();

// 通过访问令牌直接登录
router.post(
    '/token-login',
    validateRequest(facebookTokenLoginSchema),
    facebookController.loginWithToken
);

export default router;