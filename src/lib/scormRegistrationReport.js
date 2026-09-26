import { computeScorePercent } from '../utils/scormScore.js';

const PROGRESS_FLAG_SETS = [
    { includeChildResults: true, includeRuntime: true, includeInteractionsAndObjectives: true },
    { includeChildResults: true, includeRuntime: true },
    { includeChildResults: true },
];

function dateOrNull(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function secondsFromDuration(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const text = String(value).trim();
    if (/^\d+(\.\d+)?$/.test(text)) return Number(text);

    const iso = text.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
    if (iso && (iso[1] || iso[2] || iso[3])) {
        return (Number(iso[1] || 0) * 3600) + (Number(iso[2] || 0) * 60) + Number(iso[3] || 0);
    }

    const cmi = text.match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
    if (cmi) {
        return (Number(cmi[1]) * 3600) + (Number(cmi[2]) * 60) + Number(cmi[3]);
    }
    return null;
}

function scorePercentFrom(score) {
    if (score == null || score === '') return null;
    if (typeof score === 'number' || typeof score === 'string') {
        return computeScorePercent(score, null);
    }
    return computeScorePercent(score.raw, score.scaled, score.max ?? 100, score.min ?? 0);
}

function textOrNull(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text || null;
}

function flattenActivities(node, bucket = []) {
    if (!node) return bucket;
    const nodes = Array.isArray(node) ? node : [node];
    for (const activity of nodes) {
        if (!activity || typeof activity !== 'object') continue;
        const activityId = activity.id || activity.activityId;
        if (activityId) bucket.push(activity);
        const children = activity.children || activity.childActivities;
        if (Array.isArray(children) && children.length) flattenActivities(children, bucket);
    }
    return bucket;
}

function listFrom(activity, runtimeKey, directKey) {
    const runtimeList = activity.runtime?.[runtimeKey];
    if (Array.isArray(runtimeList) && runtimeList.length) return runtimeList;
    const directList = activity[directKey];
    return Array.isArray(directList) ? directList : [];
}

function snapshotFrom(registration = {}, progress = null) {
    const source = progress && typeof progress === 'object' ? progress : {};
    const snapshot = {};
    const firstAccessAt = dateOrNull(registration.firstAccessDate || source.firstAccessDate);
    const lastAccessAt = dateOrNull(registration.lastAccessDate || source.lastAccessDate);
    const completedAt = dateOrNull(registration.completedDate || source.completedDate);
    const registrationCompletion = textOrNull(registration.registrationCompletion || source.registrationCompletion);
    const registrationSuccess = textOrNull(registration.registrationSuccess || source.registrationSuccess);
    if (firstAccessAt) snapshot.firstAccessAt = firstAccessAt;
    if (lastAccessAt) snapshot.lastAccessAt = lastAccessAt;
    if (completedAt) snapshot.completedAt = completedAt;
    if (registrationCompletion) snapshot.registrationCompletion = registrationCompletion;
    if (registrationSuccess) snapshot.registrationSuccess = registrationSuccess;
    return snapshot;
}

function activityRows(progress) {
    const seen = new Map();
    for (const activity of flattenActivities(progress?.activityDetails)) {
        const activityId = String(activity.id || activity.activityId);
        seen.set(activityId, {
            activityId,
            title: textOrNull(activity.title) || activityId,
            completion: textOrNull(activity.activityCompletion || activity.completionStatus || activity.runtime?.completionStatus),
            success: textOrNull(activity.activitySuccess || activity.successStatus || activity.runtime?.successStatus),
            scorePercent: activity.score != null
                ? scorePercentFrom(activity.score)
                : computeScorePercent(activity.runtime?.scoreRaw, activity.runtime?.scoreScaled),
            timeTrackedSeconds: secondsFromDuration(activity.timeTracked || activity.runtime?.totalTime),
        });
    }
    return [...seen.values()];
}

function interactionRows(progress) {
    const rows = [];
    const seen = new Set();
    for (const activity of flattenActivities(progress?.activityDetails)) {
        const activityId = String(activity.id || activity.activityId || '');
        const interactions = listFrom(activity, 'runtimeInteractions', 'interactions');
        interactions.forEach((interaction, index) => {
            if (!interaction || typeof interaction !== 'object') return;
            const interactionId = String(interaction.id || interaction.interactionId || index);
            const key = `${activityId}:${interactionId}`;
            if (seen.has(key)) return;
            seen.add(key);
            const weighting = interaction.weighting == null || interaction.weighting === ''
                ? null
                : Number(interaction.weighting);
            rows.push({
                activityId,
                interactionId,
                interactionType: textOrNull(interaction.type || interaction.interactionType),
                description: textOrNull(interaction.description),
                learnerResponse: interaction.learnerResponse ?? null,
                correctResponse: interaction.correctResponses ?? interaction.correctResponse ?? null,
                result: textOrNull(interaction.result),
                weighting: Number.isFinite(weighting) ? weighting : null,
                latency: textOrNull(interaction.latency),
            });
        });
    }
    return rows;
}

function objectiveRows(progress) {
    const rows = [];
    const seen = new Set();
    for (const activity of flattenActivities(progress?.activityDetails)) {
        const activityId = String(activity.id || activity.activityId || '');
        const objectives = listFrom(activity, 'runtimeObjectives', 'objectives');
        for (const objective of objectives) {
            if (!objective || typeof objective !== 'object') continue;
            const objectiveId = objective.id || objective.objectiveId;
            if (!objectiveId) continue;
            const key = `${activityId}:${objectiveId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push({
                activityId,
                objectiveId: String(objectiveId),
                success: textOrNull(objective.successStatus || objective.success),
                completion: textOrNull(objective.completionStatus || objective.completion),
                scorePercent: objective.score != null
                    ? scorePercentFrom(objective.score)
                    : computeScorePercent(null, objective.scoreScaled),
            });
        }
    }
    return rows;
}

function commentRows(progress) {
    const rows = [];
    for (const activity of flattenActivities(progress?.activityDetails)) {
        const activityId = String(activity.id || activity.activityId || '');
        const comments = listFrom(activity, 'commentsFromLearner', 'commentsFromLearner');
        let commentIndex = 0;
        for (const item of comments) {
            const comment = textOrNull(typeof item === 'string' ? item : item?.comment || item?.value);
            if (!comment) continue;
            rows.push({
                activityId,
                commentIndex,
                comment,
                location: textOrNull(item?.location),
                commentedAt: dateOrNull(item?.dateTime || item?.timestamp),
            });
            commentIndex += 1;
        }
    }
    return rows;
}

function launchRows(launches) {
    const list = Array.isArray(launches) ? launches : (launches?.launchHistory || []);
    const rows = [];
    const seen = new Set();
    for (const launch of list) {
        if (!launch || typeof launch !== 'object') continue;
        const launchedAt = dateOrNull(launch.launchTime || launch.launchedAt);
        if (!launchedAt) continue;
        const externalId = String(launch.id || launch.launchId || launchedAt.toISOString());
        if (seen.has(externalId)) continue;
        seen.add(externalId);
        const exitAt = dateOrNull(launch.exitTime);
        let durationSeconds = secondsFromDuration(launch.experiencedDurationTracked || launch.duration);
        if (durationSeconds == null && exitAt) {
            const seconds = (exitAt.getTime() - launchedAt.getTime()) / 1000;
            durationSeconds = seconds > 0 ? seconds : null;
        }
        rows.push({ externalId, launchedAt, durationSeconds });
    }
    return rows;
}

export function extractScormReportParts({ registration = {}, progress = null, launches = [] } = {}) {
    const hasProgress = progress && typeof progress === 'object';
    return {
        snapshot: snapshotFrom(registration, hasProgress ? progress : null),
        activities: hasProgress ? activityRows(progress) : [],
        interactions: hasProgress ? interactionRows(progress) : [],
        objectives: hasProgress ? objectiveRows(progress) : [],
        comments: hasProgress ? commentRows(progress) : [],
        launches: launchRows(launches),
        hasProgress,
    };
}

async function replaceChildRows(db, model, scormAttemptId, rows) {
    await db[model].deleteMany({ where: { scormAttemptId } });
    if (rows.length > 0) {
        await db[model].createMany({
            data: rows.map((row) => ({ ...row, scormAttemptId })),
        });
    }
}

export async function persistScormRegistrationReport(db, { scormAttemptId, registration, progress, launches }) {
    const parts = extractScormReportParts({ registration, progress, launches });
    if (Object.keys(parts.snapshot).length > 0) {
        await db.scormAttempt.update({
            where: { id: scormAttemptId },
            data: parts.snapshot,
        });
    }

    if (parts.hasProgress) {
        await replaceChildRows(db, 'scormActivityResult', scormAttemptId, parts.activities);
        await replaceChildRows(db, 'scormInteractionResult', scormAttemptId, parts.interactions);
        await replaceChildRows(db, 'scormObjectiveResult', scormAttemptId, parts.objectives);
        await replaceChildRows(db, 'scormLearnerComment', scormAttemptId, parts.comments);
    }

    for (const launch of parts.launches) {
        const existing = await db.scormLaunch.findUnique({
            where: {
                scormAttemptId_externalId: {
                    scormAttemptId,
                    externalId: launch.externalId,
                },
            },
        });
        if (existing) continue;
        await db.scormLaunch.create({
            data: { scormAttemptId, ...launch },
        });
    }

    return parts;
}

function statusOf(error) {
    return error?.response?.status ?? error?.status ?? null;
}

export async function fetchScormRegistrationReport(registrationId, cloud) {
    let progress = null;
    let progressError = null;
    for (const flags of PROGRESS_FLAG_SETS) {
        try {
            progress = await cloud.getRegistrationProgress(registrationId, flags);
            progressError = null;
            break;
        } catch (error) {
            progressError = error;
            const status = statusOf(error);
            if (status !== 400 && status !== 422) break;
        }
    }
    if (!progress && progressError) {
        console.error('[SCORM REPORT] progress fetch failed:', progressError.message || progressError);
    }

    let launches = [];
    try {
        const history = await cloud.getRegistrationLaunchHistory(registrationId);
        launches = history?.launchHistory || [];
    } catch (error) {
        const status = statusOf(error);
        if (status !== 400 && status !== 404) {
            console.error('[SCORM REPORT] launch history failed:', error.message || error);
        }
    }

    return { progress, launches };
}
