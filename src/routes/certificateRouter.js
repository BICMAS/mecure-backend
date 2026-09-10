import { Router } from 'express';
import { assignTemplateToCourse, assignTemplateToHRManager, claimLearnerCertificate, downloadLatestTemplate, downloadLearnerCertificate, downloadMyAssignedTemplatePreview, downloadTemplate, getCourseAssignedTemplate, getMyAssignedTemplate, issueCertificate, listTemplates, reissueOrgCertificates, uploadTemplate } from '../controllers/CertificateTemplateController.js';
import { authenticateToken, requireRole } from '../middleware/authMiddleware.js';

const certificateRouter = Router();

certificateRouter.post('/', authenticateToken, requireRole(['SUPER_ADMIN']), uploadTemplate);
certificateRouter.get('/', authenticateToken, requireRole(['SUPER_ADMIN', 'HR_MANAGER']), listTemplates);
certificateRouter.get('/latest/download', authenticateToken, requireRole(['HR_MANAGER', 'SUPER_ADMIN']), downloadLatestTemplate);
certificateRouter.get('/my-assigned-template', authenticateToken, requireRole(['HR_MANAGER']), getMyAssignedTemplate);
certificateRouter.get('/my-assigned-template/preview-pdf', authenticateToken, requireRole(['HR_MANAGER']), downloadMyAssignedTemplatePreview);
certificateRouter.get('/course/:courseId/template', authenticateToken, requireRole(['HR_MANAGER', 'SUPER_ADMIN']), getCourseAssignedTemplate);
certificateRouter.get('/:id/download', authenticateToken, requireRole(['HR_MANAGER', 'SUPER_ADMIN']), downloadTemplate);
certificateRouter.post('/assign-template', authenticateToken, requireRole(['HR_MANAGER', 'SUPER_ADMIN']), assignTemplateToCourse);
certificateRouter.post('/assign-to-hr', authenticateToken, requireRole(['SUPER_ADMIN']), assignTemplateToHRManager);
certificateRouter.post('/reissue-org', authenticateToken, requireRole(['SUPER_ADMIN']), reissueOrgCertificates);
certificateRouter.post('/issue', authenticateToken, requireRole(['HR_MANAGER']), issueCertificate);
certificateRouter.get('/my-courses/:courseId/certificate/download', authenticateToken, requireRole(['LEARNER']), downloadLearnerCertificate);
certificateRouter.post('/my-courses/:courseId/certificate', authenticateToken, requireRole(['LEARNER']), claimLearnerCertificate);

export default certificateRouter;
