export const COURSE_LOCKED_MESSAGE = 'This course is locked by admin';

export function isCourseLocked(course) {
    return Boolean(course?.isLocked);
}

export function assertCourseUnlocked(course) {
    if (isCourseLocked(course)) {
        throw new Error(COURSE_LOCKED_MESSAGE);
    }
}

export function assertLearnerCourseUnlocked(course, userRole) {
    if (userRole && userRole !== 'LEARNER') {
        return;
    }
    assertCourseUnlocked(course);
}

export function buildLockUpdate(actorId, now = new Date()) {
    return {
        isLocked: true,
        lockedAt: now,
        lockedBy: actorId,
    };
}

export function buildUnlockUpdate() {
    return {
        isLocked: false,
        lockedAt: null,
        lockedBy: null,
    };
}

export function formatCourseLockFields(course = {}) {
    return {
        isLocked: Boolean(course.isLocked),
        lockedAt: course.lockedAt ?? null,
        lockedBy: course.lockedBy ?? null,
    };
}
