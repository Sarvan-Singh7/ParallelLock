/**
 * auth.routes.js – Routes for /api/v1/auth
 */
import { Router } from 'express';
import { validateBody } from '../../common/validate.js';
import { registerSchema, loginSchema } from './auth.schema.js';
import { authController } from './auth.controller.js';
import { registerRateLimiter, loginRateLimiter } from '../../common/middleware/rateLimiter.js';

const router = Router();

router.post('/register', registerRateLimiter, validateBody(registerSchema), authController.register);
router.post('/login',    loginRateLimiter,    validateBody(loginSchema),    authController.login);

export default router;
