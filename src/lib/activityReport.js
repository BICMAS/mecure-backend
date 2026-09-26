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

function sumTotals(trainees) {
    const totals = emptyTotals();
    totals.trainees = trainees.length;
    const progressValues = [];
    const scoreValues = [];

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
        if (trainee.attemptCount > 0) progressValues.push(trainee.averageProgress);
        if (trainee.averageScore != null) scoreValues.push(trainee.averageScore);
    }

    totals.averageProgress = average(progressValues) ?? 0;
    totals.averageScore = average(scoreValues);
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
    filters,
    now = new Date(),
}) {
    const from = filters?.from ?? null;
    const to = filters?.to ?? null;
    const breakdown = filters?.breakdown === 'department' ? 'department' : 'batch';
    const learnerIds = new Set(learners.map((learner) => learner.id));

    const completedKeys = new Set();
    for (const attempt of attempts) {
        if (!learnerIds.has(attempt.userId)) continue;
        if (COMPLETED_STATUSES.has(attempt.status)) {
            completedKeys.add(`${attempt.userId}:${attempt.courseId}`);
        }
    }

    const trainees = learners
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
            const courseParts = countedAssignments.map((row) => {
                const attempt = learnerAttempts.find((item) => item.courseId === row.courseId);
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
            };
        })
        .sort((a, b) => a.fullName.localeCompare(b.fullName));

    return {
        breakdownBy: breakdown,
        totals: sumTotals(trainees),
        breakdown: buildBreakdown(trainees, breakdown),
        trainees,
        message: trainees.length === 0 ? 'No trainees match these filters.' : null,
    };
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
