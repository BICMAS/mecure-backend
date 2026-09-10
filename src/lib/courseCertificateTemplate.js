export function pickLatestCourseTemplateAssignments(logs = []) {
    const sorted = [...logs].sort((a, b) => {
        const aTime = new Date(a?.createdAt ?? 0).getTime();
        const bTime = new Date(b?.createdAt ?? 0).getTime();
        return aTime - bTime;
    });

    const assignments = new Map();
    for (const log of sorted) {
        const courseId = log?.targetId;
        const templateId = log?.payload?.templateId;
        if (!courseId || typeof templateId !== 'string' || !templateId.trim()) {
            continue;
        }
        assignments.set(courseId, templateId);
    }

    return assignments;
}

export function resolveIssuanceTemplateId({
    courseTemplateId = null,
    orgTemplateId: _orgTemplateId = null,
    requestedTemplateId: _requestedTemplateId = null,
} = {}) {
    return courseTemplateId || null;
}

export function certificateTemplatePublicFields(template) {
    if (!template) return null;
    return {
        id: template.id,
        filename: template.filename,
        name: template.filename,
        description: template.description ?? null,
    };
}
