import { Router } from 'express';
import { createBatch, listBatches } from '../controllers/BatchController.js';
import { authenticateToken, requireRole } from '../middleware/authMiddleware.js';

const batchRouter = Router();

batchRouter.get(
    '/',
    authenticateToken,
    requireRole(['SUPER_ADMIN', 'HR_MANAGER']),
    listBatches,
);
batchRouter.post(
    '/',
    authenticateToken,
    requireRole(['SUPER_ADMIN', 'HR_MANAGER']),
    createBatch,
);

export default batchRouter;
