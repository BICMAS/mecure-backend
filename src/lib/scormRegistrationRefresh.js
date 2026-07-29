import { getAssignmentCompletionState } from './courseCompletion.js';

/**
 * SCORM Cloud registrations are pinned to the course version active at creation
 * time. When admins upload a new package version (pkg.uploadedAt advances),
 * in-progress learners need a fresh registration to see new SCOs.
 */
export function isPackageNewerThanRegistration(pkg, scormAttempt) {
    if (!pkg?.uploadedAt || !scormAttempt?.createdAt) {
        return false;
    }

    return new Date(pkg.uploadedAt).getTime() > new Date(scormAttempt.createdAt).getTime();
}

export async function shouldRefreshRegistrationForPackageVersion(
    pkg,
    scormAttempt,
    userId,
    options = {},
) {
    if (!scormAttempt?.scormCloudRegistrationId) {
        return false;
    }

    if (options.forceNewRegistration || options.preserveOfficialAttempt) {
        return false;
    }

    if (!isPackageNewerThanRegistration(pkg, scormAttempt)) {
        return false;
    }

    if (!options.courseId) {
        return true;
    }

    const completionState = await getAssignmentCompletionState(userId, options.courseId);
    if (completionState.complete && completionState.passed) {
        return false;
    }

    return true;
}
