/**
 * Unit checks for course-reset certificate lookup (no DB).
 * Run: node scripts/test-course-reset-certificate-lookup.js
 */
import assert from 'node:assert/strict';
import { buildCertificateResetQuery } from '../src/lib/courseProgressReset.js';

function testCategorizedCourseUsesTopicKey() {
    const query = buildCertificateResetQuery({
        userId: 'learner-1',
        courseId: 'course-sales-a',
        categoryId: 'cat-sales',
    });

    assert.equal(query.method, 'findUnique');
    assert.deepEqual(query.where, {
        userId_categoryId: { userId: 'learner-1', categoryId: 'cat-sales' },
    });
    assert.equal(query.where.userId_courseId, undefined);
}

function testUncategorizedCourseFallsBackToCourseId() {
    const query = buildCertificateResetQuery({
        userId: 'learner-1',
        courseId: 'course-orphan',
        categoryId: null,
    });

    assert.equal(query.method, 'findFirst');
    assert.deepEqual(query.where, {
        userId: 'learner-1',
        courseId: 'course-orphan',
    });
    assert.equal(query.where.userId_courseId, undefined);
}

function testOtherCategoryIsADifferentLookup() {
    const sales = buildCertificateResetQuery({
        userId: 'learner-1',
        courseId: 'course-sales-a',
        categoryId: 'cat-sales',
    });
    const compliance = buildCertificateResetQuery({
        userId: 'learner-1',
        courseId: 'course-compliance',
        categoryId: 'cat-compliance',
    });

    assert.notEqual(
        sales.where.userId_categoryId.categoryId,
        compliance.where.userId_categoryId.categoryId,
    );
}

const tests = [
    testCategorizedCourseUsesTopicKey,
    testUncategorizedCourseFallsBackToCourseId,
    testOtherCategoryIsADifferentLookup,
];

for (const test of tests) {
    test();
    console.log(`ok ${test.name}`);
}

console.log(`\n${tests.length} course reset certificate lookup tests passed`);
