import { prisma } from '../utils/db.js';
import { getCourseScormPackageIds } from './courseCompletion.js';

function sortModules(modules = []) {
    return [...modules].sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

function parsePacingStartDate(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error('Invalid pacing start date');
    }
    return parsed;
}

async function loadCourseForReset(courseId) {
    const course = await prisma.course.findUnique({
        where: { id: courseId },
        include: {
            modules: true,
        },
    });

    if (!course) {
        throw new Error('Course not found');
    }

    return course;
}

async function loadAssignedLearnerIds(courseId, requester) {
    const assignments = await prisma.assignment.findMany({
        where: {
            courseId,
            assigneeUserId: { not: null },
        },
        select: {
            assigneeUserId: true,
            assigneeUser: {
                select: {
                    id: true,
                    orgId: true,
                    fullName: true,
                },
            },
        },
    });

    const learnerIds = new Set();

    for (const assignment of assignments) {
        const learner = assignment.assigneeUser;
        if (!learner?.id) {
            continue;
        }

        if (requester.userRole === 'HR_MANAGER') {
            if (!requester.orgId) {
                throw new Error('HR must be in an organization');
            }
            if (learner.orgId !== requester.orgId) {
                continue;
            }
        }

        learnerIds.add(learner.id);
    }

    if (requester.userRole === 'HR_MANAGER' && learnerIds.size === 0) {
        const hasForeignAssignments = assignments.some(
            (assignment) =>
                assignment.assigneeUser?.orgId
                && assignment.assigneeUser.orgId !== requester.orgId,
        );
        if (hasForeignAssignments || assignments.length === 0) {
            throw new Error('No assigned learners in your organization for this course');
        }
    }

    return [...learnerIds];
}

async function countLearnerResetImpact({
    userId,
    courseId,
    packageIds,
    deleteCertificates,
    resetModuleProgress,
    moduleCount,
}) {
    const [certificate, scormAttempts] = await Promise.all([
        deleteCertificates
            ? prisma.certificate.findUnique({
                where: { userId_courseId: { userId, courseId } },
                select: { id: true },
            })
            : Promise.resolve(null),
        packageIds.length > 0
            ? prisma.scormAttempt.count({
                where: {
                    userId,
                    scormPackageId: { in: packageIds },
                },
            })
            : Promise.resolve(0),
    ]);

    return {
        certificatesDeleted: certificate ? 1 : 0,
        attemptsReset: 1,
        scormAttemptsDeleted: scormAttempts,
        moduleProgressReset: resetModuleProgress ? moduleCount : 0,
    };
}

async function resetLearnerProgress({
    userId,
    course,
    packageIds,
    deleteCertificates,
    resetModuleProgress,
    dryRun,
}) {
    const courseId = course.id;
    const sortedModules = sortModules(course.modules);

    if (dryRun) {
        return countLearnerResetImpact({
            userId,
            courseId,
            packageIds,
            deleteCertificates,
            resetModuleProgress,
            moduleCount: sortedModules.length,
        });
    }

    let certificatesDeleted = 0;
    let scormAttemptsDeleted = 0;
    let moduleProgressReset = 0;

    if (deleteCertificates) {
        const certificate = await prisma.certificate.findUnique({
            where: { userId_courseId: { userId, courseId } },
        });

        if (certificate) {
            await prisma.certificate.delete({
                where: { id: certificate.id },
            });
            certificatesDeleted = 1;
        }
    }

    await prisma.attempt.upsert({
        where: {
            userId_courseId: { userId, courseId },
        },
        update: {
            status: 'NOT_STARTED',
            completionPercentage: 0,
            score: null,
            scormCloudScoreScaled: null,
            scormCloudCompletion: null,
            scormCloudLastSyncAt: null,
            scormCloudRegistrationId: null,
            scormCloudDuration: null,
            learningHours: null,
            updatedAt: new Date(),
        },
        create: {
            userId,
            courseId,
            status: 'NOT_STARTED',
            completionPercentage: 0,
        },
    });

    if (packageIds.length > 0) {
        const deleted = await prisma.scormAttempt.deleteMany({
            where: {
                userId,
                scormPackageId: { in: packageIds },
            },
        });
        scormAttemptsDeleted = deleted.count;
    }

    if (resetModuleProgress) {
        const pacingEnabled = Boolean(course.modulePacingEnabled);
        const now = new Date();

        for (let index = 0; index < sortedModules.length; index += 1) {
            const module = sortedModules[index];
            const unlocked = pacingEnabled ? index === 0 : true;
            const progressData = {
                completionPercentage: 0,
                scorePercent: null,
                completedAt: null,
                status: unlocked ? 'UNLOCKED' : 'LOCKED',
                unlockedAt: unlocked ? now : null,
                scormActivityId: module.scormActivityId ?? null,
            };

            const existing = await prisma.learnerModuleProgress.findUnique({
                where: {
                    userId_moduleId: { userId, moduleId: module.id },
                },
            });

            if (existing) {
                await prisma.learnerModuleProgress.update({
                    where: { id: existing.id },
                    data: progressData,
                });
            } else if (sortedModules.length > 0) {
                await prisma.learnerModuleProgress.create({
                    data: {
                        userId,
                        courseId,
                        moduleId: module.id,
                        ...progressData,
                    },
                });
            }

            moduleProgressReset += 1;
        }
    }

    return {
        certificatesDeleted,
        attemptsReset: 1,
        scormAttemptsDeleted,
        moduleProgressReset,
    };
}

/**
 * Reset all assigned learners on a course to 0% after a SCORM reload/publish.
 * Run AFTER the updated SCORM package is published so the next launch uses fresh registrations.
 */
export async function resetCourseProgress({
    courseId,
    requester,
    deleteCertificates = true,
    resetModuleProgress = true,
    newPacingStartDate,
    dryRun = false,
}) {
    const course = await loadCourseForReset(courseId);
    const learnerIds = await loadAssignedLearnerIds(courseId, requester);
    const packageIds = await getCourseScormPackageIds(courseId);

    const summary = {
        courseId: course.id,
        courseTitle: course.title,
        dryRun: Boolean(dryRun),
        learnersProcessed: 0,
        certificatesDeleted: 0,
        attemptsReset: 0,
        scormAttemptsDeleted: 0,
        moduleProgressReset: 0,
        pacingStartDateUpdated: false,
        errors: [],
    };

    if (
        newPacingStartDate !== undefined
        && newPacingStartDate !== null
        && newPacingStartDate !== ''
        && !course.modulePacingEnabled
    ) {
        throw new Error('newPacingStartDate can only be set when module pacing is enabled');
    }

    const parsedPacingStartDate = newPacingStartDate !== undefined
        ? parsePacingStartDate(newPacingStartDate)
        : null;

    if (!dryRun && parsedPacingStartDate && course.modulePacingEnabled) {
        await prisma.course.update({
            where: { id: course.id },
            data: { pacingStartDate: parsedPacingStartDate },
        });
        course.pacingStartDate = parsedPacingStartDate;
        summary.pacingStartDateUpdated = true;
    } else if (dryRun && parsedPacingStartDate && course.modulePacingEnabled) {
        summary.pacingStartDateUpdated = true;
    }

    for (const userId of learnerIds) {
        try {
            const result = await resetLearnerProgress({
                userId,
                course,
                packageIds,
                deleteCertificates,
                resetModuleProgress,
                dryRun,
            });

            summary.learnersProcessed += 1;
            summary.certificatesDeleted += result.certificatesDeleted;
            summary.attemptsReset += result.attemptsReset;
            summary.scormAttemptsDeleted += result.scormAttemptsDeleted;
            summary.moduleProgressReset += result.moduleProgressReset;
        } catch (error) {
            summary.errors.push({
                userId,
                message: error instanceof Error ? error.message : 'Reset failed',
            });
        }
    }

    console.log('[COURSE RESET]', {
        courseId: summary.courseId,
        actorId: requester.id,
        dryRun: summary.dryRun,
        learnersProcessed: summary.learnersProcessed,
        certificatesDeleted: summary.certificatesDeleted,
        attemptsReset: summary.attemptsReset,
        scormAttemptsDeleted: summary.scormAttemptsDeleted,
        moduleProgressReset: summary.moduleProgressReset,
        pacingStartDateUpdated: summary.pacingStartDateUpdated,
        errorCount: summary.errors.length,
    });

    return summary;
}

export async function findCourseIdByTitle(title) {
    const course = await prisma.course.findFirst({
        where: {
            title: {
                equals: title,
                mode: 'insensitive',
            },
        },
        select: { id: true, title: true },
    });

    return course;
}
