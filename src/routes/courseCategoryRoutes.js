import { Router } from 'express';
import { createCourseCategory, listCourseCategories } from '../controllers/CourseCategoryController.js';
import { authenticateToken, requireRole } from '../middleware/authMiddleware.js';

const courseCategoryRouter = Router();

courseCategoryRouter.get('/', authenticateToken, listCourseCategories);
courseCategoryRouter.post('/', authenticateToken, requireRole(['SUPER_ADMIN']), createCourseCategory);

export default courseCategoryRouter;
