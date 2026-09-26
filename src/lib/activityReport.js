const COMPLETED_STATUSES = new Set(['COMPLETED', 'PASSED']);

const DEPARTMENTS = new Set([
    'HR',
    'SALES',
    'MARKETING',
    'FINANCE',
    'OPERATIONS',
    'IT',
    'CUSTOMER_SUPPORT',
    'LEGAL',
    'ADMINISTRATION',
]);

export const ACTIVITY_REPORT_CSV_COLUMNS = [
    'Trainee',
    'Email',
    'Batch',
    'Department',
    'Assigned courses',
    'Average progress',
    'Average score',
    'Learning hours',
    'Overdue',
    'Module progress',
    'SCORM attempts',
    'Certificates',
    'Quiz attempts',
    'Field tasks',
    'Points',
    'Points awarded',
    'Courses',
];

function round2(value) {
    return Math.round(Number(value) * 100) / 100;
}

function average(values) {
    if (!values.length) return null;
    return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function parseDay(value, endOfDay) {
    if (value == null || value === '') return null;
    const text = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw new Error('Invalid date');
    }
    const date = new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    if (Number.isNaN(date.getTime())) {
        throw new Error('Invalid date');
    }
    return date;
}

export function parseActivityReportQuery(query = {}) {
    const batchId = typeof query.batchId === 'string' ? query.batchId.trim() : '';
    const department = typeof query.department === 'string' ? query.department.trim().toUpperCase() : '';
    const from = parseDay(query.from, false);
    const to = parseDay(query.to, true);

    if (department && department !== 'ALL' && !DEPARTMENTS.has(department)) {
        throw new Error('Unknown department');
    }
    if (from && to && from.getTime() > to.getTime()) {
        throw new Error('Start date must be on or before the end date');
    }

    const normalizedBatch = !batchId || batchId.toLowerCase() === 'all' ? null : batchId;
    return {
        batchId: normalizedBatch,
        department: !department || department === 'ALL' ? null : department,
        from,
        to,
        breakdown: normalizedBatch ? 'department' : 'batch',
    };
}

function inRange(value, from, to) {
    if (!from && !to) return true;
    if (!value) return false;
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return false;
    if (from && time < from.getTime()) return false;
    if (to && time > to.getTime()) return false;
    return true;
}

function batchLabel(learner) {
    return learner.batchName || 'Unassigned';
}

function emptyTotals() {
    return {
        trainees: 0,
        assignedCourses: 0,
        averageProgress: 0,
        averageScore: null,
        learningHours: 0,
        overdueCourses: 0,
        moduleProgressCompleted: 0,
        moduleProgressTracked: 0,
        scormAttempts: 0,
        certificates: 0,
        quizAttempts: 0,
        fieldTasks: 0,
        points: 0,
        pointsAwarded: 0,
    };
}

function rate(part, whole) {
    if (!whole) return 0;
    return round2((part / whole) * 100);
}

function sumTotals(trainees) {
    const totals = emptyTotals();
    totals.trainees = trainees.length;
    const progressValues = [];
    const scoreValues = [];
    let startedCourses = 0;
    let completedCourses = 0;
    let passedCourses = 0;

    for (const trainee of trainees) {
        totals.assignedCourses += trainee.assignedCourses;
        totals.learningHours = round2(totals.learningHours + trainee.learningHours);
        totals.overdueCourses += trainee.overdueCourses;
        totals.moduleProgressCompleted += trainee.moduleProgressCompleted;
        totals.moduleProgressTracked += trainee.moduleProgressTracked;
        totals.scormAttempts += trainee.scormAttempts;
        totals.certificates += trainee.certificates;
        totals.quizAttempts += trainee.quizAttempts;
        totals.fieldTasks += trainee.fieldTasks;
        totals.points += trainee.points;
        totals.pointsAwarded += trainee.pointsAwarded;
        startedCourses += trainee.startedCourses || 0;
        completedCourses += trainee.completedCourses || 0;
        passedCourses += trainee.passedCourses || 0;
        if (trainee.attemptCount > 0) progressValues.push(trainee.averageProgress);
        if (trainee.averageScore != null) scoreValues.push(trainee.averageScore);
    }

    totals.averageProgress = average(progressValues) ?? 0;
    totals.averageScore = average(scoreValues);
    totals.startedCourses = startedCourses;
    totals.completedCourses = completedCourses;
    totals.passedCourses = passedCourses;
    totals.completionRate = rate(completedCourses, totals.assignedCourses);
    totals.passRate = rate(passedCourses, totals.assignedCourses);
    return totals;
}

function buildBreakdown(trainees, breakdown) {
    const groups = new Map();
    for (const trainee of trainees) {
        const label = breakdown === 'department'
            ? (trainee.department || 'Unassigned')
            : trainee.batch;
        const current = groups.get(label) || [];
        current.push(trainee);
        groups.set(label, current);
    }

    return [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, rows]) => ({
            label,
            ...sumTotals(rows),
        }));
}

export function buildActivityReport({
    learners = [],
    assignments = [],
    attempts = [],
    moduleProgress = [],
    scormAttempts = [],
    certificates = [],
    quizAttempts = [],
    fieldTasks = [],
    coinAwards = [],
    scormRegistrations = [],
    filters,
    now = new Date(),
}) {
    const from = filters?.from ?? null;
    const to = filters?.to ?? null;
    const breakdown = filters?.breakdown === 'department' ? 'department' : 'batch';
    const trainees = buildTraineeRows({
        learners,
        assignments,
        attempts,
        moduleProgress,
        scormAttempts,
        certificates,
        quizAttempts,
        fieldTasks,
        coinAwards,
        from,
        to,
        now,
    });

    const totals = sumTotals(trainees);
    const analytics = buildAnalytics({
        learners,
        trainees,
        totals,
        assignments,
        attempts,
        moduleProgress,
        scormAttempts,
        certificates,
        quizAttempts,
        fieldTasks,
        scormRegistrations,
        from,
        to,
        now,
    });

    return {
        breakdownBy: breakdown,
        totals,
        breakdown: buildBreakdown(trainees, breakdown),
        trainees,
        analytics,
        message: trainees.length === 0 ? 'No trainees match these filters.' : null,
    };
}

const INACTIVE_MS = 14 * 24 * 60 * 60 * 1000;

function timestamp(value) {
    if (!value) return null;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

function monthKey(value) {
    const date = new Date(value);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
    const [year, month] = key.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

function monthsInRange(from, to) {
    const keys = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1);
    while (cursor.getTime() <= end) {
        keys.push(monthKey(cursor));
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return keys;
}

function previousWindow(from, to) {
    if (!from || !to) return null;
    const length = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - length);
    return { from: prevFrom, to: prevTo };
}

function indexTimes(rows, idKey, timeKey) {
    const times = new Map();
    for (const row of rows) {
        const id = row[idKey];
        const time = timestamp(row[timeKey]);
        if (!id || time == null) continue;
        const current = times.get(id) || [];
        current.push(time);
        times.set(id, current);
    }
    return times;
}

function lastActivityBefore(timesByUser, userId, reference) {
    const times = timesByUser.get(userId) || [];
    const limit = reference.getTime();
    let latest = null;
    for (const time of times) {
        if (time <= limit && (latest == null || time > latest)) latest = time;
    }
    return latest;
}

function riskForTrainee(trainee, lastActivity, reference) {
    const inactive = lastActivity == null || (reference.getTime() - lastActivity) >= INACTIVE_MS;
    const daysInactive = lastActivity == null
        ? null
        : Math.floor((reference.getTime() - lastActivity) / (24 * 60 * 60 * 1000));
    const lowProgress = (trainee.assignedCourses > 0 || trainee.attemptCount > 0)
        && trainee.averageProgress < 20;

    if (trainee.overdueCourses > 0) {
        return { reason: 'Overdue courses', daysInactive };
    }
    if (lowProgress) {
        return { reason: 'Progress under 20%', daysInactive };
    }
    if (inactive) {
        return { reason: 'No activity in 14 days', daysInactive };
    }
    return null;
}

function atRiskTrainees(trainees, timesByUser, reference) {
    return trainees.flatMap((trainee) => {
        const risk = riskForTrainee(
            trainee,
            lastActivityBefore(timesByUser, trainee.id, reference),
            reference,
        );
        if (!risk) return [];
        return [{
            id: trainee.id,
            fullName: trainee.fullName,
            batch: trainee.batch,
            department: trainee.department,
            reason: risk.reason,
            daysInactive: risk.daysInactive,
        }];
    });
}

function courseRows(trainees, assignments, attempts, from, to) {
    const learnerIds = new Set(trainees.map((trainee) => trainee.id));
    const courses = new Map();

    for (const assignment of assignments) {
        if (!learnerIds.has(assignment.userId) || !inRange(assignment.createdAt, from, to)) continue;
        const title = assignment.courseTitle || 'Course';
        const course = courses.get(title) || { title, assigned: 0, completed: 0, scores: [] };
        course.assigned += 1;
        const attempt = attempts.find((row) => (
            row.userId === assignment.userId
            && row.courseId === assignment.courseId
            && inRange(row.updatedAt, from, to)
        ));
        if (attempt && COMPLETED_STATUSES.has(attempt.status)) course.completed += 1;
        if (attempt && attempt.scorePercent != null && Number.isFinite(Number(attempt.scorePercent))) {
            course.scores.push(Number(attempt.scorePercent));
        }
        courses.set(title, course);
    }

    return [...courses.values()]
        .map((course) => ({
            title: course.title,
            assigned: course.assigned,
            completionRate: rate(course.completed, course.assigned),
            averageScore: average(course.scores),
        }))
        .sort((a, b) => a.title.localeCompare(b.title));
}

function trendRows(trainees, attempts, from, to) {
    const learnerIds = new Set(trainees.map((trainee) => trainee.id));
    const buckets = new Map();
    const ensure = (key) => {
        const bucket = buckets.get(key) || {
            month: key,
            label: monthLabel(key),
            learners: new Set(),
            learningHours: 0,
            progress: [],
        };
        buckets.set(key, bucket);
        return bucket;
    };

    if (from && to) {
        for (const key of monthsInRange(from, to)) ensure(key);
    }

    for (const attempt of attempts) {
        if (!learnerIds.has(attempt.userId) || !inRange(attempt.updatedAt, from, to) || !attempt.updatedAt) {
            continue;
        }
        const bucket = ensure(monthKey(attempt.updatedAt));
        bucket.learners.add(attempt.userId);
        bucket.learningHours = round2(bucket.learningHours + (Number(attempt.learningHours) || 0));
        bucket.progress.push(Number(attempt.completionPercentage) || 0);
    }

    return [...buckets.values()]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((bucket) => ({
            month: bucket.month,
            label: bucket.label,
            activeLearners: bucket.learners.size,
            learningHours: bucket.learningHours,
            averageProgress: average(bucket.progress) ?? 0,
        }));
}

function scoreBands(trainees, attempts, from, to) {
    const learnerIds = new Set(trainees.map((trainee) => trainee.id));
    const bands = { under50: 0, from50to79: 0, from80: 0 };
    for (const attempt of attempts) {
        if (!learnerIds.has(attempt.userId) || !inRange(attempt.updatedAt, from, to)) continue;
        if (attempt.scorePercent == null || !Number.isFinite(Number(attempt.scorePercent))) continue;
        const score = Number(attempt.scorePercent);
        if (score < 50) bands.under50 += 1;
        else if (score < 80) bands.from50to79 += 1;
        else bands.from80 += 1;
    }
    return bands;
}

function scormPanels(trainees, registrations, attempts, from, to) {
    const names = new Map(trainees.map((trainee) => [trainee.id, trainee.fullName]));
    const included = (registrations || []).filter((row) => (
        names.has(row.userId) && inRange(row.lastAccessAt || row.updatedAt, from, to)
    ));

    const registrationRows = included.map((row) => ({
        id: row.id,
        fullName: names.get(row.userId),
        courseTitle: row.courseTitle || 'Course',
        completion: row.completion || null,
        success: row.success || null,
        scorePercent: row.scorePercent ?? null,
        learningHours: row.learningHours ?? null,
        firstAccessAt: row.firstAccessAt || null,
        lastAccessAt: row.lastAccessAt || null,
    }));

    const activities = included.flatMap((row) => (row.activities || []).map((activity) => ({
        id: `${row.id}:${activity.activityId}`,
        fullName: names.get(row.userId),
        title: activity.title,
        completion: activity.completion || null,
        success: activity.success || null,
        scorePercent: activity.scorePercent ?? null,
        timeTrackedSeconds: activity.timeTrackedSeconds ?? null,
    })));

    const interactionRows = included.flatMap((row) => (row.interactions || []).map((interaction) => ({
        id: `${row.id}:${interaction.activityId || ''}:${interaction.interactionId}`,
        fullName: names.get(row.userId),
        question: interaction.description || interaction.interactionId,
        result: interaction.result || null,
        weighting: interaction.weighting ?? null,
    })));
    const correct = interactionRows.filter((row) => String(row.result || '').toLowerCase() === 'correct').length;
    const incorrect = interactionRows.filter((row) => String(row.result || '').toLowerCase() === 'incorrect').length;

    const objectives = included.flatMap((row) => (row.objectives || []).map((objective) => ({
        id: `${row.id}:${objective.activityId || ''}:${objective.objectiveId}`,
        fullName: names.get(row.userId),
        objectiveId: objective.objectiveId,
        success: objective.success || null,
        completion: objective.completion || null,
        scorePercent: objective.scorePercent ?? null,
    })));

    const comments = included.flatMap((row) => (row.comments || []).map((comment, index) => ({
        id: `${row.id}:${index}`,
        fullName: names.get(row.userId),
        comment: comment.comment,
    })));

    let launchCount = 0;
    let launchSeconds = 0;
    for (const row of registrations || []) {
        if (!names.has(row.userId)) continue;
        for (const launch of row.launches || []) {
            if (!inRange(launch.launchedAt, from, to)) continue;
            launchCount += 1;
            launchSeconds += Number(launch.durationSeconds) || 0;
        }
    }

    return {
        registrations: registrationRows,
        activities,
        interactions: { correct, incorrect, rows: interactionRows },
        objectives,
        comments,
        scoreBands: scoreBands(trainees, attempts, from, to),
        launches: { count: launchCount, sessionHours: round2(launchSeconds / 3600) },
    };
}

function summaryFrom(trainees, atRiskCount) {
    const totals = sumTotals(trainees);
    return {
        learners: trainees.length,
        averageProgress: totals.averageProgress,
        completionRate: totals.completionRate,
        passRate: totals.passRate,
        learningHours: totals.learningHours,
        atRisk: atRiskCount,
    };
}

function summaryDelta(current, previous) {
    return {
        learners: round2(current.learners - previous.learners),
        averageProgress: round2(current.averageProgress - previous.averageProgress),
        completionRate: round2(current.completionRate - previous.completionRate),
        passRate: round2(current.passRate - previous.passRate),
        learningHours: round2(current.learningHours - previous.learningHours),
        atRisk: round2(current.atRisk - previous.atRisk),
    };
}

function buildAnalytics({
    learners,
    trainees,
    totals,
    assignments,
    attempts,
    moduleProgress,
    scormAttempts,
    certificates,
    quizAttempts,
    fieldTasks,
    scormRegistrations = [],
    from,
    to,
    now,
}) {
    const timesByUser = new Map();
    const addTimes = (rows, idKey, timeKey) => {
        const indexed = indexTimes(rows, idKey, timeKey);
        for (const [id, values] of indexed) {
            const current = timesByUser.get(id) || [];
            current.push(...values);
            timesByUser.set(id, current);
        }
    };
    addTimes(assignments, 'userId', 'createdAt');
    addTimes(attempts, 'userId', 'updatedAt');
    addTimes(moduleProgress, 'userId', 'updatedAt');
    addTimes(scormAttempts, 'userId', 'updatedAt');
    addTimes(certificates, 'userId', 'issuedAt');
    addTimes(quizAttempts, 'userId', 'createdAt');
    addTimes(fieldTasks, 'userId', 'createdAt');

    const atRisk = atRiskTrainees(trainees, timesByUser, now);
    const summary = summaryFrom(trainees, atRisk.length);
    const previous = previousWindow(from, to);
    let comparison = null;
    if (previous) {
        const previousTrainees = buildTraineeRows({
            learners,
            assignments,
            attempts,
            moduleProgress,
            scormAttempts,
            certificates,
            quizAttempts,
            fieldTasks,
            coinAwards: [],
            from: previous.from,
            to: previous.to,
            now: previous.to,
        });
        const previousRisk = atRiskTrainees(previousTrainees, timesByUser, previous.to);
        comparison = summaryDelta(summary, summaryFrom(previousTrainees, previousRisk.length));
    }

    return {
        summary: { ...summary, comparison },
        funnel: {
            assigned: totals.assignedCourses,
            started: totals.startedCourses,
            completed: totals.completedCourses,
            passed: totals.passedCourses,
        },
        courses: courseRows(trainees, assignments, attempts, from, to),
        atRisk,
        trend: trendRows(trainees, attempts, from, to),
        scorm: scormPanels(trainees, scormRegistrations, attempts, from, to),
    };
}

function buildTraineeRows({
    learners = [],
    assignments = [],
    attempts = [],
    moduleProgress = [],
    scormAttempts = [],
    certificates = [],
    quizAttempts = [],
    fieldTasks = [],
    coinAwards = [],
    from = null,
    to = null,
    now = new Date(),
}) {
    const learnerIds = new Set(learners.map((learner) => learner.id));
    const completedKeys = new Set();
    for (const attempt of attempts) {
        if (!learnerIds.has(attempt.userId)) continue;
        if (COMPLETED_STATUSES.has(attempt.status)) {
            completedKeys.add(`${attempt.userId}:${attempt.courseId}`);
        }
    }

    return learners
        .map((learner) => {
            const learnerAssignments = assignments.filter((row) => row.userId === learner.id);
            const countedAssignments = learnerAssignments.filter((row) => inRange(row.createdAt, from, to));
            const learnerAttempts = attempts.filter((row) => row.userId === learner.id && inRange(row.updatedAt, from, to));
            const modules = moduleProgress.filter((row) => row.userId === learner.id && inRange(row.updatedAt, from, to));
            const completedModules = modules.filter((row) => row.status === 'COMPLETED').length;
            const scores = learnerAttempts
                .map((row) => row.scorePercent)
                .filter((score) => score != null && Number.isFinite(Number(score)))
                .map(Number);
            const progressValues = learnerAttempts.map((row) => Number(row.completionPercentage) || 0);
            const learningHours = learnerAttempts.reduce((sum, row) => sum + (Number(row.learningHours) || 0), 0);
            const overdueCourses = learnerAssignments.filter((row) => {
                if (!row.dueDate) return false;
                const due = new Date(row.dueDate);
                if (Number.isNaN(due.getTime()) || due >= now) return false;
                if (!inRange(due, from, to)) return false;
                return !completedKeys.has(`${learner.id}:${row.courseId}`);
            }).length;
            let startedCourses = 0;
            let completedCourses = 0;
            let passedCourses = 0;
            const courseParts = countedAssignments.map((row) => {
                const attempt = learnerAttempts.find((item) => item.courseId === row.courseId);
                if (attempt && (attempt.status !== 'NOT_STARTED' || Number(attempt.completionPercentage) > 0)) {
                    startedCourses += 1;
                }
                if (attempt && COMPLETED_STATUSES.has(attempt.status)) {
                    completedCourses += 1;
                }
                if (attempt && attempt.status === 'PASSED') {
                    passedCourses += 1;
                }
                const progress = attempt ? `${Math.round(Number(attempt.completionPercentage) || 0)}%` : 'Not started';
                return `${row.courseTitle || 'Course'} (${progress})`;
            });

            return {
                id: learner.id,
                fullName: learner.fullName,
                email: learner.email || '',
                batch: batchLabel(learner),
                department: learner.department || 'Unassigned',
                assignedCourses: countedAssignments.length,
                averageProgress: average(progressValues) ?? 0,
                averageScore: average(scores),
                learningHours: round2(learningHours),
                overdueCourses,
                moduleProgressCompleted: completedModules,
                moduleProgressTracked: modules.length,
                moduleProgress: `${completedModules}/${modules.length}`,
                scormAttempts: scormAttempts.filter((row) => row.userId === learner.id && inRange(row.updatedAt, from, to)).length,
                certificates: certificates.filter((row) => row.userId === learner.id && inRange(row.issuedAt, from, to)).length,
                quizAttempts: quizAttempts.filter((row) => row.userId === learner.id && inRange(row.createdAt, from, to)).length,
                fieldTasks: fieldTasks.filter((row) => row.userId === learner.id && inRange(row.createdAt, from, to)).length,
                points: Number(learner.points) || 0,
                pointsAwarded: coinAwards
                    .filter((row) => row.userId === learner.id && inRange(row.createdAt, from, to))
                    .reduce((sum, row) => sum + (Number(row.points) || 0), 0),
                courses: courseParts.join('; '),
                attemptCount: learnerAttempts.length,
                startedCourses,
                completedCourses,
                passedCourses,
            };
        })
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function csvCell(value) {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

export function toActivityReportCsv(trainees = []) {
    const lines = [ACTIVITY_REPORT_CSV_COLUMNS.join(',')];
    for (const trainee of trainees) {
        lines.push([
            trainee.fullName,
            trainee.email,
            trainee.batch,
            trainee.department,
            trainee.assignedCourses,
            trainee.averageProgress,
            trainee.averageScore ?? '',
            trainee.learningHours,
            trainee.overdueCourses,
            trainee.moduleProgress,
            trainee.scormAttempts,
            trainee.certificates,
            trainee.quizAttempts,
            trainee.fieldTasks,
            trainee.points,
            trainee.pointsAwarded,
            trainee.courses,
        ].map(csvCell).join(','));
    }
    return `${lines.join('\n')}\n`;
}
