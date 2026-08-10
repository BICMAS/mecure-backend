import { findCourseIdByTitle, resetCourseProgress } from '../src/lib/courseProgressReset.js';

const DEFAULT_TITLE = 'Commerical Excellence Induction Program';

function readArg(name) {
    const prefix = `--${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : null;
}

async function main() {
    const title = readArg('courseTitle') || DEFAULT_TITLE;
    const dryRun = process.argv.includes('--dry-run');
    const courseIdArg = readArg('courseId');

    let courseId = courseIdArg;
    if (!courseId) {
        const course = await findCourseIdByTitle(title);
        if (!course) {
            console.error(`Course not found for title: ${title}`);
            process.exit(1);
        }
        courseId = course.id;
        console.log(`Resolved course: ${course.title} (${course.id})`);
    }

    const result = await resetCourseProgress({
        courseId,
        requester: {
            id: 'script-super-admin',
            userRole: 'SUPER_ADMIN',
            orgId: null,
        },
        deleteCertificates: true,
        resetModuleProgress: true,
        dryRun,
    });

    console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
