import { prisma } from '../utils/db.js';
import { parseManifestActivitiesFromXml } from './scormManifestParser.js';
import { ScormCloudService } from '../services/ScormCloudService.js';

const MANIFEST_PATHS = [
    'imsmanifest.xml',
    'IMSManifest.xml',
    'ImsManifest.xml',
];

async function resolveCourseScormPackageRecord(course) {
    if (course.scormPackageId && course.scormPackage) {
        return course.scormPackage;
    }

    const lessonPackageId = course.modules
        ?.flatMap((module) => module.lessons ?? [])
        ?.find((lesson) => lesson.scormPackageId)?.scormPackageId;

    if (!lessonPackageId) return null;

    return prisma.scormPackage.findUnique({
        where: { id: lessonPackageId },
    });
}

async function fetchManifestXmlFromScormCloud(scormCloudId) {
    for (const assetPath of MANIFEST_PATHS) {
        try {
            const xml = await ScormCloudService.getCourseAsset(scormCloudId, assetPath);
            if (xml && xml.includes('<manifest')) {
                return xml;
            }
        } catch {
            // try next path
        }
    }
    return null;
}

/**
 * Refresh manifestJson.activities from SCORM Cloud (if import finished) or keep
 * the zip-parsed manifest already stored on the package row.
 */
export async function refreshScormPackageManifest(scormPackage) {
    if (!scormPackage?.id) return scormPackage;

    let manifestData = null;

    if (scormPackage.scormCloudId) {
        const manifestXml = await fetchManifestXmlFromScormCloud(scormPackage.scormCloudId);
        if (manifestXml) {
            try {
                manifestData = await parseManifestActivitiesFromXml(manifestXml);
                console.log(
                    `[MANIFEST REFRESH] Parsed ${manifestData.activities.length} activities from SCORM Cloud for ${scormPackage.scormCloudId}`,
                );
            } catch (err) {
                console.warn('[MANIFEST REFRESH] SCORM Cloud manifest parse failed:', err.message);
            }
        }
    }

    if (!manifestData) {
        const existingActivities = scormPackage.manifestJson?.activities;
        if (Array.isArray(existingActivities) && existingActivities.length > 0) {
            return scormPackage;
        }
        console.warn('[MANIFEST REFRESH] No manifest activities available to refresh');
        return scormPackage;
    }

    const updated = await prisma.scormPackage.update({
        where: { id: scormPackage.id },
        data: {
            manifestJson: {
                activities: manifestData.activities ?? [],
                organizationId: manifestData.organizationId ?? scormPackage.manifestJson?.organizationId ?? null,
                schemaVersion: manifestData.schemaVersion ?? scormPackage.manifestJson?.schemaVersion ?? null,
            },
        },
    });

    return updated;
}

export async function refreshCourseScormManifest(courseId) {
    const course = await prisma.course.findUnique({
        where: { id: courseId },
        include: {
            modules: { include: { lessons: true } },
            scormPackage: true,
        },
    });

    if (!course) return null;

    const scormPackage = await resolveCourseScormPackageRecord(course);
    if (!scormPackage) return null;

    return refreshScormPackageManifest(scormPackage);
}
