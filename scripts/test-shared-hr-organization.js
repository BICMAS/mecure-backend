/**
 * Several HR managers can share one organization.
 * Run: node scripts/test-shared-hr-organization.js
 */
import assert from 'node:assert/strict';
import { prisma, disconnectPrisma } from '../src/utils/db.js';
import { UserService } from '../src/service/UserService.js';

function learnerIds(users) {
    return users
        .filter((user) => user.userRole === 'LEARNER')
        .map((user) => user.id)
        .sort();
}

async function main() {
    const anchor = await prisma.user.findFirst({
        where: { email: { equals: 'aibrahim@3dimgroup.com', mode: 'insensitive' } },
        select: { id: true, orgId: true, userRole: true, fullName: true },
    });
    assert.ok(anchor?.orgId, 'aibrahim@3dimgroup.com must belong to an organization');

    const superAdmin = await prisma.user.findFirst({
        where: { userRole: 'SUPER_ADMIN' },
        select: { id: true, userRole: true, orgId: true },
    });
    assert.ok(superAdmin, 'a super admin is required');

    const stamp = Date.now();
    const createdUserIds = [];
    let separateOrgId = null;

    try {
        const orgCountBefore = await prisma.organization.count();
        const originalLearners = learnerIds(await UserService.getCurrentOrgUsers({
            id: anchor.id,
            userRole: 'HR_MANAGER',
            orgId: anchor.orgId,
        }));
        assert.ok(originalLearners.length > 0, 'the shared organization has learners');

        const shared = await UserService.createUser({
            fullName: `Shared HR ${stamp}`,
            email: `shared-hr-${stamp}@example.com`,
            password: 'test-only',
            userRole: 'HR_MANAGER',
            department: 'HR',
            orgId: anchor.orgId,
        }, superAdmin);
        createdUserIds.push(shared.id);
        assert.equal(shared.orgId, anchor.orgId);
        assert.equal(await prisma.organization.count(), orgCountBefore);

        const sharedLearners = learnerIds(await UserService.getCurrentOrgUsers({
            id: shared.id,
            userRole: 'HR_MANAGER',
            orgId: shared.orgId,
        }));
        assert.deepEqual(sharedLearners, originalLearners);

        const separate = await UserService.createUser({
            fullName: `Separate HR ${stamp}`,
            email: `separate-hr-${stamp}@example.com`,
            password: 'test-only',
            userRole: 'HR_MANAGER',
            department: 'HR',
        }, superAdmin);
        createdUserIds.push(separate.id);
        separateOrgId = separate.orgId;
        assert.notEqual(separate.orgId, anchor.orgId);
        assert.equal(await prisma.organization.count(), orgCountBefore + 1);

        const separateLearners = new Set(learnerIds(await UserService.getCurrentOrgUsers({
            id: separate.id,
            userRole: 'HR_MANAGER',
            orgId: separate.orgId,
        })));
        for (const learnerId of originalLearners) {
            assert.equal(separateLearners.has(learnerId), false);
        }

        await assert.rejects(
            () => UserService.createUser({
                fullName: `Blocked HR ${stamp}`,
                email: `blocked-hr-${stamp}@example.com`,
                password: 'test-only',
                userRole: 'HR_MANAGER',
                department: 'HR',
                orgId: anchor.orgId,
            }, {
                id: anchor.id,
                userRole: 'HR_MANAGER',
                orgId: anchor.orgId,
            }),
            /only create learners/,
        );

        await assert.rejects(
            () => UserService.createUser({
                fullName: `Missing org ${stamp}`,
                email: `missing-org-${stamp}@example.com`,
                password: 'test-only',
                userRole: 'HR_MANAGER',
                department: 'HR',
                orgId: 'missing-organization',
            }, superAdmin),
            /Organization not found/,
        );
    } finally {
        if (createdUserIds.length > 0) {
            await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
        }
        if (separateOrgId) {
            await prisma.organization.delete({ where: { id: separateOrgId } }).catch(() => {});
        }
    }

    console.log('shared HR organization tests passed');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectPrisma();
    });
