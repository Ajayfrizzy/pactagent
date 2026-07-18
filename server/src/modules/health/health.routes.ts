import { Router } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import * as healthController from './health.controller';

const router = Router();

router.get('/health', healthController.health);
router.get('/ready', asyncHandler(healthController.ready));
router.get('/metrics', asyncHandler(healthController.metrics));

export default router;
