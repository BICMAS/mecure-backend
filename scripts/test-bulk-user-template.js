/**
 * Bulk user CSV template and upload checks.
 * Run: node scripts/test-bulk-user-template.js
 */
import assert from 'node:assert/strict';
import { prisma, disconnectPrisma } from '../src/utils/db.js';
import { UserService } from '../src/service/UserService.js';
import { BULK_USER_TEMPLATE_CSV } from '../../mecure-hr-manager/utils/bulkUserTemplate.js';

function testTemplateShape() {
    const rows = BULK_USER_TEMPLATE_CSV.trim().split('\n');
    assert.equal(
        rows[0],
        'fullName,email,phoneNumber,password,department,designation,userRole',
    );
    assert.equal(rows.length, 3);
    assert.match(rows[1], /,LEARNER$/);
    assert.match(rows[2], /,LEARNER$/);
    assert.match(rows[1], /,SALES,/);
    assert.match(rows[2], /,MARKETING,/);
    assert.match(rows[2], /^Chinedu Bello,,/);
}

async function testUploadRules() {
    const hr = await prisma.user.findFirst({
        where: { userRole: 'HR_MANAGER', orgId: { not: null } },
        select: { id: true, orgId: true, userRole: true },
    });
    assert.ok(hr, 'an HR manager with an organization is required');

    const stamp = Date.now();
    const emailA = `bulk.a.${stamp}@example.com`;
    const emailB = `bulk.b.${stamp}@example.com`;
    const phoneA = `+23470${String(stamp).slice(-8)}`;
    const phoneB = `+23471${String(stamp).slice(-8)}`;
    const createdEmails = [emailA, emailB];

    try {
        const first = await UserService.bulkUpload([
            {
                fullName: 'Bulk Learner A',
                email: emailA,
                phoneNumber: phoneA,
                password: 'TempPass#2026',
                department: 'SALES',
                designation: 'Medical Rep',
                userRole: 'LEARNER',
            },
            {
                fullName: 'Bulk Learner B',
                email: emailB,
                phoneNumber: phoneB,
                password: 'TempPass#2026',
                department: 'MARKETING',
                designation: 'Field Rep',
                userRole: 'LEARNER',
            },
        ], hr);

        assert.equal(first.created, 2);
        assert.equal(first.skipped, 0);

        const stored = await prisma.user.findMany({
            where: { email: { in: createdEmails } },
            select: {
                email: true,
                orgId: true,
                batchId: true,
                userRole: true,
                department: true,
            },
        });
        assert.equal(stored.length, 2);
        for (const user of stored) {
            assert.equal(user.orgId, hr.orgId);
            assert.equal(user.batchId, null);
            assert.equal(user.userRole, 'LEARNER');
        }

        const duplicate = await UserService.bulkUpload([
            {
                fullName: 'Bulk Learner A',
                email: emailA,
                phoneNumber: phoneA,
                password: 'TempPass#2026',
                department: 'SALES',
                userRole: 'LEARNER',
            },
        ], hr);
        assert.equal(duplicate.created, 0);
        assert.equal(duplicate.skipped, 1);
        const stillOne = await prisma.user.count({ where: { email: emailA } });
        assert.equal(stillOne, 1);

        const badEmail = `bulk.bad.${stamp}@example.com`;
        await assert.rejects(
            () => UserService.bulkUpload([
                {
                    fullName: 'Bad Department',
                    email: badEmail,
                    phoneNumber: `+23472${String(stamp).slice(-8)}`,
                    password: 'TempPass#2026',
                    department: 'NOT_A_DEPT',
                    userRole: 'LEARNER',
                },
            ], hr),
            /department must be one of/,
        );
        const badCount = await prisma.user.count({ where: { email: badEmail } });
        assert.equal(badCount, 0);
    } finally {
        await prisma.user.deleteMany({
            where: { email: { in: createdEmails } },
        });
    }
}

async function main() {
    testTemplateShape();
    console.log('ok testTemplateShape');
    await testUploadRules();
    console.log('ok testUploadRules');
    console.log('\nbulk user template tests passed');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectPrisma();
    });
