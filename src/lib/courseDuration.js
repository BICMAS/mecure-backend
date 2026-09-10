export const MAX_DURATION_MINUTES = 10080;

export function parseDurationEstimate(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_DURATION_MINUTES) {
        throw new Error(`Duration estimate must be between 1 and ${MAX_DURATION_MINUTES} minutes`);
    }

    return Math.round(parsed);
}

export function formatDurationLabel(minutes) {
    if (minutes == null || !Number.isFinite(Number(minutes)) || Number(minutes) <= 0) {
        return null;
    }

    const total = Math.round(Number(minutes));
    const hours = Math.floor(total / 60);
    const mins = total % 60;

    if (hours === 0) return `${mins} min`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
}

export function formatCourseDurationFields(course = {}) {
    const durationEstimate = course.durationEstimate ?? null;
    return {
        durationEstimate,
        durationLabel: formatDurationLabel(durationEstimate),
    };
}
