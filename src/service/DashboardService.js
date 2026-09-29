import { DashboardModel } from '../models/DashboardModel.js';
import { UserModel } from '../models/UserModel.js';
import { AttemptModel } from '../models/AttemptModel.js';
import { ScoreService } from './ScoreService.js';
import { prisma } from '../utils/db.js';
import { computeScorePercent } from '../utils/scormScore.js';
import {
    resolveAssignmentCourseImage,
    resolveCourseImageUrl,
} from '../lib/courseImage.js';
import { CourseService } from './CourseService.js';

function numericScore(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function activityQuizScore(scormAttempt) {
    const activities = scormAttempt?.activities || [];
    const passedScores = activities
        .filter((activity) => String(activity.success || '').toUpperCase() === 'PASSED')
        .map((activity) => numericScore(activity.scorePercent))
        .filter((value) => value != null);
    if (passedScores.length) return Math.round(Math.max(...passedScores));

    const scores = activities
        .map((activity) => numericScore(activity.scorePercent))
        .filter((value) => value != null);
    if (!scores.length) return null;
    return Math.round(Math.max(...scores));
}

function scormQuizScore(scormAttempt) {
    const fromFields = computeScorePercent(scormAttempt?.score, scormAttempt?.scormCloudScoreScaled);
    if (fromFields != null) return fromFields;

    const fromActivity = activityQuizScore(scormAttempt);
    if (fromActivity != null) return fromActivity;

    if (String(scormAttempt?.registrationSuccess || '').toUpperCase() === 'PASSED') {
        const passedActivity = activityQuizScore(scormAttempt);
        if (passedActivity != null) return passedActivity;
    }

    return null;
}

function courseQuizScore(attempt, linkedScorm) {
    const fromAttempt = computeScorePercent(attempt?.score, attempt?.scormCloudScoreScaled);
    if (fromAttempt != null) return fromAttempt;

    for (const scormAttempt of linkedScorm) {
        const score = scormQuizScore(scormAttempt);
        if (score != null) return score;
    }

    return null;
}

function packageCourseIds(scormAttempt) {
    const courses = scormAttempt?.scormPackage?.courses || [];
    return courses.map((course) => course?.id).filter(Boolean);
}

function scormPackageIdOf(scormAttempt) {
    return scormAttempt?.scormPackageId
        || scormAttempt?.scormPackage?.id
        || null;
}

function scormMatchesCourse(scormAttempt, courseId, attemptId, courseScormPackageId = null) {
    if (!courseId) return false;
    if (attemptId && scormAttempt.attemptId === attemptId) return true;
    if (scormAttempt.attempt?.courseId && scormAttempt.attempt.courseId === courseId) return true;

    const packageId = scormPackageIdOf(scormAttempt);
    if (courseScormPackageId && packageId && courseScormPackageId === packageId) return true;

    return packageCourseIds(scormAttempt).includes(courseId);
}

function registrationMoment(scormAttempt) {
    const lastAccess = scormAttempt?.lastAccessAt ? new Date(scormAttempt.lastAccessAt).getTime() : NaN;
    if (Number.isFinite(lastAccess)) return lastAccess;
    const updated = scormAttempt?.updatedAt ? new Date(scormAttempt.updatedAt).getTime() : NaN;
    return Number.isFinite(updated) ? updated : 0;
}

function latestScormRegistration(linked) {
    if (!linked?.length) return null;
    return [...linked].sort((a, b) => registrationMoment(b) - registrationMoment(a))[0];
}

function registrationStatus(scormAttempt) {
    const completion = String(scormAttempt?.registrationCompletion || '').trim();
    if (completion) return completion.toUpperCase();
    const status = String(scormAttempt?.status || '').trim();
    return status ? status.toUpperCase() : 'NOT_STARTED';
}

function registrationProgress(scormAttempt, status) {
    const percent = numericScore(scormAttempt?.completionPercentage);
    if (percent != null) return Math.min(100, Math.max(0, Math.round(percent)));

    const cloud = numericScore(scormAttempt?.scormCloudCompletion);
    if (cloud != null && cloud >= 0 && cloud <= 1) {
        return Math.min(100, Math.round(cloud * 100));
    }

    if (String(status).toUpperCase() === 'COMPLETED') return 100;
    return 0;
}

function registrationQuizResult(scormAttempt) {
    const success = String(scormAttempt?.registrationSuccess || '').trim();
    return success ? success.toUpperCase() : null;
}

function courseIdsForScorm(scormAttempt) {
    const ids = new Set();
    if (scormAttempt?.attempt?.courseId) ids.add(scormAttempt.attempt.courseId);
    for (const courseId of packageCourseIds(scormAttempt)) ids.add(courseId);
    return [...ids];
}

function coursePackageIdForRow(assignment, attempt) {
    return assignment?.course?.scormPackageId
        || attempt?.course?.scormPackageId
        || attempt?.scormPackageId
        || null;
}

export function buildCourseTrackingRows({ attempts = [], scormAttempts = [], assignments = [] } = {}) {
    const attemptByCourse = new Map();
    for (const attempt of attempts) {
        if (!attempt?.courseId || attemptByCourse.has(attempt.courseId)) continue;
        attemptByCourse.set(attempt.courseId, attempt);
    }

    const assignmentByCourse = new Map();
    for (const assignment of assignments) {
        if (!assignment?.courseId || assignmentByCourse.has(assignment.courseId)) continue;
        assignmentByCourse.set(assignment.courseId, assignment);
    }

    const courseIds = new Set([
        ...assignmentByCourse.keys(),
        ...attemptByCourse.keys(),
    ]);
    for (const scormAttempt of scormAttempts) {
        for (const courseId of courseIdsForScorm(scormAttempt)) {
            courseIds.add(courseId);
        }
    }

    const rows = [];
    for (const courseId of courseIds) {
        const attempt = attemptByCourse.get(courseId) || null;
        const assignment = assignmentByCourse.get(courseId) || null;
        const packageId = coursePackageIdForRow(assignment, attempt);
        const registration = latestScormRegistration(
            scormAttempts.filter((scormAttempt) =>
                scormMatchesCourse(scormAttempt, courseId, attempt?.id || null, packageId),
            ),
        );
        const dueDate = assignment?.dueDate || attempt?.dueDate || null;
        const matchedPackageCourse = (registration?.scormPackage?.courses || [])
            .find((course) => course?.id === courseId)
            || registration?.scormPackage?.courses?.[0]
            || null;
        const courseTitle = assignment?.course?.title
            || attempt?.course?.title
            || matchedPackageCourse?.title
            || registration?.attempt?.course?.title
            || null;
        const course = assignment?.course || attempt?.course || matchedPackageCourse || null;

        if (registration) {
            const status = registrationStatus(registration);
            const progress = registrationProgress(registration, status);
            rows.push({
                courseId,
                courseTitle,
                course,
                status,
                completionPercentage: progress,
                progressPercent: progress,
                score: scormQuizScore(registration),
                quizResult: registrationQuizResult(registration),
                learningHours: numericScore(registration.learningHours),
                passed: registrationQuizResult(registration) === 'PASSED',
                dueDate,
                syncedAt: registration.lastAccessAt || registration.updatedAt || null,
            });
            continue;
        }

        if (attempt) {
            const status = String(attempt.status || 'NOT_STARTED').toUpperCase();
            const progress = numericScore(attempt.completionPercentage) ?? 0;
            rows.push({
                courseId,
                courseTitle,
                course,
                status,
                completionPercentage: progress,
                progressPercent: progress,
                score: courseQuizScore(attempt, []),
                quizResult: null,
                learningHours: null,
                passed: status === 'COMPLETED' || status === 'PASSED',
                dueDate,
                syncedAt: attempt.updatedAt || null,
            });
            continue;
        }

        rows.push({
            courseId,
            courseTitle,
            course,
            status: 'NOT_STARTED',
            completionPercentage: 0,
            progressPercent: 0,
            score: null,
            quizResult: null,
            learningHours: null,
            passed: false,
            dueDate,
            syncedAt: null,
        });
    }

    return rows;
}

const SCORM_ATTEMPT_INCLUDE = {
    scormPackage: {
        select: {
            id: true,
            filename: true,
            courses: { select: { id: true, title: true, scormPackageId: true } },
        },
    },
    attempt: {
        select: {
            id: true,
            courseId: true,
            scormPackageId: true,
            course: { select: { id: true, title: true, scormPackageId: true } },
        },
    },
    activities: { select: { success: true, scorePercent: true } },
};

const ASSIGNMENT_COURSE_SELECT = {
    courseId: true,
    dueDate: true,
    course: { select: { id: true, title: true, scormPackageId: true } },
};

export class DashboardService {
    static async getHRDashboard(orgId) {
        console.log('[DASHBOARD SERVICE] Fetching for orgId:', orgId);
        const [totalLearners, openAssignments, overdueAssignments, completedAssignments, topPerformers, completionByDepartment, courseStatus, scoreLeaderboard, pointsLeaderboard] = await Promise.all([

            DashboardModel.getTotalLearners(orgId),
            DashboardModel.getOpenAssignments(orgId),
            DashboardModel.getOverdueAssignments(orgId),
            DashboardModel.getCompletedAssignments(orgId),
            DashboardModel.getTopPerformers(orgId),
            DashboardModel.getCompletionByDepartment(orgId),
            DashboardModel.getCourseStatus(orgId),
            ScoreService.getLeaderboard({ metric: 'score', orgId, limit: 5 }),
            ScoreService.getLeaderboard({ metric: 'points', orgId, limit: 5 }),
        ]);

        return {
            totalLearners,
            openAssignments,
            overdueAssignments,
            completedAssignments,
            topPerformers,
            scoreLeaderboard,
            pointsLeaderboard,
            completionByDepartment,
            courseStatus
        };
    }

    static async getSuperAdminDashboard() {
        console.log('[DASHBOARD SERVICE SUPER] Fetching global dashboard');
        const [
            activeLearners,
            completionRate,
            averageSession,
            systemLoad,
            recentActivities,
            learningActivityGraph,
            recentActivity,
        ] = await Promise.all([
            DashboardModel.getActiveLearners(),
            DashboardModel.getCompletionRate(),
            DashboardModel.getAverageSession(),
            DashboardModel.getSystemLoad(),
            DashboardModel.getRecentActivities(),
            DashboardModel.getLearningActivityGraph(),
            DashboardModel.getRecentActivity(),
        ]);

        return {
            activeLearners,
            completionRate: Math.round(completionRate * 100) / 100,
            averageSession,
            systemLoad,
            recentActivities,
            learningActivityGraph,
            recentActivity,
        };
    }


}

export class LearnerDashboardService {
    static async getLearnerDashboard(user) {
        console.log('[LEARNER DASHBOARD SERVICE] For user ID:', user.id);
        const [streak, points, learningHours, coursesDone, averageScore, learningPaths, learningActivity, currentCourse, unfinishedCourses] = await Promise.all([
            DashboardModel.getLearnerStreak(user.id),
            DashboardModel.getLearnerPoints(user.id),
            DashboardModel.getLearnerHours(user.id),
            DashboardModel.getCoursesDone(user.id),
            DashboardModel.getAverageScore(user.id),
            DashboardModel.getLearnerPaths(user.id),
            DashboardModel.getLearningActivity(user.id),
            DashboardModel.getCurrentCourse(user.id),
            DashboardModel.getUnfinishedCourses(user.id)
        ]);

        const resolvedUnfinishedCourses = await Promise.all(
            unfinishedCourses.map(resolveAssignmentCourseImage),
        );

        let resolvedCurrentCourse = currentCourse;
        if (currentCourse?.course) {
            resolvedCurrentCourse = {
                ...currentCourse,
                course: CourseService.formatCourse(await resolveCourseImageUrl(currentCourse.course)),
            };
        }

        return {
            streak,
            points,
            learningHours: Math.round(learningHours * 100) / 100,
            coursesDone,
            averageScore: Math.round(averageScore * 100) / 100,
            learningPaths,
            learningActivity,
            currentCourse: resolvedCurrentCourse,
            unfinishedCourses: resolvedUnfinishedCourses.map((assignment) => ({
                ...assignment,
                course: assignment.course
                    ? CourseService.formatCourse(assignment.course)
                    : assignment.course,
            })),
        };
    }
}

export class HRCourseTrackingService {
    static normalizeQueryFilters(query = {}) {
        const search = typeof query.search === 'string' ? query.search.trim() : '';
        const department = typeof query.department === 'string' ? query.department.trim() : '';
        const status = typeof query.status === 'string' ? query.status.trim().toUpperCase() : '';
        const sortBy = typeof query.sortBy === 'string' ? query.sortBy.trim() : 'name';
        const sortOrder = typeof query.sortOrder === 'string' ? query.sortOrder.trim().toLowerCase() : 'asc';
        const parsedLimit = parseInt(query.limit, 10);
        // No limit / invalid limit → return all learners. Frontend paginates course rows.
        const limit = Number.isFinite(parsedLimit)
            ? Math.min(Math.max(parsedLimit, 1), 5000)
            : null;
        const offset = Math.max(parseInt(query.offset, 10) || 0, 0);

        return { search, department, status, sortBy, sortOrder, limit, offset };
    }

    static getProgressStatus({ attempts = [], stats = {} }) {
        if (!attempts.length) return 'NOT_STARTED';
        if ((stats.overdueCourses || 0) > 0) return 'OVERDUE';
        if ((stats.inProgressCourses || 0) > 0) return 'IN_PROGRESS';
        if ((stats.completedCourses || 0) > 0) return 'COMPLETED';
        return 'NOT_STARTED';
    }

    static matchesStatusFilter(item, statusFilter) {
        if (!statusFilter || statusFilter === 'ALL') return true;

        // Support filtering by user account status.
        if (['ACTIVE', 'INACTIVE', 'BLOCKED', 'DEACTIVATED'].includes(statusFilter)) {
            return item.learner?.status === statusFilter;
        }

        // Support filtering by learning progress status.
        const progressStatus = HRCourseTrackingService.getProgressStatus(item);
        return progressStatus === statusFilter;
    }

    static sortTrackingItems(items = [], sortBy = 'name', sortOrder = 'asc') {
        const direction = sortOrder === 'desc' ? -1 : 1;
        const normalizedSortBy = ['lastActiveAt', 'avgCompletion', 'name'].includes(sortBy) ? sortBy : 'name';

        return [...items].sort((a, b) => {
            if (normalizedSortBy === 'avgCompletion') {
                const av = Number(a?.stats?.avgCompletion || 0);
                const bv = Number(b?.stats?.avgCompletion || 0);
                return (av - bv) * direction;
            }

            if (normalizedSortBy === 'lastActiveAt') {
                const av = a?.stats?.lastActiveAt ? new Date(a.stats.lastActiveAt).getTime() : 0;
                const bv = b?.stats?.lastActiveAt ? new Date(b.stats.lastActiveAt).getTime() : 0;
                return (av - bv) * direction;
            }

            const an = String(a?.learner?.fullName || '').toLowerCase();
            const bn = String(b?.learner?.fullName || '').toLowerCase();
            if (an < bn) return -1 * direction;
            if (an > bn) return 1 * direction;
            return 0;
        });
    }

    static buildLearnerStats(attempts = [], unfinishedCourses = []) {
        const assignedCourses = unfinishedCourses.length;
        const completedAttempts = attempts.filter((a) => a.status === 'COMPLETED');
        const inProgressAttempts = attempts.filter((a) => a.status === 'IN_PROGRESS');
        const overdueAttempts = attempts.filter((a) => a.dueDate && a.dueDate < new Date() && a.status !== 'COMPLETED');

        const uniqueCompletedCourses = new Set(
            completedAttempts
                .map((a) => a.courseId)
                .filter(Boolean)
        ).size;

        const avgCompletionRaw = attempts.length > 0
            ? attempts.reduce((sum, a) => sum + (a.completionPercentage || 0), 0) / attempts.length
            : 0;

        const latestActivityDate = attempts.reduce((latest, attempt) => {
            const updatedAt = attempt?.updatedAt ? new Date(attempt.updatedAt) : null;
            if (!updatedAt) return latest;
            if (!latest) return updatedAt;
            return updatedAt > latest ? updatedAt : latest;
        }, null);

        return {
            assignedCourses,
            completedCourses: uniqueCompletedCourses,
            inProgressCourses: inProgressAttempts.length,
            overdueCourses: overdueAttempts.length,
            avgCompletion: Math.round(avgCompletionRaw * 100) / 100,
            lastActiveAt: latestActivityDate ? latestActivityDate.toISOString() : null
        };
    }

    static async getLearnerCourseTracking({ orgId }, learnerId) {
        if (!orgId) throw new Error('HR must be in an organization');
        if (!learnerId) throw new Error('Learner ID required');

        const learner = await UserModel.findById(learnerId);
        if (!learner) throw new Error('Learner not found');
        if (learner.orgId !== orgId) throw new Error('Access denied');

        // AttemptModel is course-level progress (one attempt per userId+courseId via upsert)
        const attempts = await AttemptModel.findByUserId(learnerId);
        const scormAttempts = await prisma.scormAttempt.findMany({
            where: { userId: learnerId },
            include: SCORM_ATTEMPT_INCLUDE,
            orderBy: { updatedAt: 'desc' },
        });
        const assignments = await prisma.assignment.findMany({
            where: { assigneeUserId: learnerId },
            select: ASSIGNMENT_COURSE_SELECT,
        });

        const currentCourse = await DashboardModel.getCurrentCourse(learnerId);
        const unfinishedCourses = await DashboardModel.getUnfinishedCourses(learnerId);
        const stats = HRCourseTrackingService.buildLearnerStats(attempts, unfinishedCourses);
        const courseMap = new Map();
        const progress = buildCourseTrackingRows({
            attempts,
            scormAttempts,
            assignments,
        }).map((row) => {
            if (row.course?.id && !courseMap.has(row.course.id)) {
                courseMap.set(row.course.id, row.course);
            }
            const { course, ...progressRow } = row;
            return {
                learnerId: learner.id,
                learnerName: learner.fullName,
                learnerEmail: learner.email,
                learnerDepartment: learner.department || 'UNASSIGNED',
                ...progressRow,
            };
        });

        return {
            learner: {
                id: learner.id,
                fullName: learner.fullName,
                email: learner.email,
                userRole: learner.userRole,
                status: learner.status,
                orgId: learner.orgId,
                department: learner.department || 'UNASSIGNED',
            },
            attempts,
            scormAttempts,
            assignments,
            currentCourse,
            unfinishedCourses,
            stats,
            users: [learner],
            courses: Array.from(courseMap.values()),
            progress,
        };
    }

    static async getAllLearnersCourseTracking({ orgId }, query = {}) {
        if (!orgId) throw new Error('HR must be in an organization');
        const { search, department, status, sortBy, sortOrder, limit, offset } = HRCourseTrackingService.normalizeQueryFilters(query);

        const learners = await UserModel.findLearnersByOrgId(orgId);
        if (!learners || learners.length === 0) {
            return {
                learners: [],
                count: 0,
                users: [],
                courses: [],
                progress: [],
                meta: { total: 0, limit, offset, pageCount: 0, filters: { search, department, status, sortBy, sortOrder } }
            };
        }

        const tracking = await Promise.all(
            learners.map(async (learner) => {
                const attempts = await AttemptModel.findByUserId(learner.id);
                const scormAttempts = await prisma.scormAttempt.findMany({
                    where: { userId: learner.id },
                    include: SCORM_ATTEMPT_INCLUDE,
                    orderBy: { updatedAt: 'desc' },
                });
                const assignments = await prisma.assignment.findMany({
                    where: { assigneeUserId: learner.id },
                    select: ASSIGNMENT_COURSE_SELECT,
                });
                const currentCourse = await DashboardModel.getCurrentCourse(learner.id);
                const unfinishedCourses = await DashboardModel.getUnfinishedCourses(learner.id);
                const stats = HRCourseTrackingService.buildLearnerStats(attempts, unfinishedCourses);
                const progressStatus = HRCourseTrackingService.getProgressStatus({ attempts, stats });

                return {
                    learner,
                    attempts,
                    scormAttempts,
                    assignments,
                    currentCourse,
                    unfinishedCourses,
                    stats,
                    progressStatus
                };
            })
        );
        const filtered = tracking
            .filter((item) => {
                if (!department || department.toUpperCase() === 'ALL') return true;
                return String(item.learner.department || 'UNASSIGNED').toUpperCase() === department.toUpperCase();
            })
            .filter((item) => {
                if (!search) return true;
                const needle = search.toLowerCase();
                return item.learner.fullName?.toLowerCase().includes(needle) || item.learner.email?.toLowerCase().includes(needle);
            })
            .filter((item) => HRCourseTrackingService.matchesStatusFilter(item, status));

        const sorted = HRCourseTrackingService.sortTrackingItems(filtered, sortBy, sortOrder);
        const total = sorted.length;
        const paginated = limit == null
            ? sorted
            : sorted.slice(offset, offset + limit);

        const users = paginated.map((item) => item.learner);
        const courseMap = new Map();
        const progress = [];

        paginated.forEach((item) => {
            const pushProgressRow = (row) => {
                progress.push({
                    learnerId: item.learner.id,
                    learnerName: item.learner.fullName,
                    learnerEmail: item.learner.email,
                    learnerDepartment: item.learner.department || 'UNASSIGNED',
                    ...row,
                });
            };

            const rows = buildCourseTrackingRows({
                attempts: item.attempts || [],
                scormAttempts: item.scormAttempts || [],
                assignments: item.assignments || [],
            });
            rows.forEach((row) => {
                if (row.course?.id && !courseMap.has(row.course.id)) {
                    courseMap.set(row.course.id, row.course);
                }
                const { course, ...progressRow } = row;
                pushProgressRow(progressRow);
            });
        });

        return {
            learners: paginated,
            count: paginated.length,
            users,
            courses: Array.from(courseMap.values()),
            progress,
            meta: {
                total,
                limit,
                offset,
                pageCount: limit == null ? 1 : Math.ceil(total / limit),
                filters: { search, department, status, sortBy, sortOrder }
            }
        };
    }
}