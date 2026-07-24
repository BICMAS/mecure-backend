import { prisma } from '../utils/db.js';
import { CertificateModel } from '../models/CertificateModel.js';
import {
    evaluateScormOutcome,
    getCoursePassingConfigByCourseId,
    scoreFromAttemptFields,
} from './coursePassing.js';

export async function getCourseScormPackageIds(courseId) {
    const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: {
            scormPackageId: true,
            modules: {
                select: {
                    lessons: {
                        select: { scormPackageId: true },
                    },
                },
            },
        },
    });

    if (!course) return [];

    const packageIds = new Set();
    if (course.scormPackageId) packageIds.add(course.scormPackageId);
    for (const module of course.modules) {
        for (const lesson of module.lessons) {
            if (lesson.scormPackageId) packageIds.add(lesson.scormPackageId);
        }
    }

    return [...packageIds];
}

function isOfficiallyCompleteStatus(status) {
    return status === 'COMPLETED' || status === 'PASSED';
}

/**
 * Strict package-level completion — no side effects.
 */
export async function computeStrictCompletionState(userId, courseId) {
    const passingConfig = await getCoursePassingConfigByCourseId(courseId);

    const courseAttempt = await prisma.attempt.findUnique({
        where: {
            userId_courseId: { userId, courseId },
        },
        select: {
            status: true,
            completionPercentage: true,
            score: true,
            scormCloudScoreScaled: true,
        },
    });

    if (courseAttempt?.status === 'FAILED') {
        return {
            complete: false,
            passed: false,
            progress: Math.round(courseAttempt.completionPercentage ?? 0),
            status: 'FAILED',
            requiresRetake: true,
            passingScore: passingConfig.passingScore,
            scorePercent: scoreFromAttemptFields(
                courseAttempt.score,
                courseAttempt.scormCloudScoreScaled,
            ),
        };
    }

    const packageIds = await getCourseScormPackageIds(courseId);
    if (packageIds.length === 0) {
        const progress = Math.round(courseAttempt?.completionPercentage ?? 0);
        const scorePercent = scoreFromAttemptFields(
            courseAttempt?.score,
            courseAttempt?.scormCloudScoreScaled,
        );
        const officiallyComplete = isOfficiallyCompleteStatus(courseAttempt?.status);

        if (officiallyComplete) {
            if (!passingConfig.requireQuizPass) {
                return {
                    complete: true,
                    passed: true,
                    progress: 100,
                    status: 'COMPLETED',
                    requiresRetake: false,
                    passingScore: passingConfig.passingScore,
                    scorePercent,
                };
            }

            if (scorePercent != null && scorePercent >= passingConfig.passingScore) {
                return {
                    complete: true,
                    passed: true,
                    progress: 100,
                    status: 'COMPLETED',
                    requiresRetake: false,
                    passingScore: passingConfig.passingScore,
                    scorePercent,
                };
            }
        }

        return {
            complete: false,
            passed: false,
            progress,
            status: courseAttempt?.status ?? 'NOT_STARTED',
            requiresRetake: false,
            passingScore: passingConfig.passingScore,
            scorePercent,
        };
    }

    const scormAttempts = await prisma.scormAttempt.findMany({
        where: {
            userId,
            scormPackageId: { in: packageIds },
        },
        select: {
            scormPackageId: true,
            completionPercentage: true,
            status: true,
            score: true,
            scormCloudScoreScaled: true,
        },
    });

    if (scormAttempts.length === 0) {
        const progress = Math.round(courseAttempt?.completionPercentage ?? 0);
        return {
            complete: false,
            passed: false,
            progress,
            status: courseAttempt?.status ?? 'NOT_STARTED',
            requiresRetake: false,
            passingScore: passingConfig.passingScore,
            scorePercent: null,
        };
    }

    const packageOutcomes = packageIds.map((packageId) => {
        const attempt = scormAttempts.find((item) => item.scormPackageId === packageId);
        if (!attempt) {
            return {
                passed: false,
                progress: 0,
                status: 'NOT_STARTED',
                scorePercent: null,
            };
        }

        const scorePercent = scoreFromAttemptFields(attempt.score, attempt.scormCloudScoreScaled);
        const outcome = evaluateScormOutcome({
            completionPercentage: attempt.completionPercentage ?? 0,
            scorePercent,
            scormStatus: attempt.status,
            passingScore: passingConfig.passingScore,
            requireQuizPass: passingConfig.requireQuizPass,
        });

        return {
            passed: outcome.passed,
            progress: outcome.progress,
            status: outcome.status,
            scorePercent: outcome.scorePercent,
        };
    });

    const progress = Math.round(
        packageOutcomes.reduce((sum, item) => sum + item.progress, 0) / packageOutcomes.length,
    );

    const anyFailed = packageOutcomes.some((item) => item.status === 'FAILED');

    if (anyFailed) {
        const failedScores = packageOutcomes
            .map((item) => item.scorePercent)
            .filter((value) => value != null);
        const scorePercent = failedScores.length > 0
            ? Math.round(failedScores.reduce((sum, value) => sum + value, 0) / failedScores.length)
            : scoreFromAttemptFields(
                courseAttempt?.score,
                courseAttempt?.scormCloudScoreScaled,
            );

        return {
            complete: false,
            passed: false,
            progress,
            status: 'FAILED',
            requiresRetake: true,
            passingScore: passingConfig.passingScore,
            scorePercent: scorePercent || null,
        };
    }

    const allPackagesPassed = packageOutcomes.every((item) => item.passed);

    const rolledScores = packageOutcomes
        .map((item) => item.scorePercent)
        .filter((value) => value != null);
    const rolledScore = rolledScores.length > 0
        ? Math.round(rolledScores.reduce((sum, value) => sum + value, 0) / rolledScores.length)
        : null;

    return {
        complete: allPackagesPassed,
        passed: allPackagesPassed,
        progress: allPackagesPassed ? 100 : progress,
        status: allPackagesPassed
            ? 'COMPLETED'
            : progress > 0
                ? 'IN_PROGRESS'
                : 'NOT_STARTED',
        requiresRetake: false,
        passingScore: passingConfig.passingScore,
        scorePercent: rolledScore || null,
    };
}

/**
 * Downgrade stale COMPLETED/PASSED attempts that fail strict SCORM validation.
 * Skips repair when a certificate exists (protects legitimate passes after practice).
 */
export async function repairStaleCourseAttemptIfNeeded(userId, courseId) {
    const courseAttempt = await prisma.attempt.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: {
            id: true,
            status: true,
            completionPercentage: true,
            score: true,
            scormCloudScoreScaled: true,
        },
    });

    if (!courseAttempt || !isOfficiallyCompleteStatus(courseAttempt.status)) {
        return false;
    }

    const validation = await computeStrictCompletionState(userId, courseId);
    if (validation.passed) {
        return false;
    }

    const certificate = await CertificateModel.findCertificateByUserAndCourse(userId, courseId);
    if (certificate) {
        console.warn('[COMPLETION REPAIR] Certificate exists but strict validation failed — manual review may be needed', {
            userId,
            courseId,
            attemptStatus: courseAttempt.status,
            validationStatus: validation.status,
            progress: validation.progress,
            certificateId: certificate.id,
        });
        return false;
    }

    const repairedStatus = validation.status === 'FAILED'
        ? 'FAILED'
        : validation.progress > 0
            ? 'IN_PROGRESS'
            : 'NOT_STARTED';

    await prisma.attempt.update({
        where: { id: courseAttempt.id },
        data: {
            status: repairedStatus,
            completionPercentage: validation.progress,
            score: validation.scorePercent ?? courseAttempt.score,
            updatedAt: new Date(),
        },
    });

    console.log('[COMPLETION REPAIR] Downgraded stale official completion', {
        userId,
        courseId,
        previousStatus: courseAttempt.status,
        newStatus: repairedStatus,
        progress: validation.progress,
    });

    return true;
}

export async function getAssignmentCompletionState(userId, courseId) {
    const courseAttempt = await prisma.attempt.findUnique({
        where: {
            userId_courseId: { userId, courseId },
        },
        select: {
            status: true,
            completionPercentage: true,
            score: true,
            scormCloudScoreScaled: true,
        },
    });

    const validation = await computeStrictCompletionState(userId, courseId);
    const certificate = await CertificateModel.findCertificateByUserAndCourse(userId, courseId);

    if (
        certificate
        && courseAttempt
        && isOfficiallyCompleteStatus(courseAttempt.status)
    ) {
        if (!validation.passed) {
            console.warn('[COMPLETION REPAIR] Preserving official pass because certificate exists', {
                userId,
                courseId,
                certificateId: certificate.id,
            });
        }

        return {
            complete: true,
            passed: true,
            progress: 100,
            status: 'COMPLETED',
            requiresRetake: false,
            passingScore: validation.passingScore,
            scorePercent:
                validation.scorePercent
                ?? scoreFromAttemptFields(
                    courseAttempt.score,
                    courseAttempt.scormCloudScoreScaled,
                ),
        };
    }

    await repairStaleCourseAttemptIfNeeded(userId, courseId);

    return validation;
}
