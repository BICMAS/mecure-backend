import { prisma } from '../utils/db.js';
import { BatchModel } from '../models/BatchModel.js';
import { assertBatchAssignable } from './BatchService.js';
import { computeScorePercent } from '../utils/scormScore.js';
import { buildActivityReport, parseActivityReportQuery, toActivityReportCsv } from '../lib/activityReport.js';

function filtersForResponse(filters) {
    return {
        batchId: filters.batchId,
        department: filters.department,
        from: filters.from ? filters.from.toISOString().slice(0, 10) : null,
        to: filters.to ? filters.to.toISOString().slice(0, 10) : null,
        breakdown: filters.breakdown,
    };
}

export class ActivityReportService {
    static async getReport(requester, query = {}) {
        if (!requester?.orgId) {
            throw new Error('HR must be in an organization');
        }
        if (requester.userRole !== 'HR_MANAGER' && requester.userRole !== 'SUPER_ADMIN') {
            throw new Error('Insufficient role to view the activity report');
        }

        const filters = parseActivityReportQuery(query);
        if (filters.batchId && filters.batchId.toLowerCase() !== 'unassigned') {
            const batch = await BatchModel.findById(filters.batchId);
            assertBatchAssignable(batch, requester.orgId);
        }

        const learners = await prisma.user.findMany({
            where: {
                orgId: requester.orgId,
                userRole: 'LEARNER',
                ...(filters.department ? { department: filters.department } : {}),
                ...(filters.batchId?.toLowerCase() === 'unassigned' ? { batchId: null } : {}),
                ...(filters.batchId && filters.batchId.toLowerCase() !== 'unassigned'
                    ? { batchId: filters.batchId }
                    : {}),
            },
            select: {
                id: true,
                fullName: true,
                email: true,
                department: true,
                points: true,
                batchId: true,
                batch: { select: { id: true, name: true } },
            },
            orderBy: { fullName: 'asc' },
        });

        const reportLearners = learners.map((learner) => ({
            id: learner.id,
            fullName: learner.fullName,
            email: learner.email,
            department: learner.department,
            points: learner.points,
            batchId: learner.batchId,
            batchName: learner.batch?.name ?? null,
        }));

        if (reportLearners.length === 0) {
            const report = buildActivityReport({ learners: [], filters });
            return { filters: filtersForResponse(filters), ...report };
        }

        const learnerIds = reportLearners.map((learner) => learner.id);
        const [
            assignments,
            attempts,
            moduleProgress,
            scormAttempts,
            certificates,
            quizAttempts,
            fieldTasks,
            coinAwards,
        ] = await Promise.all([
            prisma.assignment.findMany({
                where: { assigneeUserId: { in: learnerIds } },
                select: {
                    assigneeUserId: true,
                    courseId: true,
                    dueDate: true,
                    createdAt: true,
                    course: { select: { title: true } },
                },
            }),
            prisma.attempt.findMany({
                where: { userId: { in: learnerIds } },
                select: {
                    userId: true,
                    courseId: true,
                    status: true,
                    completionPercentage: true,
                    score: true,
                    scormCloudScoreScaled: true,
                    learningHours: true,
                    updatedAt: true,
                },
            }),
            prisma.learnerModuleProgress.findMany({
                where: { userId: { in: learnerIds } },
                select: { userId: true, status: true, updatedAt: true },
            }),
            prisma.scormAttempt.findMany({
                where: { userId: { in: learnerIds } },
                select: { userId: true, updatedAt: true },
            }),
            prisma.certificate.findMany({
                where: { userId: { in: learnerIds } },
                select: { userId: true, issuedAt: true },
            }),
            prisma.quizAttempt.findMany({
                where: { userId: { in: learnerIds } },
                select: { userId: true, createdAt: true },
            }),
            prisma.fieldTask.findMany({
                where: { createdBy: { in: learnerIds } },
                select: { createdBy: true, createdAt: true },
            }),
            prisma.coinAward.findMany({
                where: { userId: { in: learnerIds } },
                select: { userId: true, points: true, createdAt: true },
            }),
        ]);

        const report = buildActivityReport({
            learners: reportLearners,
            assignments: assignments.map((row) => ({
                userId: row.assigneeUserId,
                courseId: row.courseId,
                courseTitle: row.course?.title ?? null,
                dueDate: row.dueDate,
                createdAt: row.createdAt,
            })),
            attempts: attempts.map((row) => ({
                userId: row.userId,
                courseId: row.courseId,
                status: row.status,
                completionPercentage: row.completionPercentage,
                scorePercent: computeScorePercent(row.score, row.scormCloudScoreScaled),
                learningHours: row.learningHours,
                updatedAt: row.updatedAt,
            })),
            moduleProgress,
            scormAttempts,
            certificates,
            quizAttempts,
            fieldTasks: fieldTasks.map((row) => ({
                userId: row.createdBy,
                createdAt: row.createdAt,
            })),
            coinAwards,
            filters,
        });

        return { filters: filtersForResponse(filters), ...report };
    }

    static async getReportCsv(requester, query = {}) {
        const report = await ActivityReportService.getReport(requester, query);
        return toActivityReportCsv(report.trainees);
    }
}
