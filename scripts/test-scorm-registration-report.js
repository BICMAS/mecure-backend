/**
 * SCORM registration report extraction and persist checks.
 * Run: node scripts/test-scorm-registration-report.js
 */
import assert from 'node:assert/strict';
import {
    extractScormReportParts,
    fetchScormRegistrationReport,
    persistScormRegistrationReport,
    secondsFromDuration,
} from '../src/lib/scormRegistrationReport.js';

function testExtract() {
    assert.equal(secondsFromDuration('PT10M'), 600);
    assert.equal(secondsFromDuration('0000:00:10.00'), 10);

    const empty = extractScormReportParts({
        registration: { firstAccessDate: '2026-01-02T00:00:00.000Z' },
        progress: {
            activityDetails: {
                id: 'root',
                title: 'Root',
                activityCompletion: 'INCOMPLETE',
                children: [],
            },
        },
        launches: [],
    });
    assert.equal(empty.interactions.length, 0);
    assert.equal(empty.objectives.length, 0);
    assert.equal(empty.comments.length, 0);
    assert.equal(empty.launches.length, 0);
    assert.equal(empty.activities.length, 1);
    assert.equal(empty.activities[0].title, 'Root');
    assert.equal(empty.snapshot.firstAccessAt.toISOString(), '2026-01-02T00:00:00.000Z');
    assert.equal(empty.snapshot.status, undefined);
    assert.equal(empty.snapshot.completionPercentage, undefined);

    const detailed = extractScormReportParts({
        registration: {},
        progress: {
            activityDetails: {
                id: 'root',
                title: 'Root',
                children: [
                    {
                        id: 'quiz',
                        title: 'Quiz',
                        activityCompletion: 'COMPLETED',
                        activitySuccess: 'PASSED',
                        score: { scaled: 0.8 },
                        timeTracked: 'PT15M',
                        runtime: {
                            runtimeInteractions: [
                                {
                                    id: 'q1',
                                    type: 'choice',
                                    description: 'What is planning?',
                                    learnerResponse: 'a',
                                    correctResponses: ['a'],
                                    result: 'correct',
                                    weighting: '1',
                                    latency: 'PT5S',
                                },
                            ],
                            runtimeObjectives: [
                                { id: 'obj-1', successStatus: 'passed', completionStatus: 'completed', score: { scaled: 0.8 } },
                            ],
                            commentsFromLearner: [{ value: 'Clear module', location: '0' }],
                        },
                    },
                ],
            },
        },
        launches: [
            { id: 'launch-1', launchTime: '2026-01-05T00:00:00.000Z', exitTime: '2026-01-05T00:10:00.000Z' },
        ],
    });
    assert.equal(detailed.interactions.length, 1);
    assert.equal(detailed.interactions[0].description, 'What is planning?');
    assert.equal(detailed.interactions[0].result, 'correct');
    assert.equal(detailed.objectives.length, 1);
    assert.equal(detailed.comments.length, 1);
    assert.equal(detailed.activities.find((row) => row.activityId === 'quiz').scorePercent, 80);
    assert.equal(detailed.activities.find((row) => row.activityId === 'quiz').timeTrackedSeconds, 900);
    assert.equal(detailed.launches[0].durationSeconds, 600);
}

function memoryDb() {
    const calls = [];
    const launches = new Set();
    const touch = (model, action, args) => {
        calls.push({ model, action, args });
        return args;
    };
    return {
        calls,
        db: {
            scormAttempt: {
                update: async (args) => touch('scormAttempt', 'update', args),
            },
            scormActivityResult: {
                deleteMany: async (args) => touch('scormActivityResult', 'deleteMany', args),
                createMany: async (args) => touch('scormActivityResult', 'createMany', args),
            },
            scormInteractionResult: {
                deleteMany: async (args) => touch('scormInteractionResult', 'deleteMany', args),
                createMany: async (args) => touch('scormInteractionResult', 'createMany', args),
            },
            scormObjectiveResult: {
                deleteMany: async (args) => touch('scormObjectiveResult', 'deleteMany', args),
                createMany: async (args) => touch('scormObjectiveResult', 'createMany', args),
            },
            scormLearnerComment: {
                deleteMany: async (args) => touch('scormLearnerComment', 'deleteMany', args),
                createMany: async (args) => touch('scormLearnerComment', 'createMany', args),
            },
            scormLaunch: {
                findUnique: async ({ where }) => {
                    const key = where.scormAttemptId_externalId.externalId;
                    return launches.has(key) ? { externalId: key } : null;
                },
                create: async (args) => {
                    launches.add(args.data.externalId);
                    return touch('scormLaunch', 'create', args);
                },
            },
            learnerModuleProgress: {
                update: async () => {
                    throw new Error('reporting must not update module progress');
                },
            },
        },
    };
}

async function testPersistDoesNotChangeCompletion() {
    const { db, calls } = memoryDb();
    const progress = {
        activityDetails: {
            id: 'root',
            title: 'Root',
            children: [],
        },
    };
    const launches = [{ id: 'launch-1', launchTime: '2026-01-05T00:00:00.000Z', experiencedDurationTracked: 'PT10M' }];
    await persistScormRegistrationReport(db, {
        scormAttemptId: 'scorm-1',
        registration: {
            firstAccessDate: '2026-01-02T00:00:00.000Z',
            registrationCompletion: 'INCOMPLETE',
        },
        progress,
        launches,
    });
    await persistScormRegistrationReport(db, {
        scormAttemptId: 'scorm-1',
        registration: { firstAccessDate: '2026-01-02T00:00:00.000Z' },
        progress,
        launches,
    });

    const update = calls.find((call) => call.model === 'scormAttempt');
    assert.equal(update.args.data.status, undefined);
    assert.equal(update.args.data.completionPercentage, undefined);
    assert.equal(update.args.data.registrationCompletion, 'INCOMPLETE');
    assert.equal(calls.some((call) => call.model === 'learnerModuleProgress'), false);
    assert.equal(calls.filter((call) => call.model === 'scormInteractionResult' && call.action === 'createMany').length, 0);
    assert.equal(calls.filter((call) => call.model === 'scormLaunch' && call.action === 'create').length, 1);
}

async function testFetchFallsBack() {
    const calls = [];
    const cloud = {
        async getRegistrationProgress(_id, flags) {
            calls.push(flags);
            if (flags.includeInteractionsAndObjectives) {
                const error = new Error('unsupported');
                error.response = { status: 400 };
                throw error;
            }
            return { activityDetails: { id: 'root', title: 'Root' } };
        },
        async getRegistrationLaunchHistory() {
            return { launchHistory: [] };
        },
    };
    const result = await fetchScormRegistrationReport('reg-1', cloud);
    assert.equal(result.progress.activityDetails.id, 'root');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].includeInteractionsAndObjectives, undefined);
}

async function main() {
    testExtract();
    await testPersistDoesNotChangeCompletion();
    await testFetchFallsBack();
    console.log('scorm registration report tests passed');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
