/**
 * auth.routes.js – Routes for /api/v1/auth
 */
import { Router } from 'express';
import { validateBody } from '../../common/validate.js';
import { registerSchema, loginSchema } from './auth.schema.js';
import { authController } from './auth.controller.js';

const router = Router();

router.post('/register', validateBody(registerSchema), authController.register);
router.post('/login',    validateBody(loginSchema),    authController.login);

export default router;
