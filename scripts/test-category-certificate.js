/**
 * Unit checks for category-level certificate helpers (no DB required).
 * Run: node scripts/test-category-certificate.js
 */
import assert from 'node:assert/strict';
import {
    summarizeCategoryEligibility,
    resolveCategoryIssuanceTemplateId,
    shouldSeedCategoryTemplateFromCourse,
} from '../src/lib/categoryCertificate.js';

function testNotEligibleWhenOnlySomeCoursesDone() {
    const summary = summarizeCategoryEligibility(
        [
            { courseId: 'c1', categoryId: 'sales', complete: true, passed: true },
            { courseId: 'c2', categoryId: 'sales', complete: false, passed: false },
            { courseId: 'c3', categoryId: 'other', complete: true, passed: true },
        ],
        'sales',
    );

    assert.equal(summary.assignedCount, 2);
    assert.equal(summary.completedCount, 1);
    assert.equal(summary.eligible, false);
    assert.deepEqual(summary.incompleteCourseIds, ['c2']);
}

function testEligibleWhenAllAssignedInCategoryPassed() {
    const summary = summarizeCategoryEligibility(
        [
            { courseId: 'c1', categoryId: 'sales', complete: true, passed: true },
            { courseId: 'c2', categoryId: 'sales', complete: true, passed: true },
        ],
        'sales',
    );

    assert.equal(summary.eligible, true);
    assert.equal(summary.assignedCount, 2);
    assert.equal(summary.completedCount, 2);
}

function testNotEligibleWithZeroAssignedInCategory() {
    const summary = summarizeCategoryEligibility(
        [{ courseId: 'c1', categoryId: 'other', complete: true, passed: true }],
        'sales',
    );
    assert.equal(summary.eligible, false);
    assert.equal(summary.assignedCount, 0);
}

function testOtherCategoryDoesNotUnlock() {
    const summary = summarizeCategoryEligibility(
        [
            { courseId: 'c1', categoryId: 'sales', complete: true, passed: true },
            { courseId: 'c2', categoryId: 'sales', complete: false, passed: false },
            { courseId: 'c3', categoryId: 'compliance', complete: true, passed: true },
        ],
        'sales',
    );
    assert.equal(summary.eligible, false);
}

function testTemplatePrefersCategory() {
    assert.equal(
        resolveCategoryIssuanceTemplateId({
            categoryTemplateId: 'cat-tpl',
            courseTemplates: [
                { courseId: 'c1', title: 'Alpha', templateId: 'course-tpl' },
            ],
        }),
        'cat-tpl',
    );
}

function testTemplateFallsBackToCourseByTitle() {
    assert.equal(
        resolveCategoryIssuanceTemplateId({
            categoryTemplateId: null,
            courseTemplates: [
                { courseId: 'c2', title: 'Zebra', templateId: 'tpl-z' },
                { courseId: 'c1', title: 'Alpha', templateId: 'tpl-a' },
            ],
        }),
        'tpl-a',
    );
}

function testTemplateNullWhenNone() {
    assert.equal(
        resolveCategoryIssuanceTemplateId({
            categoryTemplateId: null,
            courseTemplates: [{ courseId: 'c1', title: 'A', templateId: null }],
        }),
        null,
    );
}

function testSeedCategoryTemplateWhenEmpty() {
    assert.equal(
        shouldSeedCategoryTemplateFromCourse({
            categoryTemplateId: null,
            courseTemplateId: 'tpl-1',
        }),
        true,
    );
    assert.equal(
        shouldSeedCategoryTemplateFromCourse({
            categoryTemplateId: 'existing',
            courseTemplateId: 'tpl-1',
        }),
        false,
    );
}

const tests = [
    testNotEligibleWhenOnlySomeCoursesDone,
    testEligibleWhenAllAssignedInCategoryPassed,
    testNotEligibleWithZeroAssignedInCategory,
    testOtherCategoryDoesNotUnlock,
    testTemplatePrefersCategory,
    testTemplateFallsBackToCourseByTitle,
    testTemplateNullWhenNone,
    testSeedCategoryTemplateWhenEmpty,
];

for (const test of tests) {
    test();
    console.log(`ok ${test.name}`);
}

console.log(`\n${tests.length} category certificate tests passed`);
