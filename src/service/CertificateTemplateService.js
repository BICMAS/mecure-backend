import { CertificateTemplateModel } from '../models/CertificateTemplateModel.js';
import { CertificateModel } from '../models/CertificateModel.js';
import { CourseModel } from '../models/CourseModel.js';
import { UserModel } from '../models/UserModel.js';
import { AssignmentModel } from '../models/AssignmentModel.js';
import { getAssignmentCompletionState } from '../lib/courseCompletion.js';
import { CertificatePdfService, serializeTemplateMetadata } from './CertificatePdfService.js';
import { StorageService } from '../services/StorageService.js';
import { resolveIssuanceTemplateId } from '../lib/courseCertificateTemplate.js';
import {
    formatAssignedTemplateForClient,
    parseTemplateDisplayFields,
    SAMPLE_CERTIFICATE_PREVIEW,
} from '../lib/certificateTemplatePreview.js';
import { assertLearnerCourseUnlocked } from '../lib/courseLock.js';
import {
    getCategoryCertificateEligibility,
    getCategoryCertificateStatusMap,
    resolveTemplateIdForCategory,
} from '../lib/categoryCertificateEligibility.js';
import { prisma } from '../utils/db.js';

const ALLOWED_LOGO_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
]);

export class CertificateTemplateService {
    static assertAllowedImageFile(filename, mimeType) {
        const normalizedMime = String(mimeType || '').toLowerCase();
        const lowerName = String(filename || '').toLowerCase();
        const isAllowedMime = ALLOWED_LOGO_MIME_TYPES.has(normalizedMime);
        const isAllowedExt = ['.png', '.jpg', '.jpeg', '.webp'].some((ext) =>
            lowerName.endsWith(ext),
        );

        if (!isAllowedMime && !isAllowedExt) {
            throw new Error('Only PNG, JPG, or WEBP image files are allowed');
        }
    }

    static async uploadSignatureAsset(filePath, filename, mimeType) {
        CertificateTemplateService.assertAllowedImageFile(filename, mimeType);
        const objectKey = StorageService.buildObjectKey('certificates/signatures', filename);
        await StorageService.uploadFile(objectKey, filePath, mimeType);
        return {
            blobUrl: objectKey,
            mimeType,
        };
    }

    static async uploadTemplate(
        filePath,
        filename,
        mimeType,
        description,
        themeConfig,
        uploadedBy,
        signatureFiles = {},
    ) {
        if (!uploadedBy) throw new Error('Uploader ID required');
        if (!filename) throw new Error('Filename required');

        CertificateTemplateService.assertAllowedImageFile(filename, mimeType);

        const enrichedThemeConfig = { ...(themeConfig || {}) };

        if (signatureFiles.signatorySignature) {
            const uploadedSignature = await CertificateTemplateService.uploadSignatureAsset(
                signatureFiles.signatorySignature.path,
                signatureFiles.signatorySignature.originalname,
                signatureFiles.signatorySignature.mimetype,
            );
            enrichedThemeConfig.signatorySignatureBlobUrl = uploadedSignature.blobUrl;
            enrichedThemeConfig.signatorySignatureMimeType = uploadedSignature.mimeType;
        }

        if (signatureFiles.signatorySignature2) {
            const uploadedSignature = await CertificateTemplateService.uploadSignatureAsset(
                signatureFiles.signatorySignature2.path,
                signatureFiles.signatorySignature2.originalname,
                signatureFiles.signatorySignature2.mimetype,
            );
            enrichedThemeConfig.signatory2SignatureBlobUrl = uploadedSignature.blobUrl;
            enrichedThemeConfig.signatory2SignatureMimeType = uploadedSignature.mimeType;
        }

        const metadata = serializeTemplateMetadata(description, enrichedThemeConfig);

        const result = await CertificateTemplateModel.uploadAndSave(
            filePath,
            filename,
            mimeType,
            metadata,
            uploadedBy
        );
        return result;
    }

    static async getTemplateById(id) {
        if (!id) throw new Error('Template ID required');
        const template = await CertificateTemplateModel.findById(id);
        if (!template) throw new Error('Certificate template not found');
        return template;
    }

    static async getLatestTemplate() {
        const template = await CertificateTemplateModel.findLatest();
        if (!template) throw new Error('No certificate templates found');
        return template;
    }

    static async listTemplates() {
        return CertificateTemplateModel.findMany();
    }

    static async assignTemplateToCourse(courseId, templateId, actorId, requester) {
        if (!courseId) throw new Error('Course ID required');
        if (!actorId) throw new Error('Actor ID required');

        const normalizedTemplateId = templateId === '' || templateId == null ? null : templateId;

        const course = await CourseModel.findById(courseId);
        if (!course) throw new Error('Course not found');

        if (requester?.userRole === 'HR_MANAGER') {
            if (!normalizedTemplateId) throw new Error('Template ID required');
            if (!requester.orgId) throw new Error('HR must be in an organization');
            const assignedTemplateId = await CertificateModel.getAssignedTemplateForHR(requester.orgId, actorId);
            if (!assignedTemplateId) throw new Error('No certificate template assigned to HR manager');
            if (assignedTemplateId !== normalizedTemplateId) {
                throw new Error('HR manager can only assign their allocated certificate template');
            }
        }

        if (normalizedTemplateId) {
            const template = await CertificateTemplateModel.findById(normalizedTemplateId);
            if (!template) throw new Error('Certificate template not found');
        }

        await CertificateModel.assignTemplateToCourse({
            courseId,
            templateId: normalizedTemplateId,
            actorId,
        });

        const reissueResult = normalizedTemplateId
            ? await CertificateTemplateService.reissueCertificatesForCourse(courseId, actorId)
            : { reissuedCount: 0, errors: [] };

        return { courseId, templateId: normalizedTemplateId, ...reissueResult };
    }

    static async assignTemplateToHRManager({ templateId, orgId, hrManagerId, actorId }) {
        if (!templateId) throw new Error('Template ID required');
        if (!orgId) throw new Error('Organization ID required');
        if (!hrManagerId) throw new Error('HR Manager ID required');
        if (!actorId) throw new Error('Actor ID required');

        const [template, hrManager] = await Promise.all([
            CertificateTemplateModel.findById(templateId),
            UserModel.findById(hrManagerId)
        ]);

        if (!template) throw new Error('Certificate template not found');
        if (!hrManager) throw new Error('HR manager not found');
        if (hrManager.userRole !== 'HR_MANAGER') throw new Error('User must be an HR manager');
        if (hrManager.orgId !== orgId) throw new Error('HR manager does not belong to the provided organization');

        await CertificateModel.assignTemplateToOrgHR({ orgId, hrManagerId, templateId, actorId });

        const reissueResult = await CertificateTemplateService.reissueCertificatesForOrg(
            orgId,
            actorId,
        );

        return { templateId, orgId, hrManagerId, ...reissueResult };
    }

    static async getAssignedTemplateForHRManager(hrManagerId, orgId) {
        if (!hrManagerId) throw new Error('HR Manager ID required');
        if (!orgId) throw new Error('HR must be in an organization');

        const templateId = await CertificateModel.getAssignedTemplateForHR(orgId, hrManagerId);
        if (!templateId) throw new Error('No certificate template assigned to this HR manager');

        const template = await CertificateTemplateModel.findById(templateId);
        if (!template) throw new Error('Certificate template not found');

        return CertificateTemplateService.formatAssignedTemplateWithAssets({
            orgId,
            hrManagerId,
            templateId,
            template,
        });
    }

    static async getAssignedTemplateForCourse(courseId) {
        if (!courseId) throw new Error('Course ID required');

        const course = await CourseModel.findById(courseId);
        if (!course) throw new Error('Course not found');

        const templateId = course.certificateTemplateId
            ?? await CertificateModel.getAssignedTemplateForCourse(courseId);
        if (!templateId) throw new Error('No template assigned to course');

        const template = await CertificateTemplateModel.findById(templateId);
        if (!template) throw new Error('Certificate template not found');

        return {
            courseId,
            templateId,
            template: (await CertificateTemplateService.formatAssignedTemplateWithAssets({
                templateId,
                template,
            })).template,
        };
    }

    static async resolveTemplateAssetUrl(storedValue) {
        if (!storedValue) return null;
        try {
            return await StorageService.resolveStorageUrl(storedValue);
        } catch (error) {
            console.error('Failed to resolve certificate template asset URL:', error);
            return null;
        }
    }

    static async formatAssignedTemplateWithAssets({
        orgId = null,
        hrManagerId = null,
        templateId,
        template,
    }) {
        const display = parseTemplateDisplayFields(template?.description);
        const [previewUrl, signatorySignatureUrl, signatory2SignatureUrl] = await Promise.all([
            CertificateTemplateService.resolveTemplateAssetUrl(template?.blobUrl),
            CertificateTemplateService.resolveTemplateAssetUrl(display.signatorySignatureBlobUrl),
            CertificateTemplateService.resolveTemplateAssetUrl(display.signatory2SignatureBlobUrl),
        ]);

        return formatAssignedTemplateForClient(
            {
                orgId,
                hrManagerId,
                templateId,
                template,
            },
            previewUrl,
            {
                signatorySignatureUrl,
                signatory2SignatureUrl,
            },
        );
    }

    static async generateAssignedTemplatePreviewPdf(hrManagerId, orgId) {
        if (!hrManagerId) throw new Error('HR Manager ID required');
        if (!orgId) throw new Error('HR must be in an organization');

        const templateId = await CertificateModel.getAssignedTemplateForHR(orgId, hrManagerId);
        if (!templateId) throw new Error('No certificate template assigned to this HR manager');

        const template = await CertificateTemplateModel.findById(templateId);
        if (!template) throw new Error('Certificate template not found');

        const pdfBytes = await CertificatePdfService.generatePdfBytes({
            template,
            traineeName: SAMPLE_CERTIFICATE_PREVIEW.traineeName,
            courseTitle: SAMPLE_CERTIFICATE_PREVIEW.courseTitle,
            issuedAt: new Date(),
        });

        return {
            filename: 'mecure-certificate-preview.pdf',
            pdfBytes,
        };
    }

    static async formatCertificateForClient(certificate) {
        if (!certificate) return null;

        const certificateUrl = await StorageService.resolveStorageUrl(certificate.pdfPath);

        return {
            ...certificate,
            certificateUrl,
            pdfPath: certificateUrl || certificate.pdfPath,
        };
    }

    static async resolveTemplateIdForIssuance({ courseId, categoryId = null }) {
        if (categoryId) {
            const fromCategory = await resolveTemplateIdForCategory(categoryId);
            if (fromCategory) return fromCategory;
        }

        if (!courseId) return null;

        const course = await CourseModel.findById(courseId);
        if (course?.categoryId) {
            const fromCategory = await resolveTemplateIdForCategory(course.categoryId);
            if (fromCategory) return fromCategory;
        }

        const courseTemplateId = course?.certificateTemplateId
            ?? await CertificateModel.getAssignedTemplateForCourse(courseId);

        return resolveIssuanceTemplateId({ courseTemplateId });
    }

    static async reissueCertificate({ certificate, user, course, category, templateId, issuerId }) {
        if (!certificate) throw new Error('Certificate not found');
        if (!user) throw new Error('User not found');

        const resolvedCategory = category
            ?? (certificate.categoryId
                ? await prisma.courseCategory.findUnique({ where: { id: certificate.categoryId } })
                : null);

        if (!resolvedCategory) {
            throw new Error('Certificate category not found');
        }

        const resolvedTemplateId = templateId
            ?? await CertificateTemplateService.resolveTemplateIdForIssuance({
                courseId: course?.id ?? certificate.courseId,
                categoryId: resolvedCategory.id,
            });
        if (!resolvedTemplateId) {
            throw new Error('No certificate template assigned to this topic');
        }

        const template = await CertificateTemplateModel.findById(resolvedTemplateId);
        if (!template) throw new Error('Certificate template not found');

        const generatedPdf = await CertificatePdfService.generateAndUpload({
            template,
            traineeName: user.fullName,
            courseTitle: resolvedCategory.name,
            issuedAt: certificate.issuedAt || new Date(),
        });

        const updated = await CertificateModel.updateCertificate(certificate.id, {
            templateId: resolvedTemplateId,
            pdfPath: generatedPdf.blobUrl,
        });

        return {
            ...(await CertificateTemplateService.formatCertificateForClient(updated)),
            issuedBy: issuerId,
        };
    }

    static async ensureCertificateCurrent({ learnerId, categoryId, issuerId }) {
        const existing = await CertificateModel.findCertificateByUserAndCategory(
            learnerId,
            categoryId,
        );
        if (!existing) {
            return { certificate: null, reissued: false };
        }

        const [user, category] = await Promise.all([
            UserModel.findById(learnerId),
            prisma.courseCategory.findUnique({ where: { id: categoryId } }),
        ]);
        if (!user || !category) {
            return {
                certificate: await CertificateTemplateService.formatCertificateForClient(existing),
                reissued: false,
            };
        }

        const resolvedTemplateId = await CertificateTemplateService.resolveTemplateIdForIssuance({
            categoryId,
            courseId: existing.courseId,
        });
        if (!resolvedTemplateId || existing.templateId === resolvedTemplateId) {
            return {
                certificate: await CertificateTemplateService.formatCertificateForClient(existing),
                reissued: false,
            };
        }

        const course = existing.courseId
            ? await CourseModel.findById(existing.courseId)
            : null;

        const reissued = await CertificateTemplateService.reissueCertificate({
            certificate: existing,
            user,
            course,
            category,
            templateId: resolvedTemplateId,
            issuerId,
        });

        return { certificate: reissued, reissued: true };
    }

    static async reissueCertificatesForOrg(orgId, actorId) {
        if (!orgId) throw new Error('Organization ID required');

        const certificates = await CertificateModel.findCertificatesByOrgId(orgId);
        let reissuedCount = 0;
        const errors = [];

        for (const certificate of certificates) {
            try {
                const resolvedTemplateId = await CertificateTemplateService.resolveTemplateIdForIssuance({
                    courseId: certificate.courseId,
                    categoryId: certificate.categoryId,
                });

                if (!resolvedTemplateId || certificate.templateId === resolvedTemplateId) {
                    continue;
                }

                await CertificateTemplateService.reissueCertificate({
                    certificate,
                    user: certificate.user,
                    course: certificate.course,
                    category: certificate.category,
                    templateId: resolvedTemplateId,
                    issuerId: actorId,
                });
                reissuedCount += 1;
            } catch (error) {
                errors.push({
                    certificateId: certificate.id,
                    userId: certificate.userId,
                    courseId: certificate.courseId,
                    categoryId: certificate.categoryId,
                    error: error.message,
                });
            }
        }

        return { reissuedCount, errors };
    }

    static async reissueCertificatesForCourse(courseId, actorId) {
        if (!courseId) throw new Error('Course ID required');

        const course = await CourseModel.findById(courseId);
        const certificates = course?.categoryId
            ? await CertificateModel.findCertificatesByCategoryId(course.categoryId)
            : await CertificateModel.findCertificatesByCourseId(courseId);
        let reissuedCount = 0;
        const errors = [];

        for (const certificate of certificates) {
            try {
                const resolvedTemplateId = await CertificateTemplateService.resolveTemplateIdForIssuance({
                    courseId,
                    categoryId: certificate.categoryId ?? course?.categoryId,
                });

                if (!resolvedTemplateId || certificate.templateId === resolvedTemplateId) {
                    continue;
                }

                await CertificateTemplateService.reissueCertificate({
                    certificate,
                    user: certificate.user,
                    course: certificate.course ?? course,
                    category: certificate.category,
                    templateId: resolvedTemplateId,
                    issuerId: actorId,
                });
                reissuedCount += 1;
            } catch (error) {
                errors.push({
                    certificateId: certificate.id,
                    userId: certificate.userId,
                    courseId: certificate.courseId,
                    categoryId: certificate.categoryId,
                    error: error.message,
                });
            }
        }

        return { reissuedCount, errors };
    }

    /**
     * HR manual issue — left available but gated on full topic completion
     * when the course belongs to a category (same rules as learner claim).
     */
    static async issueCertificate({ userId, courseId, issuerId, templateId, requester }) {
        if (!userId) throw new Error('User ID required');
        if (!courseId) throw new Error('Course ID required');
        if (!issuerId) throw new Error('Issuer ID required');

        const [user, course] = await Promise.all([
            UserModel.findById(userId),
            CourseModel.findById(courseId),
        ]);
        if (!user) throw new Error('User not found');
        if (!course) throw new Error('Course not found');
        if (!course.categoryId) {
            throw new Error('Course has no topic; certificates are issued per topic');
        }
        assertLearnerCourseUnlocked(course, requester?.userRole);
        if (requester?.userRole === 'HR_MANAGER') {
            if (!requester.orgId) throw new Error('HR must be in an organization');
            if (user.orgId !== requester.orgId) {
                throw new Error('HR manager can only issue certificates to learners in their organization');
            }
        }

        return CertificateTemplateService.issueCategoryCertificate({
            userId,
            categoryId: course.categoryId,
            triggerCourseId: courseId,
            issuerId,
            templateId,
            requester,
            skipEligibilityCheck: false,
        });
    }

    static async issueCategoryCertificate({
        userId,
        categoryId,
        triggerCourseId = null,
        issuerId,
        templateId = null,
        requester = null,
        skipEligibilityCheck = false,
    }) {
        if (!userId) throw new Error('User ID required');
        if (!categoryId) throw new Error('Category ID required');
        if (!issuerId) throw new Error('Issuer ID required');

        const user = await UserModel.findById(userId);
        if (!user) throw new Error('User not found');

        const eligibility = await getCategoryCertificateEligibility(userId, categoryId);
        if (!skipEligibilityCheck && !eligibility.eligible) {
            if (eligibility.assignedCount === 0) {
                throw new Error('No courses in this topic are assigned to the learner');
            }
            throw new Error(
                `Finish all courses in this topic first (${eligibility.completedCount}/${eligibility.assignedCount} complete)`,
            );
        }

        const lockedCourse = eligibility.courseStates.find((row) => row.isLocked);
        if (lockedCourse && requester?.userRole === 'LEARNER') {
            assertLearnerCourseUnlocked({ isLocked: true }, 'LEARNER');
        }

        if (requester?.userRole === 'HR_MANAGER') {
            if (!requester.orgId) throw new Error('HR must be in an organization');
            if (user.orgId !== requester.orgId) {
                throw new Error('HR manager can only issue certificates to learners in their organization');
            }
        }

        const resolvedTemplateId = templateId
            || eligibility.templateId
            || await CertificateTemplateService.resolveTemplateIdForIssuance({ categoryId });
        if (!resolvedTemplateId) {
            throw new Error('No certificate template assigned to this topic');
        }

        const template = await CertificateTemplateModel.findById(resolvedTemplateId);
        if (!template) throw new Error('Certificate template not found');

        const existing = await CertificateModel.findCertificateByUserAndCategory(userId, categoryId);
        if (existing) {
            throw new Error('Certificate already issued for this user and topic');
        }

        const issuedAt = new Date();
        const generatedPdf = await CertificatePdfService.generateAndUpload({
            template,
            traineeName: user.fullName,
            courseTitle: eligibility.category.name,
            issuedAt,
        });

        const certificate = await CertificateModel.createCertificate({
            userId,
            categoryId,
            courseId: triggerCourseId,
            templateId: resolvedTemplateId,
            pdfPath: generatedPdf.blobUrl,
            issuedAt,
        });

        return {
            ...(await CertificateTemplateService.formatCertificateForClient(certificate)),
            issuedBy: issuerId,
            categoryId,
            categoryName: eligibility.category.name,
        };
    }

    static async listLearnerCategoryCertificates(learnerId) {
        if (!learnerId) throw new Error('Learner ID required');
        const statusMap = await getCategoryCertificateStatusMap(learnerId);
        const topics = Object.values(statusMap).sort((a, b) =>
            String(a.categoryName).localeCompare(String(b.categoryName), undefined, {
                sensitivity: 'base',
            }),
        );

        const withUrls = await Promise.all(
            topics.map(async (topic) => {
                if (!topic.certificateId) return topic;
                const cert = await CertificateModel.findCertificateById(topic.certificateId);
                const formatted = await CertificateTemplateService.formatCertificateForClient(cert);
                return {
                    ...topic,
                    certificate: formatted,
                    certificateUrl: formatted?.certificateUrl ?? null,
                };
            }),
        );

        return withUrls;
    }

    static async claimLearnerCategoryCertificate(learnerId, categoryId) {
        if (!learnerId) throw new Error('Learner ID required');
        if (!categoryId) throw new Error('Category ID required');

        const eligibility = await getCategoryCertificateEligibility(learnerId, categoryId);
        if (!eligibility.eligible) {
            if (eligibility.assignedCount === 0) {
                throw new Error('No courses in this topic are assigned to you');
            }
            throw new Error(
                `Finish all courses in this topic first (${eligibility.completedCount}/${eligibility.assignedCount} complete)`,
            );
        }

        const existing = await CertificateModel.findCertificateByUserAndCategory(
            learnerId,
            categoryId,
        );
        if (existing) {
            const current = await CertificateTemplateService.ensureCertificateCurrent({
                learnerId,
                categoryId,
                issuerId: learnerId,
            });

            return {
                certificate: {
                    ...current.certificate,
                    categoryId,
                    categoryName: eligibility.category.name,
                },
                issued: false,
                reissued: current.reissued,
                categoryId,
                categoryName: eligibility.category.name,
            };
        }

        const triggerCourseId = eligibility.courseStates[eligibility.courseStates.length - 1]?.courseId
            ?? null;

        const created = await CertificateTemplateService.issueCategoryCertificate({
            userId: learnerId,
            categoryId,
            triggerCourseId,
            issuerId: learnerId,
            requester: { userRole: 'LEARNER' },
            skipEligibilityCheck: true,
        });

        return {
            certificate: created,
            issued: true,
            reissued: false,
            categoryId,
            categoryName: eligibility.category.name,
        };
    }

    /** Course route stays as a thin wrapper → category certificate. */
    static async claimLearnerCertificate(learnerId, courseId) {
        if (!learnerId) throw new Error('Learner ID required');
        if (!courseId) throw new Error('Course ID required');

        const assignment = await AssignmentModel.findByCourseAndLearner(courseId, learnerId);
        if (!assignment) {
            throw new Error('Course not assigned to learner');
        }

        const course = await CourseModel.findById(courseId);
        if (!course) throw new Error('Course not found');
        if (!course.categoryId) {
            throw new Error('Course has no topic; certificates are issued per topic');
        }

        const completionState = await getAssignmentCompletionState(learnerId, courseId);
        if (!completionState.complete || !completionState.passed) {
            if (completionState.requiresRetake) {
                throw new Error(
                    `Quiz not passed. Minimum score is ${completionState.passingScore}%. Please retake the course.`,
                );
            }
            throw new Error('Course not yet completed');
        }

        assertLearnerCourseUnlocked(course, 'LEARNER');

        return CertificateTemplateService.claimLearnerCategoryCertificate(
            learnerId,
            course.categoryId,
        );
    }

    static async downloadLearnerCategoryCertificate(learnerId, categoryId) {
        const claimResult = await CertificateTemplateService.claimLearnerCategoryCertificate(
            learnerId,
            categoryId,
        );
        const storedCertificate = await CertificateModel.findCertificateByUserAndCategory(
            learnerId,
            categoryId,
        );

        if (!storedCertificate?.pdfPath) {
            throw new Error('Certificate file not found');
        }

        const fileBuffer = await StorageService.getObjectBuffer(storedCertificate.pdfPath);
        const slug = String(claimResult.categoryName || categoryId)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60);

        return {
            fileBuffer,
            filename: `certificate-${slug || categoryId}.pdf`,
            certificate: claimResult.certificate,
            issued: claimResult.issued,
            categoryId,
            categoryName: claimResult.categoryName,
        };
    }

    static async downloadLearnerCertificate(learnerId, courseId) {
        const course = await CourseModel.findById(courseId);
        if (!course) throw new Error('Course not found');
        if (!course.categoryId) {
            throw new Error('Course has no topic; certificates are issued per topic');
        }

        return CertificateTemplateService.downloadLearnerCategoryCertificate(
            learnerId,
            course.categoryId,
        );
    }
}
