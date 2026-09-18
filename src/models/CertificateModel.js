import crypto from 'crypto';
import { prisma } from '../utils/db.js';

const COURSE_TEMPLATE_EVENT = 'COURSE_TEMPLATE_ASSIGNED';
const CATEGORY_TEMPLATE_EVENT = 'CATEGORY_TEMPLATE_ASSIGNED';
const ORG_TEMPLATE_EVENT = 'ORG_CERT_TEMPLATE_ASSIGNED';

export class CertificateModel {
    static async findCertificateByUserAndCourse(userId, courseId) {
        if (!userId || !courseId) return null;
        return prisma.certificate.findFirst({
            where: { userId, courseId },
        });
    }

    static async findCertificateByUserAndCategory(userId, categoryId) {
        return prisma.certificate.findUnique({
            where: { userId_categoryId: { userId, categoryId } },
            include: {
                category: {
                    select: { id: true, name: true, slug: true, certificateTemplateId: true },
                },
            },
        });
    }

    static async findCertificateById(id) {
        return prisma.certificate.findUnique({
            where: { id },
            include: {
                category: {
                    select: { id: true, name: true, slug: true },
                },
            },
        });
    }

    static async findCertificatesByOrgId(orgId) {
        return prisma.certificate.findMany({
            where: { user: { orgId } },
            include: {
                user: true,
                course: true,
                category: true,
            },
        });
    }

    static async findCertificatesByCourseId(courseId) {
        return prisma.certificate.findMany({
            where: { courseId },
            include: {
                user: true,
                course: true,
                category: true,
            },
        });
    }

    static async findCertificatesByCategoryId(categoryId) {
        return prisma.certificate.findMany({
            where: { categoryId },
            include: {
                user: true,
                course: true,
                category: true,
            },
        });
    }

    static async findCertificatesByUserId(userId) {
        return prisma.certificate.findMany({
            where: { userId },
            include: {
                category: {
                    select: { id: true, name: true, slug: true },
                },
            },
            orderBy: { issuedAt: 'desc' },
        });
    }

    static async updateCertificate(id, data) {
        return prisma.certificate.update({
            where: { id },
            data,
            include: {
                category: {
                    select: { id: true, name: true, slug: true },
                },
            },
        });
    }

    static async createCertificate({
        userId,
        categoryId,
        courseId = null,
        templateId,
        pdfPath,
        issuedAt,
    }) {
        return prisma.certificate.create({
            data: {
                userId,
                categoryId,
                courseId: courseId || null,
                templateId,
                pdfPath,
                issuedAt: issuedAt || new Date(),
                verificationHash: crypto.randomUUID(),
            },
            include: {
                category: {
                    select: { id: true, name: true, slug: true },
                },
            },
        });
    }

    static async assignTemplateToCourse({ courseId, templateId, actorId }) {
        const course = await prisma.course.update({
            where: { id: courseId },
            data: { certificateTemplateId: templateId || null },
            select: {
                id: true,
                categoryId: true,
                category: { select: { id: true, certificateTemplateId: true } },
            },
        });

        if (
            course.categoryId
            && templateId
            && !course.category?.certificateTemplateId
        ) {
            await prisma.courseCategory.update({
                where: { id: course.categoryId },
                data: { certificateTemplateId: templateId },
            });

            await prisma.auditLog.create({
                data: {
                    eventType: CATEGORY_TEMPLATE_EVENT,
                    actorId,
                    targetType: 'COURSE_CATEGORY',
                    targetId: course.categoryId,
                    payload: {
                        categoryId: course.categoryId,
                        templateId,
                        seededFromCourseId: courseId,
                    },
                },
            });
        }

        const existing = await prisma.auditLog.findFirst({
            where: {
                eventType: COURSE_TEMPLATE_EVENT,
                targetType: 'COURSE',
                targetId: courseId,
            },
            orderBy: { createdAt: 'desc' },
        });

        const payload = { courseId, templateId: templateId || null };
        if (existing) {
            return prisma.auditLog.update({
                where: { id: existing.id },
                data: { actorId, payload },
            });
        }

        return prisma.auditLog.create({
            data: {
                eventType: COURSE_TEMPLATE_EVENT,
                actorId,
                targetType: 'COURSE',
                targetId: courseId,
                payload,
            },
        });
    }

    static async assignTemplateToCategory({ categoryId, templateId, actorId }) {
        await prisma.courseCategory.update({
            where: { id: categoryId },
            data: { certificateTemplateId: templateId || null },
        });

        return prisma.auditLog.create({
            data: {
                eventType: CATEGORY_TEMPLATE_EVENT,
                actorId,
                targetType: 'COURSE_CATEGORY',
                targetId: categoryId,
                payload: { categoryId, templateId: templateId || null },
            },
        });
    }

    static async getAssignedTemplateForCourse(courseId) {
        const course = await prisma.course.findUnique({
            where: { id: courseId },
            select: { certificateTemplateId: true },
        });

        return course?.certificateTemplateId || null;
    }

    static async getAssignedTemplateForCategory(categoryId) {
        const category = await prisma.courseCategory.findUnique({
            where: { id: categoryId },
            select: { certificateTemplateId: true },
        });

        return category?.certificateTemplateId || null;
    }

    static async assignTemplateToOrgHR({ orgId, hrManagerId, templateId, actorId }) {
        return prisma.auditLog.create({
            data: {
                eventType: ORG_TEMPLATE_EVENT,
                actorId,
                targetType: 'ORGANIZATION',
                targetId: orgId,
                payload: { orgId, hrManagerId, templateId },
            },
        });
    }

    static async getAssignedTemplateForHR(orgId, hrManagerId) {
        const logs = await prisma.auditLog.findMany({
            where: {
                eventType: ORG_TEMPLATE_EVENT,
                targetType: 'ORGANIZATION',
                targetId: orgId,
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });

        const match = logs.find((log) => {
            const payload = log?.payload;
            return payload && typeof payload === 'object' && payload.hrManagerId === hrManagerId;
        });
        if (!match?.payload || typeof match.payload !== 'object') return null;
        return match.payload?.templateId || null;
    }

    static async getAssignedTemplateForOrg(orgId) {
        const log = await prisma.auditLog.findFirst({
            where: {
                eventType: ORG_TEMPLATE_EVENT,
                targetType: 'ORGANIZATION',
                targetId: orgId,
            },
            orderBy: { createdAt: 'desc' },
        });

        if (!log?.payload || typeof log.payload !== 'object') return null;
        return log.payload?.templateId || null;
    }
}
