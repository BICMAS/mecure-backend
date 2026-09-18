import { prisma } from '../utils/db.js';
import {
    planLessonUpsert,
    planModuleUpsert,
    sortModulesForUpsert,
} from '../lib/courseModuleUpsert.js';

const categoryInclude = {
    category: {
        select: { id: true, name: true, slug: true, certificateTemplateId: true },
    },
};

const certificateTemplateInclude = {
    certificateTemplate: {
        select: { id: true, filename: true, description: true },
    },
};

const courseInclude = {
    modules: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
            lessons: {
                include: {
                    scormPackage: true,
                },
            },
        },
    },
    scormPackage: true,
    ...categoryInclude,
    ...certificateTemplateInclude,
};

function buildScalarUpdateData(data) {
    return {
        title: data.title,
        description: data.description || null,
        tags: data.tags || null,
        visibility: data.visibility || null,
        version: data.version || null,
        scormPackageId: data.scormPackageId ?? undefined,
        status: data.status || 'PUBLISHED',
        passingScore: data.passingScore ?? undefined,
        requireQuizPass: data.requireQuizPass ?? undefined,
        modulePacingEnabled: data.modulePacingEnabled ?? undefined,
        modulePacingDays: data.modulePacingDays ?? undefined,
        pacingStartDate: data.pacingStartDate ?? undefined,
        ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
        ...(data.certificateTemplateId !== undefined
            ? { certificateTemplateId: data.certificateTemplateId }
            : {}),
        ...(data.durationEstimate !== undefined
            ? { durationEstimate: data.durationEstimate }
            : {}),
        updatedAt: new Date(),
    };
}

async function upsertLessonsForModule(tx, moduleId, existingLessons, lessonsPayload = []) {
    const { updates, creates, deleteIds } = planLessonUpsert(existingLessons, lessonsPayload);

    for (const { existingId, data: lessonPayload } of updates) {
        await tx.lesson.update({
            where: { id: existingId },
            data: {
                title: lessonPayload.title,
                description: lessonPayload.description || null,
                scormPackageId: lessonPayload.scormPackageId ?? null,
            },
        });
    }

    for (const lessonPayload of creates) {
        await tx.lesson.create({
            data: {
                moduleId,
                title: lessonPayload.title,
                description: lessonPayload.description || null,
                scormPackageId: lessonPayload.scormPackageId ?? null,
            },
        });
    }

    if (deleteIds.length > 0) {
        await tx.lesson.deleteMany({
            where: { id: { in: deleteIds } },
        });
    }
}

async function upsertModulesForCourse(tx, courseId, modulesPayload) {
    const existingModules = await tx.module.findMany({
        where: { courseId },
        include: { lessons: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const sortedPayload = sortModulesForUpsert(modulesPayload);
    const { updates, creates, deleteIds } = planModuleUpsert(existingModules, sortedPayload);

    for (const { existingId, data: modulePayload } of updates) {
        const existingModule = existingModules.find((module) => module.id === existingId);
        await tx.module.update({
            where: { id: existingId },
            data: {
                name: modulePayload.name,
                sortOrder: modulePayload.sortOrder ?? 0,
                ...(modulePayload.scormActivityId !== undefined
                    ? { scormActivityId: modulePayload.scormActivityId }
                    : {}),
            },
        });
        await upsertLessonsForModule(
            tx,
            existingId,
            existingModule?.lessons ?? [],
            modulePayload.lessons ?? [],
        );
    }

    for (const modulePayload of creates) {
        const createdModule = await tx.module.create({
            data: {
                courseId,
                name: modulePayload.name,
                sortOrder: modulePayload.sortOrder ?? 0,
                scormActivityId: modulePayload.scormActivityId ?? null,
            },
        });
        await upsertLessonsForModule(tx, createdModule.id, [], modulePayload.lessons ?? []);
    }

    if (deleteIds.length > 0) {
        await tx.module.deleteMany({
            where: { id: { in: deleteIds } },
        });
    }
}

export class CourseModel {
    static async findMany() {
        return prisma.course.findMany({
            where: { status: 'PUBLISHED' },
            include: {
                modules: { include: { lessons: { include: { scormPackage: true } } } },
                ...categoryInclude,
                ...certificateTemplateInclude,
            }
        });
    }

    static async create(data) {
        return prisma.course.create({
            data,
            include: { modules: true, ...categoryInclude, ...certificateTemplateInclude }
        });
    }

    static async findManyByIds(ids) {
        if (!Array.isArray(ids) || ids.length === 0) return [];
        return prisma.course.findMany({
            where: { id: { in: ids } },
            select: { id: true, title: true, status: true }
        });
    }

    static async findById(id) {
        return prisma.course.findUnique({
            where: { id },
            include: {
                modules: {
                    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
                    include: {
                        lessons: {
                            include: {
                                scormPackage: true
                            }
                        }
                    }
                },
                scormPackage: true,
                ...categoryInclude,
                ...certificateTemplateInclude,
                creator: {
                    select: { id: true, fullName: true, email: true }
                }
            }
        });
    }

    static async delete(id) {
        console.log('[COURSE MODEL] Deleting ID:', id);
        return prisma.course.delete({
            where: { id }
        });
    }

    static async updateNested(id, data) {
        console.log('🔄 Updating course with modules (upsert)...');

        const scalarData = buildScalarUpdateData(data);

        if (!data.modules || !Array.isArray(data.modules)) {
            return prisma.course.update({
                where: { id },
                data: scalarData,
                include: courseInclude,
            });
        }

        if (data.modules.length === 0) {
            return prisma.$transaction(async (tx) => {
                await tx.module.deleteMany({ where: { courseId: id } });
                return tx.course.update({
                    where: { id },
                    data: scalarData,
                    include: courseInclude,
                });
            });
        }

        return prisma.$transaction(async (tx) => {
            const course = await tx.course.update({
                where: { id },
                data: scalarData,
            });

            await upsertModulesForCourse(tx, course.id, data.modules);

            return tx.course.findUnique({
                where: { id: course.id },
                include: courseInclude,
            });
        });
    }


    static async setCertificateTemplateId(id, certificateTemplateId) {
        return prisma.course.update({
            where: { id },
            data: { certificateTemplateId },
            include: courseInclude,
        });
    }

    static async findLockState(id) {
        if (!id) return null;
        return prisma.course.findUnique({
            where: { id },
            select: { id: true, isLocked: true, lockedAt: true, lockedBy: true },
        });
    }

    static async findLockStateByScormPackageId(packageId) {
        if (!packageId) return null;

        const byCoursePackage = await prisma.course.findFirst({
            where: { scormPackageId: packageId },
            select: { id: true, isLocked: true, lockedAt: true, lockedBy: true },
        });
        if (byCoursePackage) return byCoursePackage;

        const lesson = await prisma.lesson.findFirst({
            where: { scormPackageId: packageId },
            select: {
                module: {
                    select: {
                        course: {
                            select: { id: true, isLocked: true, lockedAt: true, lockedBy: true },
                        },
                    },
                },
            },
        });

        return lesson?.module?.course ?? null;
    }

    static async setLockState(id, { isLocked, lockedAt, lockedBy, actorId, eventType }) {
        const course = await prisma.course.update({
            where: { id },
            data: { isLocked, lockedAt, lockedBy },
            include: courseInclude,
        });

        await prisma.auditLog.create({
            data: {
                eventType,
                actorId,
                targetType: 'COURSE',
                targetId: id,
                payload: { courseId: id, isLocked },
            },
        });

        return course;
    }

    static async publish(id) {
        return prisma.course.update({
            where: { id },
            data: { status: 'PUBLISHED' },
            include: {
                modules: { include: { lessons: true } },
                ...categoryInclude,
                ...certificateTemplateInclude,
            }
        });
    }
}
