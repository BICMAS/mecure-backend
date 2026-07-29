/**
 * Unit-style checks for module/lesson upsert planning (no DB required).
 * Run: node scripts/test-module-upsert.js
 */
import assert from 'node:assert/strict';
import {
    isPersistedId,
    planLessonUpsert,
    planModuleUpsert,
} from '../src/lib/courseModuleUpsert.js';

function testIsPersistedId() {
    assert.equal(isPersistedId('clmod1111111111111111111'), true);
    assert.equal(isPersistedId('abc123'), false);
    assert.equal(isPersistedId('mod-1'), false);
}

function testExpandModulesPreservesExistingIds() {
    const existing = [
        { id: 'clmod1111111111111111111', sortOrder: 0, createdAt: '2024-01-01' },
        { id: 'clmod2222222222222222222', sortOrder: 1, createdAt: '2024-01-02' },
    ];

    const payload = [
        { id: 'random1', name: 'Module 1', sortOrder: 0 },
        { id: 'random2', name: 'Module 2', sortOrder: 1 },
        { id: 'random3', name: 'Module 3', sortOrder: 2 },
        { id: 'random4', name: 'Module 4', sortOrder: 3 },
    ];

    const plan = planModuleUpsert(existing, payload);

    assert.equal(plan.updates.length, 2);
    assert.equal(plan.creates.length, 2);
    assert.equal(plan.deleteIds.length, 0);
    assert.equal(plan.updates[0].existingId, 'clmod1111111111111111111');
    assert.equal(plan.updates[1].existingId, 'clmod2222222222222222222');
}

function testExplicitIdMatch() {
    const existing = [
        { id: 'clmod1111111111111111111', sortOrder: 0, createdAt: '2024-01-01' },
        { id: 'clmod2222222222222222222', sortOrder: 1, createdAt: '2024-01-02' },
    ];

    const payload = [
        { id: 'clmod2222222222222222222', name: 'Renamed 2', sortOrder: 0 },
        { id: 'clmod1111111111111111111', name: 'Renamed 1', sortOrder: 1 },
    ];

    const plan = planModuleUpsert(existing, payload);
    assert.equal(plan.updates.length, 2);
    assert.equal(plan.creates.length, 0);
    assert.equal(plan.deleteIds.length, 0);
}

function testRemoveModuleExplicitly() {
    const existing = [
        { id: 'clmod1111111111111111111', sortOrder: 0, createdAt: '2024-01-01' },
        { id: 'clmod2222222222222222222', sortOrder: 1, createdAt: '2024-01-02' },
    ];

    const payload = [
        { id: 'clmod1111111111111111111', name: 'Module 1', sortOrder: 0 },
    ];

    const plan = planModuleUpsert(existing, payload);
    assert.deepEqual(plan.deleteIds, ['clmod2222222222222222222']);
}

function testLessonPositionMatch() {
    const existing = [
        { id: 'clles1111111111111111111', createdAt: '2024-01-01' },
    ];
    const payload = [{ id: 'tmp', title: 'Lesson A' }, { title: 'Lesson B' }];

    const plan = planLessonUpsert(existing, payload);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.creates.length, 1);
    assert.equal(plan.updates[0].existingId, 'clles1111111111111111111');
}

function run() {
    testIsPersistedId();
    testExpandModulesPreservesExistingIds();
    testExplicitIdMatch();
    testRemoveModuleExplicitly();
    testLessonPositionMatch();
    console.log('All module upsert planning tests passed.');
}

run();
