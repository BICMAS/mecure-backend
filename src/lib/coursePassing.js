import { prisma } from '../utils/db.js';
import { computeScorePercent } from '../utils/scormScore.js';

export const DEFAULT_PASSING_SCORE = 70;

export function resolvePassingScore(course) {
    if (course?.passingScore != null && Number.isFinite(Number(course.passingScore))) {
        return Math.min(100, Math.max(0, Number(course.passingScore)));
    }
    return DEFAULT_PASSING_SCORE;
}

export function resolveRequireQuizPass(course) {
    return course?.requireQuizPass !== false;
}

export function scoreFromAttemptFields(score, scormCloudScoreScaled) {
    return computeScorePercent(score, scormCloudScoreScaled);
}

/** Official pass requires 100% tracked content completion — not SCORM status flags alone. */
export function isFullContentComplete(completionPercentage) {
    return Math.min(100, Math.max(0, Number(completionPercentage) || 0)) >= 100;
}

export function logCompletionDecision(source, context, input, outcome) {
    console.log('[COMPLETION]', JSON.stringify({
        source,
        userId: context?.userId ?? null,
        courseId: context?.courseId ?? null,
        scormAttemptId: context?.scormAttemptId ?? null,
        completionPct: input?.completionPercentage ?? null,
        scorePct: input?.scorePercent ?? outcome?.scorePercent ?? null,
        scormStatus: input?.scormStatus ?? null,
        requireQuizPass: input?.requireQuizPass ?? null,
        decision: outcome?.passed ? 'ACCEPTED' : 'REJECTED',
        resultStatus: outcome?.status ?? null,
        requiresRetake: outcome?.requiresRetake ?? false,
    }));
}

export function evaluateScormOutcome({
    completionPercentage = 0,
    scorePercent = null,
    scormStatus = 'IN_PROGRESS',
    passingScore = DEFAULT_PASSING_SCORE,
    requireQuizPass = true,
}) {
    const completion = Math.min(100, Math.max(0, Number(completionPercentage) || 0));
    const cutoff = resolvePassingScore({ passingScore });
    const normalizedStatus = String(scormStatus || 'IN_PROGRESS').toUpperCase();
    const contentComplete = isFullContentComplete(completion);

    if (normalizedStatus === 'FAILED') {
        return {
            status: 'FAILED',
            passed: false,
            progress: completion,
            scorePercent,
            passingScore: cutoff,
            requiresRetake: true,
        };
    }

    if (!requireQuizPass) {
        if (contentComplete) {
            return {
                status: 'COMPLETED',
                passed: true,
                progress: 100,
                scorePercent,
                passingScore: cutoff,
                requiresRetake: false,
            };
        }

        return {
            status: completion > 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
            passed: false,
            progress: completion,
            scorePercent,
            passingScore: cutoff,
            requiresRetake: false,
        };
    }

    if (contentComplete) {
        if (scorePercent == null && normalizedStatus !== 'PASSED') {
            return {
                status: 'IN_PROGRESS',
                passed: false,
                progress: completion,
                scorePercent: null,
                passingScore: cutoff,
                requiresRetake: false,
            };
        }

        if (
            (scorePercent != null && scorePercent >= cutoff)
            || normalizedStatus === 'PASSED'
        ) {
            return {
                status: 'COMPLETED',
                passed: true,
                progress: 100,
                scorePercent,
                passingScore: cutoff,
                requiresRetake: false,
            };
        }

        return {
            status: 'FAILED',
            passed: false,
            progress: completion,
            scorePercent,
            passingScore: cutoff,
            requiresRetake: true,
        };
    }

    return {
        status: completion > 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
        passed: false,
        progress: completion,
        scorePercent,
        passingScore: cutoff,
        requiresRetake: false,
    };
}

export async function getCoursePassingConfigByScormPackageId(scormPackageId) {
    const lesson = await prisma.lesson.findFirst({
        where: { scormPackageId },
        select: {
            module: {
                select: {
                    courseId: true,
                    course: {
                        select: {
                            passingScore: true,
                            requireQuizPass: true,
                        },
                    },
                },
            },
        },
    });

    if (lesson?.module?.course) {
        return {
            courseId: lesson.module.courseId,
            passingScore: resolvePassingScore(lesson.module.course),
            requireQuizPass: resolveRequireQuizPass(lesson.module.course),
        };
    }

    const course = await prisma.course.findFirst({
        where: { scormPackageId },
        select: {
            id: true,
            passingScore: true,
            requireQuizPass: true,
        },
    });

    if (course) {
        return {
            courseId: course.id,
            passingScore: resolvePassingScore(course),
            requireQuizPass: resolveRequireQuizPass(course),
        };
    }

    return {
        courseId: null,
        passingScore: DEFAULT_PASSING_SCORE,
        requireQuizPass: true,
    };
}

export async function getCoursePassingConfigByCourseId(courseId) {
    const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: {
            id: true,
            passingScore: true,
            requireQuizPass: true,
        },
    });

    if (!course) {
        return {
            courseId: null,
            passingScore: DEFAULT_PASSING_SCORE,
            requireQuizPass: true,
        };
    }

    return {
        courseId: course.id,
        passingScore: resolvePassingScore(course),
        requireQuizPass: resolveRequireQuizPass(course),
    };
}

export function evaluateRollUpOutcome({
    avgCompletion,
    rolledUpScore,
    passingScore,
    requireQuizPass,
    allPackagesPassed = false,
}) {
    const completion = Math.min(100, Math.max(0, Number(avgCompletion) || 0));

    if (!allPackagesPassed) {
        const anyProgress = completion > 0;
        return {
            status: anyProgress ? 'IN_PROGRESS' : 'NOT_STARTED',
            passed: false,
            progress: completion,
            scorePercent: rolledUpScore,
            passingScore: resolvePassingScore({ passingScore }),
            requiresRetake: false,
        };
    }

    return evaluateScormOutcome({
        completionPercentage: 100,
        scorePercent: rolledUpScore,
        scormStatus: 'COMPLETED',
        passingScore,
        requireQuizPass,
    });
}
