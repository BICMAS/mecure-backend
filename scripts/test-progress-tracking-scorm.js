/**
 * Progress tracking rows prefer the saved SCORM registration.
 * Run: node scripts/test-progress-tracking-scorm.js
 */
import assert from 'node:assert/strict';
import { disconnectPrisma } from '../src/utils/db.js';
import { buildCourseTrackingRows } from '../src/service/DashboardService.js';

const course = { id: 'course-1', title: 'Planning and Preparation' };
const assignmentDue = new Date('2026-09-30T00:00:00.000Z');
const attemptDue = new Date('2026-10-18T00:00:00.000Z');

function testRegistrationBeatsAttempt() {
    const rows = buildCourseTrackingRows({
        attempts: [{
            id: 'attempt-1',
            courseId: course.id,
            course,
            status: 'NOT_STARTED',
            completionPercentage: 0,
            score: 10,
            dueDate: attemptDue,
        }],
        assignments: [{
            courseId: course.id,
            dueDate: assignmentDue,
            course,
        }],
        scormAttempts: [{
            id: 'scorm-1',
            attemptId: 'attempt-1',
            status: 'IN_PROGRESS',
            registrationCompletion: 'INCOMPLETE',
            registrationSuccess: 'PASSED',
            completionPercentage: 67,
            score: 67,
            learningHours: 1.47,
            lastAccessAt: new Date('2026-09-27T00:00:00.000Z'),
            updatedAt: new Date('2026-09-27T00:00:00.000Z'),
            scormPackage: { courses: [course] },
        }],
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'INCOMPLETE');
    assert.equal(rows[0].progressPercent, 67);
    assert.equal(rows[0].score, 67);
    assert.equal(rows[0].quizResult, 'PASSED');
    assert.equal(rows[0].learningHours, 1.47);
    assert.equal(rows[0].dueDate, assignmentDue);
}

function testLatestRegistration() {
    const rows = buildCourseTrackingRows({
        assignments: [{ courseId: course.id, dueDate: assignmentDue, course }],
        scormAttempts: [
            {
                id: 'older',
                status: 'IN_PROGRESS',
                registrationCompletion: 'UNKNOWN',
                completionPercentage: 10,
                score: 10,
                lastAccessAt: new Date('2026-09-25T00:00:00.000Z'),
                scormPackage: { courses: [course] },
            },
            {
                id: 'newer',
                status: 'IN_PROGRESS',
                registrationCompletion: 'COMPLETED',
                registrationSuccess: 'PASSED',
                completionPercentage: null,
                scormCloudCompletion: null,
                score: 100,
                learningHours: 0.98,
                updatedAt: new Date('2026-09-29T00:00:00.000Z'),
                scormPackage: { courses: [course] },
            },
        ],
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'COMPLETED');
    assert.equal(rows[0].progressPercent, 100);
    assert.equal(rows[0].score, 100);
    assert.equal(rows[0].quizResult, 'PASSED');
}

function testCloudCompletionAndMissingRegistration() {
    const rows = buildCourseTrackingRows({
        attempts: [{
            id: 'attempt-2',
            courseId: 'course-2',
            course: { id: 'course-2', title: 'Sales' },
            status: 'IN_PROGRESS',
            completionPercentage: 40,
            score: 80,
            dueDate: attemptDue,
        }],
        assignments: [
            { courseId: course.id, dueDate: assignmentDue, course },
            { courseId: 'course-2', dueDate: null, course: { id: 'course-2', title: 'Sales' } },
        ],
        scormAttempts: [{
            id: 'cloud-only',
            status: 'IN_PROGRESS',
            registrationCompletion: null,
            completionPercentage: null,
            scormCloudCompletion: 0.6,
            score: null,
            scormCloudScoreScaled: null,
            learningHours: 0.2,
            lastAccessAt: new Date('2026-09-28T00:00:00.000Z'),
            scormPackage: { courses: [course] },
        }],
    });

    const planning = rows.find((row) => row.courseId === course.id);
    const sales = rows.find((row) => row.courseId === 'course-2');
    assert.equal(planning.status, 'IN_PROGRESS');
    assert.equal(planning.progressPercent, 60);
    assert.equal(planning.score, null);
    assert.equal(planning.dueDate, assignmentDue);
    assert.equal(sales.status, 'IN_PROGRESS');
    assert.equal(sales.progressPercent, 40);
    assert.equal(sales.score, 80);
    assert.equal(sales.quizResult, null);
    assert.equal(sales.dueDate, attemptDue);
}

function testAssignmentWithoutRegistration() {
    const rows = buildCourseTrackingRows({
        assignments: [{ courseId: course.id, dueDate: assignmentDue, course }],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'NOT_STARTED');
    assert.equal(rows[0].progressPercent, 0);
    assert.equal(rows[0].score, null);
    assert.equal(rows[0].quizResult, null);
    assert.equal(rows[0].dueDate, assignmentDue);
}

testRegistrationBeatsAttempt();
testLatestRegistration();
testCloudCompletionAndMissingRegistration();
testAssignmentWithoutRegistration();
console.log('progress tracking scorm rows passed');
await disconnectPrisma();
