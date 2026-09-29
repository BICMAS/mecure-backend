import { Router } from 'express';
import {
    createAssignments,
    getAssignedCourses,
    getCourseAssignees,
    updateAssignmentDueDate,
} from '../controllers/AssignmentController.js';
import { authenticateToken, requireRole } from '../middleware/authMiddleware.js';

const assignmentRouter = Router();

assignmentRouter.post('/', authenticateToken, requireRole(['HR_MANAGER', 'SUPER_ADMIN']), createAssignments);
assignmentRouter.get('/assigned-courses', authenticateToken, requireRole(['LEARNER']), getAssignedCourses);
assignmentRouter.get(
    '/course/:courseId/assignees',
    authenticateToken,
    requireRole(['HR_MANAGER', 'SUPER_ADMIN']),
    getCourseAssignees,
);
assignmentRouter.patch(
    '/:assignmentId/due-date',
    authenticateToken,
    requireRole(['HR_MANAGER', 'SUPER_ADMIN']),
    updateAssignmentDueDate,
);

export default assignmentRouter;
