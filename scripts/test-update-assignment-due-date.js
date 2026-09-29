/**
 * Due-date updates must not change learning progress.
 * Run: node scripts/test-update-assignment-due-date.js
 */
import assert from 'node:assert/strict';
import { prisma, disconnectPrisma } from '../src/utils/db.js';
import { AssignmentService } from '../src/service/AssignmentService.js';

async function main() {
    const hr = await prisma.user.findFirst({
        where: { userRole: 'HR_MANAGER', orgId: { not: null } },
        select: { id: true, orgId: true, userRole: true },
    });
    assert.ok(hr, 'an HR manager with an organization is required');

    const stamp = Date.now();
    let courseId = null;
    let learnerId = null;
    let outsiderId = null;
    let otherOrgId = null;

    try {
        const course = await prisma.course.create({
            data: { title: `Due date ${stamp}`, status: 'PUBLISHED', createdBy: hr.id },
        });
        courseId = course.id;

        const learner = await prisma.user.create({
            data: {
                fullName: `Due Date Learner ${stamp}`,
                password: 'test-only',
                userRole: 'LEARNER',
                department: 'SALES',
                phoneNumber: `+23481${String(stamp).slice(-8)}`,
                orgId: hr.orgId,
            },
        });
        learnerId = learner.id;

        const otherOrg = await prisma.organization.create({
            data: { name: `Due date other org ${stamp}`, createdBy: hr.id },
        });
        otherOrgId = otherOrg.id;
        const outsider = await prisma.user.create({
            data: {
                fullName: `Due Date Outsider ${stamp}`,
                password: 'test-only',
                userRole: 'LEARNER',
                department: 'SALES',
                phoneNumber: `+23482${String(stamp).slice(-8)}`,
                orgId: otherOrg.id,
            },
        });
        outsiderId = outsider.id;

        const originalDue = new Date('2026-01-15T00:00:00.000Z');
        const nextDue = new Date('2026-06-30T00:00:00.000Z');
        const assignment = await prisma.assignment.create({
            data: {
                courseId,
                assignerId: hr.id,
                assigneeUserId: learner.id,
                dueDate: originalDue,
            },
        });
        const attempt = await prisma.attempt.create({
            data: {
                userId: learner.id,
                courseId,
                assignmentId: assignment.id,
                status: 'IN_PROGRESS',
                completionPercentage: 40,
                score: 80,
                dueDate: originalDue,
            },
        });
        const outsiderAssignment = await prisma.assignment.create({
            data: {
                courseId,
                assignerId: hr.id,
                assigneeUserId: outsider.id,
                dueDate: originalDue,
            },
        });

        await assert.rejects(
            () => AssignmentService.updateAssignmentDueDate(assignment.id, 'not-a-date', hr),
            /Invalid due date/,
        );
        await assert.rejects(
            () => AssignmentService.updateAssignmentDueDate('missing-assignment', nextDue.toISOString(), hr),
            /Assignment not found/,
        );
        await assert.rejects(
            () => AssignmentService.updateAssignmentDueDate(outsiderAssignment.id, nextDue.toISOString(), hr),
            /Not allowed to update this assignment/,
        );

        const updated = await AssignmentService.updateAssignmentDueDate(
            assignment.id,
            nextDue.toISOString(),
            hr,
        );
        assert.equal(updated.assignmentId, assignment.id);
        assert.equal(updated.dueDate, nextDue.toISOString());

        const storedAssignment = await prisma.assignment.findUnique({ where: { id: assignment.id } });
        const storedAttempt = await prisma.attempt.findUnique({ where: { id: attempt.id } });
        assert.equal(storedAssignment.dueDate.toISOString(), nextDue.toISOString());
        assert.equal(storedAttempt.dueDate.toISOString(), nextDue.toISOString());
        assert.equal(storedAttempt.status, 'IN_PROGRESS');
        assert.equal(storedAttempt.completionPercentage, 40);
        assert.equal(storedAttempt.score, 80);
        assert.equal(storedAssignment.courseId, courseId);
        assert.equal(storedAssignment.assigneeUserId, learner.id);

        console.log('due date update tests passed');
    } finally {
        if (courseId) {
            await prisma.attempt.deleteMany({ where: { courseId } });
            await prisma.assignment.deleteMany({ where: { courseId } });
            await prisma.course.delete({ where: { id: courseId } }).catch(() => {});
        }
        const userIds = [learnerId, outsiderId].filter(Boolean);
        if (userIds.length > 0) {
            await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        }
        if (otherOrgId) {
            await prisma.organization.delete({ where: { id: otherOrgId } }).catch(() => {});
        }
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectPrisma();
    });
