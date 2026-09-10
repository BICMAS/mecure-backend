/**
 * Unit checks for course duration estimate (minutes) formatting (no DB required).
 * Run: node scripts/test-course-duration.js
 */
import assert from 'node:assert/strict';
import {
    parseDurationEstimate,
    formatDurationLabel,
    formatCourseDurationFields,
} from '../src/lib/courseDuration.js';

function testParseAllowsClearing() {
    assert.equal(parseDurationEstimate(null), null);
    assert.equal(parseDurationEstimate(''), null);
    assert.equal(parseDurationEstimate(undefined), undefined);
}

function testParseRoundsValidMinutes() {
    assert.equal(parseDurationEstimate(45), 45);
    assert.equal(parseDurationEstimate('90'), 90);
    assert.equal(parseDurationEstimate(45.6), 46);
}

function testParseRejectsOutOfRange() {
    assert.throws(() => parseDurationEstimate(0), /between 1 and/i);
    assert.throws(() => parseDurationEstimate(-10), /between 1 and/i);
    assert.throws(() => parseDurationEstimate(10081), /between 1 and/i);
    assert.throws(() => parseDurationEstimate('abc'), /between 1 and/i);
}

function testFormatLabels() {
    assert.equal(formatDurationLabel(null), null);
    assert.equal(formatDurationLabel(45), '45 min');
    assert.equal(formatDurationLabel(60), '1h');
    assert.equal(formatDurationLabel(90), '1h 30m');
}

function testFormatCourseFields() {
    assert.deepEqual(formatCourseDurationFields({ durationEstimate: 90 }), {
        durationEstimate: 90,
        durationLabel: '1h 30m',
    });
    assert.deepEqual(formatCourseDurationFields({}), {
        durationEstimate: null,
        durationLabel: null,
    });
}

const tests = [
    testParseAllowsClearing,
    testParseRoundsValidMinutes,
    testParseRejectsOutOfRange,
    testFormatLabels,
    testFormatCourseFields,
];

for (const test of tests) {
    test();
    console.log(`ok ${test.name}`);
}

console.log(`\n${tests.length} course duration tests passed`);
