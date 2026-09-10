/**
 * Unit checks for course topic category name/slug helpers (no DB required).
 * Run: node scripts/test-course-category.js
 */
import assert from 'node:assert/strict';
import {
    SEED_COURSE_CATEGORIES,
    normalizeCategoryName,
    slugifyCategoryName,
    parseCategoryCreateInput,
    courseCategoryPublicFields,
} from '../src/lib/courseCategory.js';

function testSlugify() {
    assert.equal(slugifyCategoryName('Safety'), 'safety');
    assert.equal(slugifyCategoryName('Soft Skills'), 'soft-skills');
    assert.equal(slugifyCategoryName('  Fire Safety  '), 'fire-safety');
    assert.equal(slugifyCategoryName('IT'), 'it');
    assert.equal(slugifyCategoryName('Onboarding!'), 'onboarding');
}

function testNormalizeName() {
    assert.equal(normalizeCategoryName('  Safety  '), 'Safety');
}

function testRejectEmptyName() {
    assert.throws(() => parseCategoryCreateInput({ name: '' }), /required/i);
    assert.throws(() => parseCategoryCreateInput({ name: '   ' }), /required/i);
    assert.throws(() => parseCategoryCreateInput({}), /required/i);
}

function testParseCreateInput() {
    const parsed = parseCategoryCreateInput({ name: '  Soft Skills  ' });
    assert.equal(parsed.name, 'Soft Skills');
    assert.equal(parsed.slug, 'soft-skills');
}

function testPublicCategoryFields() {
    assert.equal(courseCategoryPublicFields(null), null);
    assert.deepEqual(courseCategoryPublicFields({
        id: 'cat-1',
        name: 'Safety',
        slug: 'safety',
    }), {
        id: 'cat-1',
        name: 'Safety',
        slug: 'safety',
    });
    assert.deepEqual(courseCategoryPublicFields('Soft Skills'), {
        id: 'Soft Skills',
        name: 'Soft Skills',
        slug: 'soft-skills',
    });
}

function testSeedTopics() {
    const names = SEED_COURSE_CATEGORIES.map((item) => item.name);
    assert.deepEqual(names, [
        'Onboarding',
        'Safety',
        'Compliance',
        'Clinical',
        'Soft Skills',
        'IT',
    ]);
    for (const item of SEED_COURSE_CATEGORIES) {
        assert.equal(item.slug, slugifyCategoryName(item.name));
    }
}

const tests = [
    testSlugify,
    testNormalizeName,
    testRejectEmptyName,
    testParseCreateInput,
    testPublicCategoryFields,
    testSeedTopics,
];

for (const test of tests) {
    test();
    console.log(`ok ${test.name}`);
}

console.log(`\n${tests.length} course category tests passed`);
