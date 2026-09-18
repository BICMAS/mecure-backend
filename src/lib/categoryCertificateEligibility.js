import { prisma } from '../utils/db.js';
import { getAssignmentCompletionState } from './courseCompletion.js';
import {
    resolveCategoryIssuanceTemplateId,
    summarizeCategoryEligibility,
} from './categoryCertificate.js';

/**
 * Resolve template for a category without learner context.
 * Prefer category.certificateTemplateId; else any course in the category with a template.
 */
export async function resolveTemplateIdForCategory(categoryId) {
    const category = await prisma.courseCategory.findUnique({
        where: { id: categoryId },
        select: { id: true, certificateTemplateId: true },
    });
    if (!category) return null;

    if (category.certificateTemplateId) {
        return category.certificateTemplateId;
    }

    const courses = await prisma.course.findMany({
        where: {
            categoryId,
            certificateTemplateId: { not: null },
        },
        select: {
            id: true,
            title: true,
            certificateTemplateId: true,
        },
    });

    return resolveCategoryIssuanceTemplateId({
        categoryTemplateId: null,
        courseTemplates: courses.map((course) => ({
            courseId: course.id,
            title: course.title,
            templateId: course.certificateTemplateId,
        })),
    });
}

/**
 * Build completion rows for every course assigned to the learner in a category.
 */
export async function getAssignedCourseStatesForCategory(learnerId, categoryId) {
    const assignments = await prisma.assignment.findMany({
        where: {
            assigneeUserId: learnerId,
            course: { categoryId },
        },
        select: {
            courseId: true,
            course: {
                select: {
                    id: true,
                    title: true,
                    categoryId: true,
                    certificateTemplateId: true,
                    isLocked: true,
                },
            },
        },
        orderBy: { createdAt: 'asc' },
    });

    const states = [];
    for (const assignment of assignments) {
        const completionState = await getAssignmentCompletionState(
            learnerId,
            assignment.courseId,
        );
        states.push({
            courseId: assignment.courseId,
            categoryId: assignment.course?.categoryId ?? categoryId,
            title: assignment.course?.title ?? '',
            templateId: assignment.course?.certificateTemplateId ?? null,
            isLocked: Boolean(assignment.course?.isLocked),
            complete: Boolean(completionState.complete),
            passed: Boolean(completionState.passed),
            requiresRetake: Boolean(completionState.requiresRetake),
            passingScore: completionState.passingScore,
            scorePercent: completionState.scorePercent,
            status: completionState.status,
        });
    }

    return states;
}

export async function getCategoryCertificateEligibility(learnerId, categoryId) {
    const category = await prisma.courseCategory.findUnique({
        where: { id: categoryId },
        select: {
            id: true,
            name: true,
            slug: true,
            certificateTemplateId: true,
        },
    });

    if (!category) {
        throw new Error('Category not found');
    }

    const courseStates = await getAssignedCourseStatesForCategory(learnerId, categoryId);
    const summary = summarizeCategoryEligibility(courseStates, categoryId);
    const templateId = resolveCategoryIssuanceTemplateId({
        categoryTemplateId: category.certificateTemplateId,
        courseTemplates: courseStates.map((row) => ({
            courseId: row.courseId,
            title: row.title,
            templateId: row.templateId,
        })),
    }) ?? await resolveTemplateIdForCategory(categoryId);

    return {
        category,
        ...summary,
        templateId,
        courseStates,
    };
}

/**
 * Map of categoryId -> eligibility summary for a learner's assigned courses.
 */
export async function getCategoryCertificateStatusMap(learnerId) {
    const assignments = await prisma.assignment.findMany({
        where: { assigneeUserId: learnerId },
        select: {
            courseId: true,
            course: {
                select: {
                    id: true,
                    title: true,
                    categoryId: true,
                    certificateTemplateId: true,
                    category: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                            certificateTemplateId: true,
                        },
                    },
                },
            },
        },
    });

    const byCategory = new Map();
    for (const assignment of assignments) {
        const categoryId = assignment.course?.categoryId;
        if (!categoryId) continue;

        if (!byCategory.has(categoryId)) {
            byCategory.set(categoryId, {
                category: assignment.course.category,
                courseIds: [],
            });
        }
        byCategory.get(categoryId).courseIds.push(assignment.courseId);
    }

    const statusByCategoryId = {};

    for (const [categoryId, entry] of byCategory.entries()) {
        const eligibility = await getCategoryCertificateEligibility(learnerId, categoryId);
        const existing = await prisma.certificate.findUnique({
            where: {
                userId_categoryId: { userId: learnerId, categoryId },
            },
            select: { id: true, pdfPath: true, issuedAt: true },
        });

        statusByCategoryId[categoryId] = {
            categoryId,
            categoryName: entry.category?.name ?? eligibility.category.name,
            categorySlug: entry.category?.slug ?? eligibility.category.slug,
            assignedCount: eligibility.assignedCount,
            completedCount: eligibility.completedCount,
            eligible: eligibility.eligible,
            hasCertificate: Boolean(existing),
            certificateId: existing?.id ?? null,
            incompleteCourseIds: eligibility.incompleteCourseIds,
        };
    }

    return statusByCategoryId;
}
