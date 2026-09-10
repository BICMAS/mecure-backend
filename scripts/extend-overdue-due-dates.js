/**
 * Extend due dates on overdue assignments for one organization.
 *
 * Overdue matches the HR dashboard card:
 *   Assignment.dueDate < now AND no related Attempt with status COMPLETED
 *
 * Usage:
 *   node scripts/extend-overdue-due-dates.js
 *   node scripts/extend-overdue-due-dates.js --apply --dueDate=2026-12-31
 *
 * Defaults to dry-run. Does not touch progress, scores, SCORM attempts, or certificates.
 */
import { prisma, disconnectPrisma } from '../src/utils/db.js';

const APPLY_MODE = process.argv.includes('--apply');
const DEFAULT_ORG_SEARCH = 'MeCure';
const DEFAULT_DUE_DATE = '2026-12-31';

function readArg(name) {
    const prefix = `--${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : null;
}

function assignmentWhereForOrg(orgId) {
    return {
        OR: [
            { assigneeUser: { orgId } },
            { group: { orgId } },
        ],
    };
}

function overdueWhere(orgId) {
    return {
        AND: [
            assignmentWhereForOrg(orgId),
            { dueDate: { lt: new Date() } },
            { NOT: { attempts: { some: { status: 'COMPLETED' } } } },
        ],
    };
}

function parseDueDate(value) {
    if (!value) {
        throw new Error('dueDate is required');
    }

    const hasTime = value.includes('T');
    const parsed = new Date(hasTime ? value : `${value}T23:59:59.000Z`);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid dueDate: ${value}`);
    }
    if (parsed.getTime() <= Date.now()) {
        throw new Error(`New dueDate must be in the future: ${parsed.toISOString()}`);
    }
    return parsed;
}

async function countOverdue(orgId) {
    return prisma.assignment.count({ where: overdueWhere(orgId) });
}

async function resolveOrg(orgIdArg, orgSearch) {
    if (orgIdArg) {
        const org = await prisma.organization.findUnique({
            where: { id: orgIdArg },
            select: { id: true, name: true },
        });
        if (!org) {
            throw new Error(`Organization not found: ${orgIdArg}`);
        }
        return org;
    }

    const orgs = await prisma.organization.findMany({
        where: {
            name: { contains: orgSearch, mode: 'insensitive' },
        },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
    });

    if (orgs.length === 1) {
        return orgs[0];
    }
    if (orgs.length > 1) {
        const list = orgs.map((org) => `${org.name} (${org.id})`).join(', ');
        throw new Error(`Multiple organizations matched "${orgSearch}": ${list}. Pass --orgId=`);
    }

    const allOrgs = await prisma.organization.findMany({
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
    });
    const withOverdue = [];
    for (const org of allOrgs) {
        const overdue = await countOverdue(org.id);
        if (overdue > 0) {
            withOverdue.push({ ...org, overdue });
        }
    }

    if (withOverdue.length === 1) {
        console.log(
            `[OVERDUE EXTEND] No org named "${orgSearch}"; using the only org with overdue assignments: ${withOverdue[0].name}`,
        );
        return withOverdue[0];
    }

    if (withOverdue.length > 1) {
        const list = withOverdue
            .map((org) => `${org.name} (${org.id}, overdue=${org.overdue})`)
            .join(', ');
        throw new Error(`No org named "${orgSearch}" and multiple orgs have overdue assignments: ${list}. Pass --orgId=`);
    }

    throw new Error(`No organization matched "${orgSearch}" and none have overdue assignments`);
}

function summarizeByCourse(assignments) {
    const byCourse = new Map();

    for (const assignment of assignments) {
        const title = assignment.course?.title || '(untitled course)';
        const existing = byCourse.get(title) || {
            courseTitle: title,
            assignmentCount: 0,
            learnerIds: new Set(),
            dueDates: new Set(),
        };

        existing.assignmentCount += 1;
        if (assignment.assigneeUserId) {
            existing.learnerIds.add(assignment.assigneeUserId);
        }
        if (assignment.dueDate) {
            existing.dueDates.add(assignment.dueDate.toISOString().slice(0, 10));
        }
        byCourse.set(title, existing);
    }

    return [...byCourse.values()].map((row) => ({
        courseTitle: row.courseTitle,
        assignmentCount: row.assignmentCount,
        learnerCount: row.learnerIds.size,
        currentDueDates: [...row.dueDates].sort(),
    }));
}

function collectAttemptIds(assignment) {
    const ids = new Set();

    for (const attempt of assignment.attempts || []) {
        ids.add(attempt.id);
    }
    for (const attempt of assignment.assigneeUser?.userAttempts || []) {
        if (attempt.courseId === assignment.courseId) {
            ids.add(attempt.id);
        }
    }

    return [...ids];
}

async function main() {
    const newDueDate = parseDueDate(readArg('dueDate') || DEFAULT_DUE_DATE);
    const org = await resolveOrg(readArg('orgId'), readArg('orgSearch') || DEFAULT_ORG_SEARCH);

    const overdueAssignments = await prisma.assignment.findMany({
        where: overdueWhere(org.id),
        include: {
            course: { select: { id: true, title: true } },
            assigneeUser: {
                select: {
                    id: true,
                    fullName: true,
                    userAttempts: {
                        where: { courseId: { not: null } },
                        select: { id: true, courseId: true, dueDate: true, status: true },
                    },
                },
            },
            attempts: {
                select: { id: true, dueDate: true, status: true, userId: true, courseId: true },
            },
        },
        orderBy: { createdAt: 'asc' },
    });

    const attemptIds = [...new Set(overdueAssignments.flatMap(collectAttemptIds))];
    const byCourse = summarizeByCourse(overdueAssignments);

    const overdueCountBefore = await prisma.assignment.count({ where: overdueWhere(org.id) });
    const activeCountBefore = await prisma.assignment.count({
        where: {
            AND: [
                assignmentWhereForOrg(org.id),
                { dueDate: { gte: new Date() } },
                { NOT: { attempts: { some: { status: 'COMPLETED' } } } },
            ],
        },
    });

    console.log(JSON.stringify({
        mode: APPLY_MODE ? 'APPLY' : 'DRY-RUN',
        org: { id: org.id, name: org.name },
        newDueDate: newDueDate.toISOString(),
        overdueCountBefore,
        activeCountBefore,
        assignmentsToUpdate: overdueAssignments.length,
        attemptsToUpdate: attemptIds.length,
        uniqueLearners: new Set(
            overdueAssignments.map((assignment) => assignment.assigneeUserId).filter(Boolean),
        ).size,
        byCourse,
        sampleDueDates: [...new Set(
            overdueAssignments
                .map((assignment) => assignment.dueDate?.toISOString())
                .filter(Boolean),
        )].slice(0, 10),
    }, null, 2));

    if (!APPLY_MODE) {
        console.log('[OVERDUE EXTEND] Dry-run only. Re-run with --apply to write due dates.');
        return;
    }

    await prisma.$transaction(async (tx) => {
        if (overdueAssignments.length > 0) {
            await tx.assignment.updateMany({
                where: { id: { in: overdueAssignments.map((assignment) => assignment.id) } },
                data: { dueDate: newDueDate },
            });
        }

        if (attemptIds.length > 0) {
            await tx.attempt.updateMany({
                where: { id: { in: attemptIds } },
                data: { dueDate: newDueDate },
            });
        }
    });

    const overdueCountAfter = await prisma.assignment.count({ where: overdueWhere(org.id) });
    const activeCountAfter = await prisma.assignment.count({
        where: {
            AND: [
                assignmentWhereForOrg(org.id),
                { dueDate: { gte: new Date() } },
                { NOT: { attempts: { some: { status: 'COMPLETED' } } } },
            ],
        },
    });

    console.log(JSON.stringify({
        mode: 'APPLY-RESULT',
        overdueCountAfter,
        activeCountAfter,
        assignmentsUpdated: overdueAssignments.length,
        attemptsUpdated: attemptIds.length,
    }, null, 2));

    if (overdueCountAfter !== 0) {
        throw new Error(`Expected overdue count 0 after update, got ${overdueCountAfter}`);
    }
}

main()
    .catch((error) => {
        console.error('[OVERDUE EXTEND ERROR]', error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectPrisma();
    });
