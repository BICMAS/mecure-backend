/**
 * Batch scoping and User Management filter checks.
 * Run: node scripts/test-learner-batches.js
 */
import assert from 'node:assert/strict';
import { prisma, disconnectPrisma } from '../src/utils/db.js';
import { assertBatchAssignable } from '../src/service/BatchService.js';
import { filterUsersByBatch } from '../../mecure-hr-manager/utils/batchFilter.js';

function testAssignGuard() {
    const batch = { id: 'batch-a', orgId: 'org-a' };
    assert.equal(assertBatchAssignable(batch, 'org-a'), 'batch-a');
    assert.throws(
        () => assertBatchAssignable(batch, 'org-b'),
        /not in this organization/,
    );
    assert.throws(
        () => assertBatchAssignable(null, 'org-a'),
        /Batch not found/,
    );
    assert.throws(
        () => assertBatchAssignable(batch, null),
        /not in this organization/,
    );
}

function testBatchFilter() {
    const users = [
        { id: '1', batchId: 'batch-a' },
        { id: '2', batchId: 'batch-b' },
        { id: '3', batchId: null },
    ];
    assert.deepEqual(filterUsersByBatch(users, 'all').map((user) => user.id), ['1', '2', '3']);
    assert.deepEqual(filterUsersByBatch(users, 'batch-a').map((user) => user.id), ['1']);
    assert.deepEqual(filterUsersByBatch(users, 'unassigned').map((user) => user.id), ['3']);
}

async function testPersistedOrgScope() {
    const creator = await prisma.user.findFirst({
        where: { userRole: 'SUPER_ADMIN' },
        select: { id: true },
    });
    assert.ok(creator, 'a super admin is required to own temporary organizations');

    let rolledBack = false;
    try {
        await prisma.$transaction(async (tx) => {
            const stamp = Date.now();
            const orgA = await tx.organization.create({
                data: { name: `Batch test A ${stamp}`, createdBy: creator.id },
            });
            const orgB = await tx.organization.create({
                data: { name: `Batch test B ${stamp}`, createdBy: creator.id },
            });
            const batchA = await tx.batch.create({
                data: { orgId: orgA.id, name: 'Cohort A' },
            });
            const batchA2 = await tx.batch.create({
                data: { orgId: orgA.id, name: 'Cohort A2' },
            });
            const batchB = await tx.batch.create({
                data: { orgId: orgB.id, name: 'Cohort B' },
            });

            const visibleToA = await tx.batch.findMany({
                where: { orgId: orgA.id },
                select: { id: true },
            });
            assert.deepEqual(
                visibleToA.map((batch) => batch.id).sort(),
                [batchA.id, batchA2.id].sort(),
            );
            assert.equal(visibleToA.some((batch) => batch.id === batchB.id), false);

            assert.throws(
                () => assertBatchAssignable(batchB, orgA.id),
                /not in this organization/,
            );

            const learnerA = await tx.user.create({
                data: {
                    fullName: 'Batch Learner A',
                    password: 'test-only',
                    userRole: 'LEARNER',
                    department: 'SALES',
                    orgId: orgA.id,
                    batchId: batchA.id,
                    phoneNumber: `+23481${String(stamp).slice(-8)}1`,
                },
                include: { batch: { select: { id: true, name: true } } },
            });
            const learnerB = await tx.user.create({
                data: {
                    fullName: 'Batch Learner B',
                    password: 'test-only',
                    userRole: 'LEARNER',
                    department: 'SALES',
                    orgId: orgB.id,
                    batchId: batchB.id,
                    phoneNumber: `+23481${String(stamp).slice(-8)}2`,
                },
            });

            const reloaded = await tx.user.findUnique({
                where: { id: learnerA.id },
                include: { batch: { select: { name: true } } },
            });
            assert.equal(reloaded.batch.name, 'Cohort A');

            await tx.user.update({
                where: { id: learnerA.id },
                data: { batchId: assertBatchAssignable(batchA2, orgA.id) },
            });
            const edited = await tx.user.findUnique({
                where: { id: learnerA.id },
                include: { batch: { select: { id: true, name: true } } },
            });
            assert.equal(edited.batch.name, 'Cohort A2');

            const orgUsers = await tx.user.findMany({
                where: { orgId: orgA.id },
                include: { batch: { select: { id: true, name: true } } },
            });
            assert.equal(orgUsers.some((user) => user.id === learnerB.id), false);
            const filtered = filterUsersByBatch(
                orgUsers.map((user) => ({ id: user.id, batchId: user.batchId })),
                batchA2.id,
            );
            assert.deepEqual(filtered.map((user) => user.id), [learnerA.id]);

            throw new Error('ROLLBACK_OK');
        });
    } catch (error) {
        if (!(error instanceof Error) || error.message !== 'ROLLBACK_OK') {
            throw error;
        }
        rolledBack = true;
    }

    const leaked = await prisma.organization.count({
        where: { name: { startsWith: 'Batch test ' } },
    });
    assert.equal(leaked, 0);
    assert.equal(rolledBack, true);
}

async function main() {
    testAssignGuard();
    console.log('ok testAssignGuard');
    testBatchFilter();
    console.log('ok testBatchFilter');
    await testPersistedOrgScope();
    console.log('ok testPersistedOrgScope');
    console.log('\nlearner batch tests passed');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectPrisma();
    });
