/**
 * Batch-scoped course progress reset.
 * Run: node scripts/test-batch-course-progress-reset.js
 */
import assert from 'node:assert/strict';
import { prisma, disconnectPrisma } from '../src/utils/db.js';
import { resetCourseProgress } from '../src/lib/courseProgressReset.js';

async function attemptFor(userId, courseId) {
    return prisma.attempt.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { status: true, completionPercentage: true },
    });
}

async function main() {
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
    let emptyBatchId = null;
    let unassignedBatchId = null;
    let otherOrgId = null;
    let otherBatchId = null;

    try {
        const course = await prisma.course.create({
            data: {
                title: `Batch reset test ${stamp}`,
                status: 'PUBLISHED',
                createdBy: hr.id,
            },
        });
        courseId = course.id;

        const batchA = await prisma.batch.create({
            data: { orgId: hr.orgId, name: `Reset A ${stamp}` },
        });
        const batchB = await prisma.batch.create({
            data: { orgId: hr.orgId, name: `Reset B ${stamp}` },
        });
        const emptyBatch = await prisma.batch.create({
            data: { orgId: hr.orgId, name: `Reset Empty ${stamp}` },
        });
        const unassignedBatch = await prisma.batch.create({
            data: { orgId: hr.orgId, name: `Reset Unassigned ${stamp}` },
        });
        batchAId = batchA.id;
        batchBId = batchB.id;
        emptyBatchId = emptyBatch.id;
        unassignedBatchId = unassignedBatch.id;

        const otherOrg = await prisma.organization.create({
            data: { name: `Reset other org ${stamp}`, createdBy: hr.id },
        });
        otherOrgId = otherOrg.id;
        const otherBatch = await prisma.batch.create({
            data: { orgId: otherOrg.id, name: `Reset Other ${stamp}` },
        });
        otherBatchId = otherBatch.id;

        const learnerA = await prisma.user.create({
            data: {
                fullName: 'Batch Reset A',
                password: 'test-only',
                userRole: 'LEARNER',
                department: 'SALES',
                orgId: hr.orgId,
                batchId: batchA.id,
                phoneNumber: `+23481${String(stamp).slice(-8)}`,
            },
        });
        const learnerB = await prisma.user.create({
            data: {
                fullName: 'Batch Reset B',
                password: 'test-only',
                userRole: 'LEARNER',
                department: 'SALES',
                orgId: hr.orgId,
                batchId: batchB.id,
                phoneNumber: `+23482${String(stamp).slice(-8)}`,
            },
        });
        const learnerNone = await prisma.user.create({
            data: {
                fullName: 'Batch Reset None',
                password: 'test-only',
                userRole: 'LEARNER',
                department: 'SALES',
                orgId: hr.orgId,
                phoneNumber: `+23483${String(stamp).slice(-8)}`,
            },
        });
        const learnerNotAssigned = await prisma.user.create({
            data: {
                fullName: 'Batch Reset Not Assigned',
                password: 'test-only',
                userRole: 'LEARNER',
                department: 'SALES',
                orgId: hr.orgId,
                batchId: unassignedBatch.id,
                phoneNumber: `+23484${String(stamp).slice(-8)}`,
            },
        });
        createdUserIds.push(learnerA.id, learnerB.id, learnerNone.id, learnerNotAssigned.id);

        for (const userId of [learnerA.id, learnerB.id, learnerNone.id]) {
            await prisma.assignment.create({
                data: {
                    courseId,
                    assignerId: hr.id,
                    assigneeUserId: userId,
                    dueDate: new Date(),
                },
            });
            await prisma.attempt.create({
                data: {
                    userId,
                    courseId,
                    status: 'IN_PROGRESS',
                    completionPercentage: 40,
                },
            });
        }

        const preview = await resetCourseProgress({
            courseId,
            requester: hr,
            batchIds: [batchA.id],
            dryRun: true,
        });
        assert.equal(preview.learnersProcessed, 1);
        assert.equal(preview.dryRun, true);

        const result = await resetCourseProgress({
            courseId,
            requester: hr,
            batchIds: [batchA.id],
            dryRun: false,
        });
        assert.equal(result.learnersProcessed, preview.learnersProcessed);
        assert.equal(result.attemptsReset, 1);

        const afterA = await attemptFor(learnerA.id, courseId);
        assert.equal(afterA.status, 'NOT_STARTED');
        assert.equal(afterA.completionPercentage, 0);

        const afterB = await attemptFor(learnerB.id, courseId);
        assert.equal(afterB.status, 'IN_PROGRESS');
        assert.equal(afterB.completionPercentage, 40);

        const afterNone = await attemptFor(learnerNone.id, courseId);
        assert.equal(afterNone.status, 'IN_PROGRESS');
        assert.equal(afterNone.completionPercentage, 40);

        const notAssignedAttempt = await attemptFor(learnerNotAssigned.id, courseId);
        assert.equal(notAssignedAttempt, null);

        const assignmentCount = await prisma.assignment.count({ where: { courseId } });
        assert.equal(assignmentCount, 3);

        await assert.rejects(
            () => resetCourseProgress({
                courseId,
                requester: hr,
                batchIds: [emptyBatch.id],
            }),
            /no learners assigned to this course/,
        );

        await assert.rejects(
            () => resetCourseProgress({
                courseId,
                requester: hr,
                batchIds: [unassignedBatch.id],
            }),
            /no learners assigned to this course/,
        );

        await assert.rejects(
            () => resetCourseProgress({
                courseId,
                requester: hr,
                batchIds: [otherBatch.id],
            }),
            /not in this organization/,
        );

        const stillB = await attemptFor(learnerB.id, courseId);
        assert.equal(stillB.status, 'IN_PROGRESS');
        assert.equal(stillB.completionPercentage, 40);
    } finally {
        if (courseId) {
            await prisma.attempt.deleteMany({ where: { courseId } });
            await prisma.assignment.deleteMany({ where: { courseId } });
            await prisma.course.delete({ where: { id: courseId } }).catch(() => {});
        }
        if (createdUserIds.length > 0) {
            await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
        }
        const batchIds = [batchAId, batchBId, emptyBatchId, unassignedBatchId, otherBatchId].filter(Boolean);
        if (batchIds.length > 0) {
            await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
        }
        if (otherOrgId) {
            await prisma.organization.delete({ where: { id: otherOrgId } }).catch(() => {});
        }
    }
}

main()
    .then(() => {
        console.log('batch course progress reset tests passed');
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectPrisma();
    });
