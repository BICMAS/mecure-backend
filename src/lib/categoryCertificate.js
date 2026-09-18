/**
 * Category-level certificate eligibility helpers (pure where possible).
 */

/**
 * @param {Array<{ courseId: string, categoryId: string | null, complete: boolean, passed: boolean }>} courseStates
 * @param {string} categoryId
 */
export function summarizeCategoryEligibility(courseStates, categoryId) {
    const inCategory = (courseStates || []).filter(
        (row) => row?.categoryId && row.categoryId === categoryId,
    );

    const assignedCount = inCategory.length;
    const completedPassed = inCategory.filter((row) => row.complete && row.passed);
    const completedCount = completedPassed.length;
    const eligible = assignedCount > 0 && completedCount === assignedCount;

    return {
        categoryId,
        assignedCount,
        completedCount,
        eligible,
        incompleteCourseIds: inCategory
            .filter((row) => !(row.complete && row.passed))
            .map((row) => row.courseId),
    };
}

/**
 * Template resolution for topic certificates.
 * Prefer category template; else first assigned course template (stable by title).
 *
 * @param {{ categoryTemplateId?: string | null, courseTemplates?: Array<{ courseId: string, title?: string, templateId?: string | null }> }} args
 */
export function resolveCategoryIssuanceTemplateId({
    categoryTemplateId = null,
    courseTemplates = [],
} = {}) {
    if (categoryTemplateId) return categoryTemplateId;

    const withTemplate = [...(courseTemplates || [])]
        .filter((row) => typeof row?.templateId === 'string' && row.templateId.trim())
        .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, {
            sensitivity: 'base',
        }));

    return withTemplate[0]?.templateId ?? null;
}

/**
 * When a course template is assigned, optionally seed the category template
 * if the category does not already have one.
 */
export function shouldSeedCategoryTemplateFromCourse({
    categoryTemplateId = null,
    courseTemplateId = null,
} = {}) {
    if (!courseTemplateId) return false;
    return !categoryTemplateId;
}
