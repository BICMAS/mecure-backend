/**
 * Decide which learners in the selected batches should receive a course.
 * Learners with no batch are never included. Already-assigned learners are skipped.
 */
export function planBatchCourseAssignment({ batches, learners, existingAssigneeIds }) {
    const batchIds = new Set(batches.map((batch) => batch.id));
    const learnersByBatch = new Map(batches.map((batch) => [batch.id, []]));
    const seen = new Set();

    for (const learner of learners) {
        if (!learner?.id || !learner.batchId || !batchIds.has(learner.batchId)) {
            continue;
        }
        if (seen.has(learner.id)) {
            continue;
        }
        seen.add(learner.id);
        learnersByBatch.get(learner.batchId).push(learner.id);
    }

    const emptyBatchIds = batches
        .filter((batch) => learnersByBatch.get(batch.id).length === 0)
        .map((batch) => batch.id);

    const existing = new Set(existingAssigneeIds);
    const toAssign = [];
    const skipped = [];

    for (const learnerId of seen) {
        if (existing.has(learnerId)) {
            skipped.push(learnerId);
        } else {
            toAssign.push(learnerId);
        }
    }

    return { toAssign, skipped, emptyBatchIds };
}
