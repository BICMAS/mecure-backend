import { prisma } from '../utils/db.js';
import { ScormCloudService } from '../services/ScormCloudService.js';
import { ScormPackageModel } from '../models/ScormPackageModel.js';
import { AttemptModel } from '../models/AttemptModel.js';
import { AssignmentModel } from '../models/AssignmentModel.js';
import { LearningPathEnrolmentModel } from '../models/LearningPathEnrolmentModel.js';
import { EconomyService } from './EconomyService.js';
import { normalizeScormRegistration, computeScorePercent } from '../utils/scormScore.js';
import {
    evaluateScormOutcome,
    evaluateRollUpOutcome,
    getCoursePassingConfigByScormPackageId,
    getCoursePassingConfigByCourseId,
    logCompletionDecision,
    scoreFromAttemptFields,
} from '../lib/coursePassing.js';
import { getCourseScormPackageIds, getAssignmentCompletionState, repairStaleCourseAttemptIfNeeded } from '../lib/courseCompletion.js';
import { syncLearnerModuleProgressFromRegistration } from '../lib/modulePacing.js';

function buildSyncResponse(scormAttempt, outcome) {
    return {
        ...scormAttempt,
        scorePercent: outcome.scorePercent,
        passingScore: outcome.passingScore,
        passed: outcome.passed,
        requiresRetake: outcome.requiresRetake,
    };
}

export class AttemptService {
    static async updateProgress(courseId, data, user) {
        if (user.userRole !== 'LEARNER') throw new Error('Only learners can update progress');
        if (data.completionPercentage < 0 || data.completionPercentage > 100) {
            throw new Error('Completion percentage must be 0-100');
        }

        const passingConfig = await getCoursePassingConfigByCourseId(courseId);
        const existing = await AttemptModel.findByUserAndCourse(user.id, courseId);
        const previousStatus = existing?.status ?? 'NOT_STARTED';

        const outcome = evaluateScormOutcome({
            completionPercentage: data.completionPercentage,
            scorePercent: scoreFromAttemptFields(
                existing?.score,
                existing?.scormCloudScoreScaled,
            ),
            scormStatus: data.status ?? existing?.status ?? 'IN_PROGRESS',
            passingScore: passingConfig.passingScore,
            requireQuizPass: passingConfig.requireQuizPass,
        });

        logCompletionDecision('updateProgress', {
            userId: user.id,
            courseId,
        }, {
            completionPercentage: data.completionPercentage,
            scorePercent: outcome.scorePercent,
            scormStatus: data.status ?? existing?.status,
            requireQuizPass: passingConfig.requireQuizPass,
        }, outcome);

        const safeData = {
            ...data,
            completionPercentage: outcome.passed ? 100 : Math.round(data.completionPercentage),
            status: outcome.passed
                ? outcome.status
                : data.completionPercentage > 0
                    ? 'IN_PROGRESS'
                    : 'NOT_STARTED',
        };

        const attempt = await AttemptModel.upsert(user.id, courseId, safeData);

        const enrolments = await LearningPathEnrolmentModel.findByUserAndCourse(user.id, courseId);
        for (const enrolment of enrolments) {
            await LearningPathEnrolmentModel.updateProgress(
                enrolment.id,
                safeData.completionPercentage,
            );
        }

        const newStatus = attempt.status ?? safeData.status ?? previousStatus;
        if (newStatus === 'COMPLETED' || newStatus === 'PASSED') {
            await EconomyService.onCourseCompleted(user.id, courseId, previousStatus, newStatus);
        }

        return attempt;
    }

    static async syncScormProgress(scormAttemptId, requester) {
        const scormAttempt = await prisma.scormAttempt.findUnique({
            where: { id: scormAttemptId },
            include: { scormPackage: true, attempt: true },
        });

        if (!scormAttempt) throw new Error('ScormAttempt not found');
        if (!scormAttempt.scormCloudRegistrationId) throw new Error('No SCORM Cloud registration');

        if (requester.userRole === 'LEARNER' && scormAttempt.userId !== requester.id) {
            throw new Error('Access denied');
        }

        if (requester.userRole === 'HR_MANAGER') {
            const owner = await prisma.user.findUnique({
                where: { id: scormAttempt.userId },
                select: { orgId: true },
            });
            if (!owner || owner.orgId !== requester.orgId) {
                throw new Error('Access denied');
            }
        }

        const registrationId = scormAttempt.scormCloudRegistrationId;
        const previousStatus = scormAttempt.status;
        const passingConfig = await getCoursePassingConfigByScormPackageId(scormAttempt.scormPackageId);

        const client = ScormCloudService.init();
        const res = await client.get(`/registrations/${registrationId}`);
        const registration = res.data;
        const normalized = normalizeScormRegistration(registration);

        const outcome = evaluateScormOutcome({
            completionPercentage: normalized.completionPercentage,
            scorePercent: normalized.scorePercent,
            scormStatus: normalized.status,
            passingScore: passingConfig.passingScore,
            requireQuizPass: passingConfig.requireQuizPass,
        });

        logCompletionDecision('syncScormProgress', {
            userId: scormAttempt.userId,
            courseId: passingConfig.courseId,
            scormAttemptId,
        }, {
            completionPercentage: normalized.completionPercentage,
            scorePercent: normalized.scorePercent,
            scormStatus: normalized.status,
            requireQuizPass: passingConfig.requireQuizPass,
        }, outcome);

        const persistedStatus = outcome.passed
            ? outcome.status
            : normalized.completionPercentage > 0
                ? 'IN_PROGRESS'
                : outcome.status;

        const updateData = {
            status: persistedStatus,
            completionPercentage: normalized.completionPercentage,
            score: normalized.scoreRaw,
            learningHours: normalized.learningHours,
            scormCloudLastSyncAt: new Date(),
            scormCloudCompletion: normalized.scormCloudCompletion,
            scormCloudScoreScaled: normalized.scoreScaled,
            updatedAt: new Date(),
        };

        const updated = await prisma.scormAttempt.update({
            where: { id: scormAttemptId },
            data: updateData,
            include: { scormPackage: true, attempt: true },
        });

        if (outcome.passed) {
            await EconomyService.onModuleCompleted(
                updated.userId,
                updated.scormPackageId,
                previousStatus,
                outcome.status,
            );
        }

        if (outcome.passed && normalized.scorePercent === 100) {
            await EconomyService.onPerfectQuiz(updated.userId, updated.scormPackageId);
        }

        if (updated.attemptId || passingConfig.courseId) {
            const linkedAttemptId = await AttemptService.ensureCourseAttemptLink(
                updated.userId,
                updated.scormPackageId,
                updated.attemptId,
            );
            await AttemptService.rollUpCourseCompletion(linkedAttemptId);

            if (passingConfig.courseId) {
                await syncLearnerModuleProgressFromRegistration({
                    userId: updated.userId,
                    courseId: passingConfig.courseId,
                    registrationId,
                    passingConfig,
                });
            }

            if (passingConfig.courseId) {
                await repairStaleCourseAttemptIfNeeded(updated.userId, passingConfig.courseId);
            }
        }

        return buildSyncResponse(updated, outcome);
    }

    static async retakeCourse(courseId, user) {
        if (user.userRole !== 'LEARNER') throw new Error('Only learners can retake courses');

        const assignment = await AssignmentModel.findByCourseAndLearner(courseId, user.id);
        if (!assignment) throw new Error('Course not assigned to learner');

        await repairStaleCourseAttemptIfNeeded(user.id, courseId);

        const completionState = await getAssignmentCompletionState(user.id, courseId);
        if (completionState.complete && completionState.passed) {
            throw new Error('Course already passed');
        }

        const packageIds = await getCourseScormPackageIds(courseId);
        if (!packageIds.length) {
            throw new Error('No SCORM content configured for this course');
        }

        await prisma.attempt.upsert({
            where: {
                userId_courseId: { userId: user.id, courseId },
            },
            update: {
                status: 'IN_PROGRESS',
                completionPercentage: 0,
                score: null,
                scormCloudScoreScaled: null,
                updatedAt: new Date(),
            },
            create: {
                userId: user.id,
                courseId,
                status: 'IN_PROGRESS',
                completionPercentage: 0,
            },
        });

        const launches = [];
        for (const packageId of packageIds) {
            const launch = await ScormPackageModel.getLaunchUrl(
                packageId,
                user.id,
                user.fullName || user.email || 'Learner',
                {
                    courseId,
                    forceNewRegistration: true,
                },
            );
            launches.push(launch);
        }

        const primary = launches[0];
        return {
            launchUrl: primary?.launchUrl,
            scormAttemptId: primary?.scormAttemptId,
            passingScore: completionState.passingScore,
            packageLaunches: launches,
        };
    }

    /**
     * Practice retake after a successful pass.
     * Fresh SCORM registration(s) only — does not reset official course attempt,
     * certificate, or HR completion status.
     *
     * If the course is not officially passed (e.g. stale UI opened ?practice=1),
     * falls back to a normal resume/retake launch so mobile clients without an
     * APK update can still enter the course.
     */
    static async practiceRetakeCourse(courseId, user) {
        if (user.userRole !== 'LEARNER') throw new Error('Only learners can retake courses');

        const assignment = await AssignmentModel.findByCourseAndLearner(courseId, user.id);
        if (!assignment) throw new Error('Course not assigned to learner');

        await repairStaleCourseAttemptIfNeeded(user.id, courseId);

        const completionState = await getAssignmentCompletionState(user.id, courseId);
        if (!(completionState.complete && completionState.passed)) {
            console.log('[PRACTICE RETAKE] Not officially passed — falling back to normal launch', {
                userId: user.id,
                courseId,
                status: completionState.status,
                requiresRetake: completionState.requiresRetake,
            });

            if (completionState.requiresRetake) {
                const retake = await AttemptService.retakeCourse(courseId, user);
                return {
                    ...retake,
                    practice: false,
                    fallback: 'retake',
                };
            }

            return AttemptService.launchCourseSession(courseId, user, {
                fallback: 'resume',
            });
        }

        const packageIds = await getCourseScormPackageIds(courseId);
        if (!packageIds.length) {
            throw new Error('No SCORM content configured for this course');
        }

        const launches = [];
        for (const packageId of packageIds) {
            const launch = await ScormPackageModel.getLaunchUrl(
                packageId,
                user.id,
                user.fullName || user.email || 'Learner',
                {
                    courseId,
                    forceNewRegistration: true,
                    preserveOfficialAttempt: true,
                },
            );
            launches.push(launch);
        }

        const primary = launches[0];
        return {
            launchUrl: primary?.launchUrl,
            scormAttemptId: primary?.scormAttemptId,
            passingScore: completionState.passingScore,
            packageLaunches: launches,
            practice: true,
        };
    }

    static async launchCourseSession(courseId, user, options = {}) {
        const assignment = await AssignmentModel.findByCourseAndLearner(courseId, user.id);
        if (!assignment) throw new Error('Course not assigned to learner');

        await repairStaleCourseAttemptIfNeeded(user.id, courseId);

        const completionState = await getAssignmentCompletionState(user.id, courseId);
        const packageIds = await getCourseScormPackageIds(courseId);
        if (!packageIds.length) {
            throw new Error('No SCORM content configured for this course');
        }

        const primaryPackageId = packageIds[0];
        const launch = await ScormPackageModel.getLaunchUrl(
            primaryPackageId,
            user.id,
            user.fullName || user.email || 'Learner',
            {
                courseId,
                forceNewRegistration: false,
            },
        );

        return {
            launchUrl: launch?.launchUrl,
            scormAttemptId: launch?.scormAttemptId,
            passingScore: completionState.passingScore,
            practice: false,
            fallback: options.fallback ?? null,
        };
    }

    static async ensureCourseAttemptLink(userId, scormPackageId, packageAttemptId) {
        const lesson = await prisma.lesson.findFirst({
            where: { scormPackageId },
            select: {
                module: {
                    select: { courseId: true },
                },
            },
        });

        const courseId = lesson?.module?.courseId
            ?? (await prisma.course.findFirst({
                where: { scormPackageId },
                select: { id: true },
            }))?.id;

        if (!courseId) return packageAttemptId;

        const courseAttempt = await prisma.attempt.upsert({
            where: {
                userId_courseId: { userId, courseId },
            },
            update: {
                scormPackageId,
                updatedAt: new Date(),
            },
            create: {
                userId,
                courseId,
                scormPackageId,
                status: 'IN_PROGRESS',
                completionPercentage: 0,
            },
            select: { id: true },
        });

        await prisma.scormAttempt.updateMany({
            where: { userId, scormPackageId },
            data: { attemptId: courseAttempt.id },
        });

        await AttemptService.rollUpCourseCompletion(courseAttempt.id);
        return courseAttempt.id;
    }

    static async rollUpCourseCompletion(courseAttemptId) {
        const courseAttempt = await prisma.attempt.findUnique({
            where: { id: courseAttemptId },
            include: { scormAttempts: true },
        });

        if (!courseAttempt?.courseId) return;

        const passingConfig = await getCoursePassingConfigByCourseId(courseAttempt.courseId);
        const previousStatus = courseAttempt.status;
        const packageIds = await getCourseScormPackageIds(courseAttempt.courseId);

        if (packageIds.length === 0) return;

        const packageAttempts = courseAttempt.scormAttempts.filter((item) =>
            packageIds.includes(item.scormPackageId),
        );

        const packageOutcomes = packageIds.map((packageId) => {
            const attempt = packageAttempts.find((item) => item.scormPackageId === packageId);
            if (!attempt) {
                return {
                    packageId,
                    passed: false,
                    progress: 0,
                    status: 'NOT_STARTED',
                };
            }

            const outcome = evaluateScormOutcome({
                completionPercentage: attempt.completionPercentage ?? 0,
                scorePercent: computeScorePercent(attempt.score, attempt.scormCloudScoreScaled),
                scormStatus: attempt.status,
                passingScore: passingConfig.passingScore,
                requireQuizPass: passingConfig.requireQuizPass,
            });

            return {
                packageId,
                passed: outcome.passed,
                progress: outcome.progress,
                status: outcome.status,
                scorePercent: outcome.scorePercent,
            };
        });

        const allPackagesPassed = packageOutcomes.every((item) => item.passed);
        const avgCompletion = packageOutcomes.length > 0
            ? packageOutcomes.reduce((sum, item) => sum + item.progress, 0) / packageOutcomes.length
            : 0;

        const scorePercents = packageOutcomes
            .map((item) => item.scorePercent)
            .filter((value) => value != null);
        const rolledUpScore = scorePercents.length > 0
            ? Math.round(scorePercents.reduce((sum, value) => sum + value, 0) / scorePercents.length)
            : null;

        const outcome = evaluateRollUpOutcome({
            avgCompletion,
            rolledUpScore,
            passingScore: passingConfig.passingScore,
            requireQuizPass: passingConfig.requireQuizPass,
            allPackagesPassed,
        });

        logCompletionDecision('rollUpCourseCompletion', {
            userId: courseAttempt.userId,
            courseId: courseAttempt.courseId,
        }, {
            completionPercentage: avgCompletion,
            scorePercent: rolledUpScore,
            scormStatus: outcome.status,
            requireQuizPass: passingConfig.requireQuizPass,
        }, outcome);

        const alreadyOfficiallyPassed =
            previousStatus === 'COMPLETED' || previousStatus === 'PASSED';

        // Practice SCORM sessions must not wipe official completion / canonical score.
        if (alreadyOfficiallyPassed && !outcome.passed) {
            return;
        }

        await prisma.attempt.update({
            where: { id: courseAttemptId },
            data: alreadyOfficiallyPassed
                ? {
                    updatedAt: new Date(),
                }
                : {
                    completionPercentage: outcome.progress,
                    status: outcome.status,
                    score: rolledUpScore,
                    updatedAt: new Date(),
                },
        });

        if (courseAttempt.courseId && outcome.passed && !alreadyOfficiallyPassed) {
            await EconomyService.onCourseCompleted(
                courseAttempt.userId,
                courseAttempt.courseId,
                previousStatus,
                outcome.status,
            );
        }
    }
}
