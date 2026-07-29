/**
 * Match incoming module/lesson payloads to existing DB rows without duplicating.
 * Preserves stable module ids (and learnerModuleProgress links) when the admin
 * UI sends client-generated ids or expands module count (e.g. 2 → 4).
 */

const CUID_PATTERN = /^c[a-z0-9]{19,24}$/i;

export function isPersistedId(id) {
    return typeof id === 'string'
        && id.length >= 20
        && id.length <= 25
        && CUID_PATTERN.test(id);
}

export function sortModulesForUpsert(modules = []) {
    return [...modules]
        .map((module, index) => ({
            ...module,
            sortOrder: module.sortOrder ?? index,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Returns { updates, creates, deleteIds } for modules.
 * Position-based matching preserves existing ids when payload ids are unknown.
 */
export function planModuleUpsert(existingModules, modulesPayload) {
    const existing = sortModulesForUpsert(existingModules);
    const payload = sortModulesForUpsert(modulesPayload);

    const existingById = new Map(existing.map((module) => [module.id, module]));
    const claimedExistingIds = new Set();

    const updates = [];
    const creates = [];
    const unmatchedPayload = [];

    for (const modulePayload of payload) {
        if (isPersistedId(modulePayload.id) && existingById.has(modulePayload.id)) {
            updates.push({
                existingId: modulePayload.id,
                data: modulePayload,
            });
            claimedExistingIds.add(modulePayload.id);
        } else {
            unmatchedPayload.push(modulePayload);
        }
    }

    const remainingExisting = existing.filter((module) => !claimedExistingIds.has(module.id));

    for (let index = 0; index < unmatchedPayload.length; index += 1) {
        const modulePayload = unmatchedPayload[index];
        const existingAtIndex = remainingExisting[index];

        if (existingAtIndex) {
            updates.push({
                existingId: existingAtIndex.id,
                data: modulePayload,
            });
            claimedExistingIds.add(existingAtIndex.id);
        } else {
            creates.push(modulePayload);
        }
    }

    const deleteIds = existing
        .filter((module) => !claimedExistingIds.has(module.id))
        .map((module) => module.id);

    return { updates, creates, deleteIds };
}

export function planLessonUpsert(existingLessons, lessonsPayload = []) {
    const existing = [...(existingLessons ?? [])].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const payload = [...(lessonsPayload ?? [])];

    const existingById = new Map(existing.map((lesson) => [lesson.id, lesson]));
    const claimedExistingIds = new Set();

    const updates = [];
    const creates = [];
    const unmatchedPayload = [];

    for (const lessonPayload of payload) {
        if (isPersistedId(lessonPayload.id) && existingById.has(lessonPayload.id)) {
            updates.push({
                existingId: lessonPayload.id,
                data: lessonPayload,
            });
            claimedExistingIds.add(lessonPayload.id);
        } else {
            unmatchedPayload.push(lessonPayload);
        }
    }

    const remainingExisting = existing.filter((lesson) => !claimedExistingIds.has(lesson.id));

    for (let index = 0; index < unmatchedPayload.length; index += 1) {
        const lessonPayload = unmatchedPayload[index];
        const existingAtIndex = remainingExisting[index];

        if (existingAtIndex) {
            updates.push({
                existingId: existingAtIndex.id,
                data: lessonPayload,
            });
            claimedExistingIds.add(existingAtIndex.id);
        } else {
            creates.push(lessonPayload);
        }
    }

    const deleteIds = existing
        .filter((lesson) => !claimedExistingIds.has(lesson.id))
        .map((lesson) => lesson.id);

    return { updates, creates, deleteIds };
}
