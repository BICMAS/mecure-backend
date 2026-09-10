/**
 * Unit checks for course lock/unlock (no DB required).
 * Run: node scripts/test-course-lock.js
 */
import assert from 'node:assert/strict';
import {
    COURSE_LOCKED_MESSAGE,
    isCourseLocked,
    assertCourseUnlocked,
    assertLearnerCourseUnlocked,
    buildLockUpdate,
    buildUnlockUpdate,
    formatCourseLockFields,
} from '../src/lib/courseLock.js';

function testUnlockedByDefault() {
    assert.equal(isCourseLocked(undefined), false);
    assert.equal(isCourseLocked(null), false);
    assert.equal(isCourseLocked({}), false);
    assert.equal(isCourseLocked({ isLocked: false }), false);
}

function testLockedWhenTrue() {
    assert.equal(isCourseLocked({ isLocked: true }), true);
}

function testAssertUnlockedThrows() {
    assert.throws(
        () => assertCourseUnlocked({ isLocked: true }),
        (err) => err instanceof Error && err.message === COURSE_LOCKED_MESSAGE,
    );
}

function testAssertUnlockedAllowsOpenCourse() {
    assert.doesNotThrow(() => assertCourseUnlocked({ isLocked: false }));
    assert.doesNotThrow(() => assertCourseUnlocked(null));
}

function testLearnerGuardOnlyBlocksLearners() {
    assert.doesNotThrow(() =>
        assertLearnerCourseUnlocked({ isLocked: true }, 'SUPER_ADMIN'),
    );
    assert.doesNotThrow(() =>
        assertLearnerCourseUnlocked({ isLocked: true }, 'HR_MANAGER'),
    );
    assert.throws(
        () => assertLearnerCourseUnlocked({ isLocked: true }, 'LEARNER'),
        /locked by admin/i,
    );
}

function testLockUpdatePayload() {
    const now = new Date('2026-09-09T06:00:00.000Z');
    assert.deepEqual(buildLockUpdate('user-1', now), {
        isLocked: true,
        lockedAt: now,
        lockedBy: 'user-1',
    });
}

function testUnlockUpdateClearsFields() {
    assert.deepEqual(buildUnlockUpdate(), {
        isLocked: false,
        lockedAt: null,
        lockedBy: null,
    });
}

function testFormatLockFieldsDefaultUnlocked() {
    assert.deepEqual(formatCourseLockFields({}), {
        isLocked: false,
        lockedAt: null,
        lockedBy: null,
    });
    assert.deepEqual(formatCourseLockFields({
        isLocked: true,
        lockedAt: '2026-09-09T06:00:00.000Z',
        lockedBy: 'admin-1',
    }), {
        isLocked: true,
        lockedAt: '2026-09-09T06:00:00.000Z',
        lockedBy: 'admin-1',
    });
}

const tests = [
    testUnlockedByDefault,
    testLockedWhenTrue,
    testAssertUnlockedThrows,
    testAssertUnlockedAllowsOpenCourse,
    testLearnerGuardOnlyBlocksLearners,
    testLockUpdatePayload,
    testUnlockUpdateClearsFields,
    testFormatLockFieldsDefaultUnlocked,
];

for (const test of tests) {
    test();
    console.log(`ok ${test.name}`);
}

console.log(`\n${tests.length} course lock tests passed`);
