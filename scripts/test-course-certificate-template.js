/**
 * Unit checks for course certificate-template assignment (no DB required).
 * Run: node scripts/test-course-certificate-template.js
 */
import assert from 'node:assert/strict';
import {
    pickLatestCourseTemplateAssignments,
    resolveIssuanceTemplateId,
} from '../src/lib/courseCertificateTemplate.js';

function testPicksLatestAuditMappingPerCourse() {
    const assignments = pickLatestCourseTemplateAssignments([
        {
            targetId: 'course-a',
            createdAt: '2026-01-01T00:00:00.000Z',
            payload: { templateId: 'old-template' },
        },
        {
            targetId: 'course-a',
            createdAt: '2026-02-01T00:00:00.000Z',
            payload: { templateId: 'new-template' },
        },
        {
            targetId: 'course-b',
            createdAt: '2026-01-15T00:00:00.000Z',
            payload: { templateId: 'other-template' },
        },
    ]);

    assert.equal(assignments.get('course-a'), 'new-template');
    assert.equal(assignments.get('course-b'), 'other-template');
}

function testSkipsInvalidAuditPayloads() {
    const assignments = pickLatestCourseTemplateAssignments([
        { targetId: 'course-a', createdAt: '2026-01-01T00:00:00.000Z', payload: null },
        { targetId: 'course-a', createdAt: '2026-02-01T00:00:00.000Z', payload: {} },
        { targetId: 'course-a', createdAt: '2026-03-01T00:00:00.000Z', payload: { templateId: 'valid' } },
    ]);

    assert.equal(assignments.get('course-a'), 'valid');
}

function testIssuanceUsesCourseTemplateOnly() {
    assert.equal(
        resolveIssuanceTemplateId({
            courseTemplateId: 'course-tpl',
            orgTemplateId: 'org-tpl',
            requestedTemplateId: 'other-tpl',
        }),
        'course-tpl',
    );
}

function testIssuanceReturnsNullWhenCourseHasNoTemplate() {
    assert.equal(
        resolveIssuanceTemplateId({
            courseTemplateId: null,
            orgTemplateId: 'org-tpl',
            requestedTemplateId: 'requested-tpl',
        }),
        null,
    );
}

const tests = [
    testPicksLatestAuditMappingPerCourse,
    testSkipsInvalidAuditPayloads,
    testIssuanceUsesCourseTemplateOnly,
    testIssuanceReturnsNullWhenCourseHasNoTemplate,
];

for (const test of tests) {
    test();
    console.log(`ok ${test.name}`);
}

console.log(`\n${tests.length} course certificate template tests passed`);
