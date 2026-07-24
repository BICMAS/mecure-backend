export function mapScormStatus(scormStatus) {
    switch (scormStatus?.toLowerCase()) {
        case 'passed':
            return 'PASSED';
        case 'completed':
            return 'COMPLETED';
        case 'failed':
            return 'FAILED';
        case 'incomplete':
        case 'browsed':
            return 'INCOMPLETE';
        default:
            return 'IN_PROGRESS';
    }
}

export function computeScorePercent(raw, scaled, max = 100, min = 0) {
    if (raw != null && Number.isFinite(Number(raw)) && max > min) {
        return Math.min(100, Math.max(0, Math.round(((Number(raw) - min) / (max - min)) * 100)));
    }
    if (scaled != null && Number.isFinite(Number(scaled))) {
        const normalized = Number(scaled);
        return Math.min(100, Math.max(0, Math.round(normalized <= 1 ? normalized * 100 : normalized)));
    }
    if (raw != null && Number.isFinite(Number(raw))) {
        return Math.min(100, Math.max(0, Math.round(Number(raw))));
    }
    return null;
}

export function normalizeScormRegistration(registration = {}) {
    const scoreRaw = registration.score?.raw ?? null;
    const scoreScaled = registration.score?.scaled ?? null;
    const scoreMax = registration.score?.max ?? 100;
    const scoreMin = registration.score?.min ?? 0;
    const scorePercent = computeScorePercent(scoreRaw, scoreScaled, scoreMax, scoreMin);

    const completionAmount = registration.registrationCompletionAmount ?? 0;
    const completionPercentage = Math.round(completionAmount * 100);

    let status = 'IN_PROGRESS';
    if (registration.success === 'FAILED') {
        status = 'FAILED';
    } else if (registration.success === 'PASSED') {
        status = 'PASSED';
    } else if (
        registration.registrationCompletion === 'COMPLETED'
        && completionPercentage >= 100
    ) {
        status = 'COMPLETED';
    }

    const passed = registration.success === 'PASSED' || scorePercent === 100;

    return {
        status,
        completionPercentage,
        scormCloudCompletion: completionAmount,
        scoreRaw,
        scoreScaled,
        scoreMax,
        scoreMin,
        scorePercent,
        passed,
        learningHours: registration.totalSecondsTracked
            ? registration.totalSecondsTracked / 3600
            : null,
    };
}

export function normalizeCallbackPayload(body = {}, fallbackCompletion = 0) {
    const parsedScore = body.score != null && body.score !== ''
        ? parseFloat(body.score)
        : null;
    const scoreMax = body.score_max != null ? parseFloat(body.score_max) : 100;
    const scoreMin = body.score_min != null ? parseFloat(body.score_min) : 0;
    const scorePercent = computeScorePercent(parsedScore, null, scoreMax, scoreMin);

    let completionPercentage = Math.min(
        100,
        Math.max(0, Math.round(Number(fallbackCompletion) || 0)),
    );
    if (body.completion_amount != null && body.completion_amount !== '') {
        completionPercentage = Math.min(
            100,
            Math.max(0, Math.round(parseFloat(body.completion_amount) * 100)),
        );
    }
    // Do not infer 100% from completion_status alone — exit callbacks often send
    // "completed" without a reliable completion_amount.

    const mappedStatus = mapScormStatus(body.completion_status || body.success_status);
    const passed = body.success_status?.toLowerCase() === 'passed' || scorePercent === 100;

    return {
        status: mappedStatus,
        completionPercentage,
        scormCloudCompletion: completionPercentage / 100,
        scoreRaw: Number.isFinite(parsedScore) ? parsedScore : null,
        scoreScaled: scorePercent != null ? scorePercent / 100 : null,
        scoreMax,
        scoreMin,
        scorePercent,
        passed,
        learningHours: body.total_seconds ? parseFloat(body.total_seconds) / 3600 : null,
    };
}

export function buildScoreRecordFromAttempt(attempt, scormPackage, course = null) {
    const title = scormPackage?.filename?.replace(/\.zip$/i, '') || 'SCORM Module';
    const scorePercent = computeScorePercent(
        attempt.score,
        attempt.scormCloudScoreScaled,
        100,
        0,
    );

    return {
        scormAttemptId: attempt.id,
        scormPackageId: attempt.scormPackageId,
        courseId: course?.id ?? attempt.attempt?.courseId ?? null,
        courseTitle: course?.title ?? null,
        title,
        completionPercent: Math.round(attempt.completionPercentage ?? 0),
        scorePercent,
        scoreRaw: attempt.score,
        scoreScaled: attempt.scormCloudScoreScaled,
        passed: attempt.status === 'PASSED' || scorePercent === 100,
        status: attempt.status,
        lastSyncedAt: attempt.scormCloudLastSyncAt || attempt.updatedAt,
    };
}

export async function applyPerfectQuizAward(userId, scormPackageId, scorePercent, EconomyService) {
    if (scorePercent === 100 && scormPackageId) {
        await EconomyService.onPerfectQuiz(userId, scormPackageId);
    }
}
