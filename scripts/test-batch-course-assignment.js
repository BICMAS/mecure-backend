/**
 * Batch course assignment checks.
 * Run: node scripts/test-batch-course-assignment.js
 */
import assert from 'node:assert/strict';
import { prisma, disconnectPrisma } from '../src/utils/db.js';
import { AssignmentService } from '../src/service/AssignmentService.js';
import { planBatchCourseAssignment } from '../src/lib/batchAssignment.js';

function testPlanner() {
    const plan = planBatchCourseAssignment({
        batches: [
            { id: 'batch-a' },
            { id: 'batch-empty' },
        ],
        learners: [
            { id: 'learner-a', batchId: 'batch-a' },
            { id: 'learner-b', batchId: 'batch-b' },
            { id: 'learner-none', batchId: null },
        ],
        existingAssigneeIds: [],
    });
    assert.deepEqual(plan.toAssign, ['learner-a']);
    assert.deepEqual(plan.emptyBatchIds, ['batch-empty']);

    const again = planBatchCourseAssignment({
        batches: [{ id: 'batch-a' }],
        learners: [{ id: 'learner-a', batchId: 'batch-a' }],
        existingAssigneeIds: ['learner-a'],
    });
    assert.deepEqual(again.toAssign, []);
    assert.deepEqual(again.skipped, ['learner-a']);
}

async function testAssignment() {
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
    let otherOrgId = null;
    let otherBatchId = null;

    try {
        const course = await prisma.course.create({
            data: {
                title: `Batch assign test ${stamp}`,
                status: 'PUBLISHED',
                createdBy: hr.id,
            },
        });
        courseId = course.id;

        const batchA = await prisma.batch.create({
            data: { orgId: hr.orgId, name: `Assign A ${stamp}` },
        });
        const batchB = await prisma.batch.create({
            data: { orgId: hr.orgId, name: `Assign B ${stamp}` },
        });
        const emptyBatch = await prisma.batch.create({
            data: { orgId: hr.orgId, name: `Assign Empty ${stamp}` },
        });
        batchAId = batchA.id;
        batchBId = batchB.id;
        emptyBatchId = emptyBatch.id;

        const otherOrg = await prisma.organization.create({
            data: { name: `Assign other org ${stamp}`, createdBy: hr.id },
        });
        otherOrgId = otherOrg.id;
        const otherBatch = await prisma.batch.create({
            data: { orgId: otherOrg.id, name: `Assign Other ${stamp}` },
        });
        otherBatchId = otherBatch.id;

        const learnerA = await prisma.user.create({
            data: {
                fullName: 'Batch Assign A',
                password: 'test-only',
                userRole: 'LEARNER',
                department: 'SALES',
                orgId: hr.orgId,
                batchId: batchA.id,
                phoneNumber: `+23473${String(stamp).slice(-8)}`,
            },
        });
        const learnerB = await prisma.user.create({
            data: {
                fullName: 'Batch Assign B',
                password: 'test-only',
                userRole: 'LEARNER',
                department: 'SALES',
                orgId: hr.orgId,
                batchId: batchB.id,
                phoneNumber: `+23474${String(stamp).slice(-8)}`,
            },
        });
        const unassigned = await prisma.user.create({
            data: {
                fullName: 'Batch Assign None',
                password: 'test-only',
                userRole: 'LEARNER',
                department: 'SALES',
                orgId: hr.orgId,
                phoneNumber: `+23475${String(stamp).slice(-8)}`,
            },
        });
        createdUserIds.push(learnerA.id, learnerB.id, unassigned.id);

        const first = await AssignmentService.createAssignments({
            courseId,
            batchIds: [batchA.id],
            dueDate: new Date().toISOString(),
        }, hr);
        assert.equal(first.assigned, 1);
        assert.equal(first.skipped, 0);

        const rows = await prisma.assignment.findMany({
            where: { courseId },
            select: { assigneeUserId: true },
        });
        assert.deepEqual(rows.map((row) => row.assigneeUserId), [learnerA.id]);

        const second = await AssignmentService.createAssignments({
            courseId,
            batchIds: [batchA.id],
            dueDate: new Date().toISOString(),
        }, hr);
        assert.equal(second.assigned, 0);
        assert.equal(second.skipped, 1);
        const stillOne = await prisma.assignment.count({ where: { courseId } });
        assert.equal(stillOne, 1);

        await assert.rejects(
            () => AssignmentService.createAssignments({
                courseId,
                batchIds: [emptyBatch.id],
                dueDate: new Date().toISOString(),
            }, hr),
            /no learners/,
        );

        await assert.rejects(
            () => AssignmentService.createAssignments({
                courseId,
                batchIds: [otherBatch.id],
                dueDate: new Date().toISOString(),
            }, hr),
            /not in this organization/,
        );
    } finally {
        if (courseId) {
            await prisma.assignment.deleteMany({ where: { courseId } });
            await prisma.course.delete({ where: { id: courseId } }).catch(() => {});
        }
        if (createdUserIds.length > 0) {
            await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
        }
        const batchIds = [batchAId, batchBId, emptyBatchId, otherBatchId].filter(Boolean);
        if (batchIds.length > 0) {
            await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
        }
        if (otherOrgId) {
            await prisma.organization.delete({ where: { id: otherOrgId } }).catch(() => {});
        }
    }
}

async function main() {
    testPlanner();
    console.log('ok testPlanner');
    await testAssignment();
    console.log('ok testAssignment');
    console.log('\nbatch course assignment tests passed');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectPrisma();
    });
