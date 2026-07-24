import { StorageService } from '../services/StorageService.js';

export async function resolveCourseImageUrl(course) {
    if (!course?.imageUrl) return course;
    return {
        ...course,
        imageUrl: await StorageService.resolveStorageUrl(course.imageUrl),
    };
}

export async function resolveAssignmentCourseImage(assignment) {
    if (!assignment?.course) return assignment;
    return {
        ...assignment,
        course: await resolveCourseImageUrl(assignment.course),
    };
}
