/**
 * HR activity report checks.
 * Run: node scripts/test-activity-report.js
 */
import assert from 'node:assert/strict';
import { prisma, disconnectPrisma } from '../src/utils/db.js';
import { ActivityReportService } from '../src/service/ActivityReportService.js';
import { buildActivityReport, toActivityReportCsv } from '../src/lib/activityReport.js';

function testBuilderAndCsv() {
    const filters = {
        batchId: 'batch-a',
        department: null,
        from: new Date('2026-01-01T00:00:00.000Z'),
        to: new Date('2026-01-31T23:59:59.999Z'),
        breakdown: 'department',
    };
    const report = buildActivityReport({
        learners: [
            { id: 'a', fullName: 'Ada', email: 'ada@example.com', department: 'SALES', points: 12, batchName: 'Batch A' },
            { id: 'b', fullName: 'Bola', email: 'bola@example.com', department: 'SALES', points: 4, batchName: 'Batch B' },
        ],
        assignments: [
            { userId: 'a', courseId: 'course-1', courseTitle: 'Planning', dueDate: new Date('2026-01-10T00:00:00.000Z'), createdAt: new Date('2026-01-02T00:00:00.000Z') },
            { userId: 'b', courseId: 'course-1', courseTitle: 'Planning', dueDate: new Date('2026-01-10T00:00:00.000Z'), createdAt: new Date('2026-01-02T00:00:00.000Z') },
        ],
        attempts: [
            { userId: 'a', courseId: 'course-1', status: 'IN_PROGRESS', completionPercentage: 40, scorePercent: 80, learningHours: 1.5, updatedAt: new Date('2026-01-05T00:00:00.000Z') },
        ],
        moduleProgress: [
            { userId: 'a', status: 'COMPLETED', updatedAt: new Date('2026-01-05T00:00:00.000Z') },
            { userId: 'a', status: 'LOCKED', updatedAt: new Date('2025-12-01T00:00:00.000Z') },
        ],
        scormAttempts: [
            { userId: 'a', updatedAt: new Date('2026-01-06T00:00:00.000Z') },
            { userId: 'b', updatedAt: new Date('2026-01-06T00:00:00.000Z') },
        ],
        certificates: [
            { userId: 'a', issuedAt: new Date('2026-01-07T00:00:00.000Z') },
        ],
        quizAttempts: [
            { userId: 'a', createdAt: new Date('2026-01-08T00:00:00.000Z') },
        ],
        fieldTasks: [
            { userId: 'a', createdAt: new Date('2026-01-09T00:00:00.000Z') },
        ],
        coinAwards: [
            { userId: 'a', points: 5, createdAt: new Date('2026-01-04T00:00:00.000Z') },
            { userId: 'a', points: 9, createdAt: new Date('2025-12-01T00:00:00.000Z') },
        ],
        filters,
        now: new Date('2026-02-01T00:00:00.000Z'),
    });

    const ada = report.trainees.find((row) => row.id === 'a');
    assert.equal(ada.assignedCourses, 1);
    assert.equal(ada.averageProgress, 40);
    assert.equal(ada.averageScore, 80);
    assert.equal(ada.learningHours, 1.5);
    assert.equal(ada.overdueCourses, 1);
    assert.equal(ada.moduleProgress, '1/1');
    assert.equal(ada.scormAttempts, 1);
    assert.equal(ada.certificates, 1);
    assert.equal(ada.quizAttempts, 1);
    assert.equal(ada.fieldTasks, 1);
    assert.equal(ada.points, 12);
    assert.equal(ada.pointsAwarded, 5);
    assert.equal(ada.courses, 'Planning (40%)');

    const csv = toActivityReportCsv(report.trainees);
    const lines = csv.trim().split('\n');
    assert.equal(lines.length, report.trainees.length + 1);
    assert.match(lines[0], /Trainee,Email,Batch,Department,Assigned courses/);
    assert.match(csv, /Ada,ada@example.com,Batch A,SALES,1,40,80,1.5,1,1\/1,1,1,1,1,12,5,Planning \(40%\)/);
    assert.match(csv, /Bola/);

    assert.equal(report.analytics.summary.learners, 2);
    assert.equal(report.analytics.summary.learningHours, 1.5);
    assert.equal(report.analytics.summary.comparison.learningHours, 1.5);
    assert.deepEqual(report.analytics.funnel, { assigned: 2, started: 1, completed: 0, passed: 0 });
    assert.deepEqual(report.analytics.courses.map((row) => row.title), ['Planning']);
    assert.deepEqual(report.analytics.atRisk.map((row) => row.fullName), ['Ada', 'Bola']);
    assert.equal(report.analytics.atRisk[0].reason, 'Overdue courses');
    assert.equal(report.analytics.summary.completionRate, 0);
    assert.deepEqual(report.analytics.scorm.scoreBands, { under50: 0, from50to79: 0, from80: 1 });
    assert.equal(report.analytics.scorm.interactions.rows.length, 0);
    assert.equal(report.analytics.funnel.completed, 0);

    const batchOnly = buildActivityReport({
        learners: [
            { id: 'a', fullName: 'Ada', email: 'ada@example.com', department: 'SALES', points: 12, batchName: 'Batch A' },
        ],
        assignments: [
            { userId: 'a', courseId: 'course-1', courseTitle: 'Planning', dueDate: new Date('2026-01-10T00:00:00.000Z'), createdAt: new Date('2026-01-02T00:00:00.000Z') },
        ],
        attempts: [
            { userId: 'a', courseId: 'course-1', status: 'IN_PROGRESS', completionPercentage: 40, scorePercent: 80, learningHours: 1.5, updatedAt: new Date('2026-01-05T00:00:00.000Z') },
        ],
        scormRegistrations: [
            {
                id: 'reg-a',
                userId: 'a',
                courseTitle: 'Planning',
                completion: 'INCOMPLETE',
                success: null,
                scorePercent: 80,
                learningHours: 1.5,
                firstAccessAt: new Date('2026-01-02T00:00:00.000Z'),
                lastAccessAt: new Date('2026-01-05T00:00:00.000Z'),
                updatedAt: new Date('2026-01-05T00:00:00.000Z'),
                activities: [{ activityId: 'sco-1', title: 'Intro', completion: 'INCOMPLETE', success: null, scorePercent: 80, timeTrackedSeconds: 5400 }],
                interactions: [],
                objectives: [],
                comments: [],
                launches: [{ launchedAt: new Date('2026-01-05T00:00:00.000Z'), durationSeconds: 600 }],
            },
            {
                id: 'reg-b',
                userId: 'b',
                courseTitle: 'Planning',
                completion: 'UNKNOWN',
                success: null,
                scorePercent: null,
                learningHours: null,
                firstAccessAt: null,
                lastAccessAt: new Date('2026-01-06T00:00:00.000Z'),
                updatedAt: new Date('2026-01-06T00:00:00.000Z'),
                activities: [{ activityId: 'sco-b', title: 'Other batch', completion: 'INCOMPLETE', success: null, scorePercent: null, timeTrackedSeconds: 10 }],
                interactions: [{ interactionId: 'q-b', description: 'Other question', result: 'incorrect', weighting: 1, activityId: 'sco-b' }],
                objectives: [],
                comments: [],
                launches: [{ launchedAt: new Date('2026-01-06T00:00:00.000Z'), durationSeconds: 30 }],
            },
        ],
        filters,
        now: new Date('2026-02-01T00:00:00.000Z'),
    });
    assert.deepEqual(batchOnly.analytics.atRisk.map((row) => row.fullName), ['Ada']);
    assert.deepEqual(batchOnly.analytics.scorm.registrations.map((row) => row.fullName), ['Ada']);
    assert.deepEqual(batchOnly.analytics.scorm.activities.map((row) => row.title), ['Intro']);
    assert.equal(batchOnly.analytics.scorm.interactions.rows.length, 0);
    assert.equal(batchOnly.analytics.scorm.launches.count, 1);
    assert.deepEqual(batchOnly.analytics.scorm.scoreBands, { under50: 0, from50to79: 0, from80: 1 });
    assert.equal(batchOnly.analytics.summary.completionRate, 0);
    assert.equal(batchOnly.analytics.funnel.assigned, 1);
    assert.equal(batchOnly.analytics.summary.learners, 1);
    assert.equal(batchOnly.analytics.funnel.assigned, 1);
    assert.equal(batchOnly.trainees.some((row) => row.fullName === 'Bola'), false);

    const openEnded = buildActivityReport({
        learners: [
            { id: 'a', fullName: 'Ada', email: 'ada@example.com', department: 'SALES', points: 12, batchName: 'Batch A' },
        ],
        filters: { ...filters, from: null, to: null },
        now: new Date('2026-02-01T00:00:00.000Z'),
    });
    assert.equal(openEnded.analytics.summary.comparison, null);

    const empty = buildActivityReport({ learners: [], filters, now: new Date('2026-02-01T00:00:00.000Z') });
    assert.equal(empty.message, 'No trainees match these filters.');
    assert.equal(empty.trainees.length, 0);
    assert.equal(empty.analytics.atRisk.length, 0);
}

async function testOrgScope() {
    const hr = await prisma.user.findFirst({
        where: { userRole: 'HR_MANAGER', orgId: { not: null } },
        select: { id: true, orgId: true, userRole: true },
    });
    assert.ok(hr, 'an HR manager with an organization is required');

    const stamp = Date.now();
    const createdUserIds = [];
    let courseId = null;
    let batchAId = null;
    let batchBId = null;
    let otherOrgId = null;
    let otherBatchId = null;

    try {
        const course = await prisma.course.create({
            data: { title: `Activity report ${stamp}`, status: 'PUBLISHED', createdBy: hr.id },
        });
        courseId = course.id;

        const batchA = await prisma.batch.create({ data: { orgId: hr.orgId, name: `Report A ${stamp}` } });
        const batchB = await prisma.batch.create({ data: { orgId: hr.orgId, name: `Report B ${stamp}` } });
        batchAId = batchA.id;
        batchBId = batchB.id;

        const otherOrg = await prisma.organization.create({
            data: { name: `Report other org ${stamp}`, createdBy: hr.id },
        });
        otherOrgId = otherOrg.id;
        const otherBatch = await prisma.batch.create({
            data: { orgId: otherOrg.id, name: `Report Other ${stamp}` },
        });
        otherBatchId = otherBatch.id;

        const makeLearner = async (name, phone, extra) => {
            const user = await prisma.user.create({
                data: {
                    fullName: name,
                    password: 'test-only',
                    userRole: 'LEARNER',
                    department: 'SALES',
                    phoneNumber: phone,
                    ...extra,
                },
            });
            createdUserIds.push(user.id);
            return user;
        };

        const learnerA = await makeLearner('Activity Report A', `+23491${String(stamp).slice(-8)}`, {
            orgId: hr.orgId,
            batchId: batchA.id,
            department: 'SALES',
            points: 15,
        });
        const learnerB = await makeLearner('Activity Report B', `+23492${String(stamp).slice(-8)}`, {
            orgId: hr.orgId,
            batchId: batchB.id,
            department: 'MARKETING',
        });
        const learnerNone = await makeLearner('Activity Report None', `+23493${String(stamp).slice(-8)}`, {
            orgId: hr.orgId,
            department: 'SALES',
        });
        const learnerOther = await makeLearner('Activity Report Other', `+23494${String(stamp).slice(-8)}`, {
            orgId: otherOrg.id,
            batchId: otherBatch.id,
        });

        const dueDate = new Date('2020-01-15T00:00:00.000Z');
        for (const learner of [learnerA, learnerB, learnerNone, learnerOther]) {
            await prisma.assignment.create({
                data: {
                    courseId,
                    assignerId: hr.id,
                    assigneeUserId: learner.id,
                    dueDate,
                },
            });
            await prisma.attempt.create({
                data: {
                    userId: learner.id,
                    courseId,
                    status: 'IN_PROGRESS',
                    completionPercentage: learner.id === learnerA.id ? 40 : 90,
                    learningHours: 2,
                },
            });
        }

        const batchAReport = await ActivityReportService.getReport(hr, { batchId: batchA.id });
        assert.deepEqual(batchAReport.trainees.map((row) => row.fullName), ['Activity Report A']);
        assert.equal(batchAReport.trainees[0].assignedCourses, 1);
        assert.equal(batchAReport.trainees[0].averageProgress, 40);
        assert.equal(batchAReport.trainees[0].overdueCourses, 1);
        assert.equal(batchAReport.breakdownBy, 'department');
        assert.equal(batchAReport.analytics.summary.comparison, null);
        assert.equal(batchAReport.analytics.summary.learners, batchAReport.trainees.length);
        assert.ok(batchAReport.analytics.atRisk.every((row) => row.fullName === 'Activity Report A'));
        assert.equal(batchAReport.analytics.funnel.assigned, batchAReport.totals.assignedCourses);
        assert.equal(batchAReport.analytics.summary.completionRate, batchAReport.totals.completionRate);
        assert.ok(batchAReport.analytics.scorm.registrations.every((row) => row.fullName === 'Activity Report A'));
        assert.equal(batchAReport.analytics.scorm.interactions.rows.length, 0);
        assert.equal(
            batchAReport.analytics.scorm.scoreBands.under50
            + batchAReport.analytics.scorm.scoreBands.from50to79
            + batchAReport.analytics.scorm.scoreBands.from80,
            0,
        );

        const names = (report) => report.trainees.map((row) => row.fullName);
        assert.equal(names(batchAReport).includes('Activity Report B'), false);
        assert.equal(names(batchAReport).includes('Activity Report None'), false);
        assert.equal(names(batchAReport).includes('Activity Report Other'), false);

        const unassigned = await ActivityReportService.getReport(hr, { batchId: 'unassigned' });
        assert.equal(names(unassigned).includes('Activity Report None'), true);
        assert.equal(names(unassigned).includes('Activity Report A'), false);
        assert.equal(names(unassigned).includes('Activity Report B'), false);
        assert.equal(names(unassigned).includes('Activity Report Other'), false);

        const everyone = await ActivityReportService.getReport(hr, {});
        assert.equal(names(everyone).includes('Activity Report A'), true);
        assert.equal(names(everyone).includes('Activity Report B'), true);
        assert.equal(names(everyone).includes('Activity Report None'), true);
        assert.equal(names(everyone).includes('Activity Report Other'), false);
        assert.equal(everyone.breakdownBy, 'batch');

        const emptyRange = await ActivityReportService.getReport(hr, {
            batchId: batchA.id,
            from: '2020-01-01',
            to: '2020-01-02',
        });
        assert.equal(emptyRange.trainees.length, 1);
        assert.equal(emptyRange.trainees[0].assignedCourses, 0);
        assert.equal(emptyRange.trainees[0].averageProgress, 0);
        assert.equal(emptyRange.message, null);

        const csv = await ActivityReportService.getReportCsv(hr, { batchId: batchA.id });
        const csvLines = csv.trim().split('\n');
        assert.equal(csvLines.length, batchAReport.trainees.length + 1);
        assert.match(csv, /Activity Report A/);
        assert.equal(csv.includes('Activity Report B'), false);
        assert.equal(csv.includes('Activity Report None'), false);
        assert.equal(csv.includes('Activity Report Other'), false);

        await assert.rejects(
            () => ActivityReportService.getReport(hr, { batchId: otherBatch.id }),
            /not in this organization/,
        );

        const noMatch = await ActivityReportService.getReport(hr, {
            batchId: batchB.id,
            department: 'FINANCE',
        });
        assert.deepEqual(noMatch.trainees, []);
        assert.equal(noMatch.message, 'No trainees match these filters.');
        assert.equal(noMatch.analytics.scorm.registrations.length, 0);
        assert.equal(noMatch.analytics.scorm.interactions.rows.length, 0);
        assert.equal(noMatch.analytics.scorm.launches.count, 0);
    } finally {
        if (courseId) {
            await prisma.attempt.deleteMany({ where: { courseId } });
            await prisma.assignment.deleteMany({ where: { courseId } });
            await prisma.course.delete({ where: { id: courseId } }).catch(() => {});
        }
        if (createdUserIds.length > 0) {
            await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
        }
        const batchIds = [batchAId, batchBId, otherBatchId].filter(Boolean);
        if (batchIds.length > 0) {
            await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
        }
        if (otherOrgId) {
            await prisma.organization.delete({ where: { id: otherOrgId } }).catch(() => {});
        }
    }
}

async function main() {
    testBuilderAndCsv();
    console.log('ok builder and csv');
    await testOrgScope();
    console.log('ok organization scope');
    console.log('activity report tests passed');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectPrisma();
    });
