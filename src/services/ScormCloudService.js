

import axios from 'axios';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getScormUploadTimeoutForBytes, getScormUploadTimeoutMs } from '../middleware/scormUploadTimeout.js';

export class ScormCloudService {
    static client = null;

    static formatAxiosError(err, fallbackMessage) {
        const status = err?.response?.status;
        const data = err?.response?.data;
        const detail = typeof data === 'string'
            ? data
            : data?.message || data?.error || (data && Object.keys(data).length > 0 ? JSON.stringify(data) : null);
        return new Error(`${fallbackMessage}${status ? ` (status ${status})` : ''}: ${detail || err.message || 'Unknown SCORM Cloud error'}`);
    }

    static init() {
        if (!this.client) {
            this.client = axios.create({
                baseURL: 'https://cloud.scorm.com/api/v2',
                auth: {
                    username: process.env.SCORM_CLOUD_APP_ID,
                    password: process.env.SCORM_CLOUD_SECRET_KEY,
                },
                headers: { Accept: 'application/json' },
                timeout: 60000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });
        }
        return this.client;
    }

    /**
     * Submit a SCORM package to SCORM Cloud's import queue.
     *
     * Options:
     * - lessonId: use stable `lesson-{lessonId}` course id
     * - courseId: LMS course id → stable `course-{courseId}` (versioning)
     * - scormCloudCourseId: explicit SCORM Cloud course id (reuse on version upload)
     */
    static async submitCourseUpload(filePath, filename, options = {}) {
        const lessonId = options.lessonId ?? null;
        const lmsCourseId = options.courseId ?? null;
        const explicitScormCloudId = options.scormCloudCourseId ?? null;

        console.log(`[UPLOAD] Submitting: ${filename}`, {
            lessonId: lessonId || 'none',
            courseId: lmsCourseId || 'none',
            scormCloudCourseId: explicitScormCloudId || 'auto',
        });

        if (!fs.existsSync(filePath)) throw new Error(`File missing: ${filePath}`);
        const stats = fs.statSync(filePath);
        if (stats.size === 0) throw new Error('File empty');

        const courseId = explicitScormCloudId
            ?? (lmsCourseId ? `course-${lmsCourseId}` : null)
            ?? (lessonId ? `lesson-${lessonId}` : null)
            ?? `pkg-${uuidv4().replace(/-/g, '')}`;

        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath), {
            filename,
            contentType: 'application/zip',
            knownLength: stats.size,
        });

        const client = this.init();
        const query = new URLSearchParams({
            courseId,
            mayCreateNewVersion: 'true',
        });
        const endpoint = `/courses/importJobs/upload?${query.toString()}`;

        console.log(`[UPLOAD] POST to: ${endpoint}`);
        const uploadTimeoutMs = getScormUploadTimeoutForBytes(stats.size);
        console.log(
            `[UPLOAD] Allowing ${Math.round(uploadTimeoutMs / 60000)} min for ${(stats.size / (1024 * 1024)).toFixed(1)} MB`,
        );

        let res;
        try {
            res = await client.post(endpoint, form, {
                headers: form.getHeaders(),
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: uploadTimeoutMs,
            });
        } catch (err) {
            if (err?.response?.status === 409) {
                throw this.formatAxiosError(
                    err,
                    'SCORM course already exists — version upload rejected. If an import is still running, wait for it to finish and retry',
                );
            }
            throw this.formatAxiosError(err, 'SCORM Cloud upload failed');
        }

        console.log('[UPLOAD] Status:', res.status);
        console.log('[UPLOAD] Data:', JSON.stringify(res.data, null, 2));

        let jobId;
        if (res.data.id) {
            jobId = res.data.id;
        } else if (res.data.result) {
            if (res.data.result.includes(courseId)) {
                jobId = res.data.result.replace(courseId, '');
            } else {
                jobId = res.data.result.substring(0, 10);
            }
        }

        if (!jobId) throw new Error('No jobId extracted from SCORM Cloud upload response');

        console.log(`[UPLOAD] Job ID: ${jobId}`);

        return { jobId, courseId };
    }

    static async uploadCourse(filePath, filename, options = {}) {
        try {
            const { jobId, courseId } = await this.submitCourseUpload(filePath, filename, options);
            return await this.waitForImportJob(jobId, courseId, filename);
        } catch (err) {
            console.error('[UPLOAD ERROR]', err.message, err.response?.data);
            throw err;
        }
    }

    static mapCourseToScormVersion(course = {}) {
        const candidates = [
            course.learningStandard,
            course.courseLearningStandard,
            course.course_learning_standard,
            typeof course.version === 'string' ? course.version : null,
            typeof course.scormVersion === 'string' ? course.scormVersion : null,
        ].filter(Boolean);

        const normalized = candidates.map((value) => String(value).toUpperCase()).join(' ');

        if (
            normalized.includes('2004')
            || normalized.includes('4TH')
            || normalized.includes('CAM')
            || normalized.includes('XAPI')
            || normalized.includes('TINCAN')
            || normalized.includes('CMI5')
        ) {
            return 'V2004';
        }

        if (
            normalized.includes('1.2')
            || normalized.includes('1_2')
            || normalized.includes('SCORM12')
            || normalized.includes('SCORM_1_2')
        ) {
            return 'V1_2';
        }

        // SCORM Cloud v2 `version` is usually a numeric revision id, not the standard name.
        return 'V2004';
    }

    static async waitForImportJob(jobId, courseId, filename, maxAttempts = 180, intervalMs = 10000) {
        console.log(`[POLL] Job ${jobId} → Course ${courseId} | ${maxAttempts} attempts (~30 min)`);

        const client = this.init();
        const pollTimeoutMs = Math.min(getScormUploadTimeoutMs(), 600000);

        await new Promise(r => setTimeout(r, 15000)); // initial delay

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await new Promise(r => setTimeout(r, intervalMs));

            try {
                const courseRes = await client.get(`/courses/${courseId}`, { timeout: pollTimeoutMs });
                const course = courseRes.data;

                console.log(`[POLL ${attempt}] Course READY! Title: ${course.title}`);

                return {
                    scormCloudId: course.id || courseId,
                    title: course.title || filename.replace(/\.zip$/i, ''),
                    scormVersion: ScormCloudService.mapCourseToScormVersion(course),
                    learningStandard:
                        course.learningStandard
                        ?? course.courseLearningStandard
                        ?? course.course_learning_standard
                        ?? null,
                };
            } catch (err) {
                if (err.response?.status === 404) {
                    console.log(`[POLL ${attempt}] Course not ready yet`);
                    continue;
                }
                console.error(`[POLL ERROR ${attempt}]`, err.message, err.response?.data);
                throw err;
            }
        }

        throw new Error(`Timeout after ${maxAttempts} attempts. Check dashboard for course ${courseId}`);
    }
    static async createLaunchLink(courseId, learnerId, learnerName, options = {}) {
        const client = this.init();

        const registrationId = `reg-${uuidv4().replace(/-/g, '')}`;
        console.log(`[LAUNCH] Generated registrationId: ${registrationId}`);

        const nameParts = (learnerName || 'Learner User').split(' ');
        const firstName = nameParts[0] || 'Learner';
        const lastName = nameParts.slice(1).join(' ') || 'User';

        const payload = {
            registrationId,
            courseId,
            learner: {
                id: learnerId.toString(),
                firstName: firstName.substring(0, 100),
                lastName: lastName.substring(0, 100)
            }
        };

        try {
            await client.post('/registrations', payload);
        } catch (err) {
            throw this.formatAxiosError(err, 'SCORM registration create failed');
        }
        console.log('[LAUNCH] Registration created');

        // Confirm registration
        await new Promise(r => setTimeout(r, 2000));
        try {
            await client.get(`/registrations/${registrationId}`);
        } catch (err) {
            throw this.formatAxiosError(err, 'SCORM registration confirm failed');
        }
        console.log('[LAUNCH] Registration confirmed');

        const launchPayload = {
            redirectOnExitUrl: options.redirectOnExitUrl || "https://bicmas-trainee.vercel.app/scorm-exit.html",
            launchAuth: {
                type: "vault",
                options: {
                    ipAddress: false,
                    fingerprint: false,
                    expiry: 3600,
                    slidingExpiry: 3600
                }
            }
        };

        if (options.startSco) {
            launchPayload.startSco = options.startSco;
        }

        let launchRes;
        try {
            launchRes = await client.post(
                `/registrations/${registrationId}/launchLink`,
                launchPayload
            );
        } catch (err) {
            throw this.formatAxiosError(err, 'SCORM launch link create failed');
        }

        const launchUrl = launchRes.data.launchLink;

        if (!launchUrl) throw new Error('No launchLink');

        console.log('[LAUNCH] Success:', launchUrl, options.startSco ? `(startSco=${options.startSco})` : '');

        return { launchUrl, registrationId };
    }

    static async getRegistrationProgress(registrationId, options = {}) {
        const client = this.init();
        const params = new URLSearchParams();
        if (options.includeChildResults) {
            params.set('includeChildResults', 'true');
        }
        const query = params.toString();
        const url = `/registrations/${registrationId}/progress${query ? `?${query}` : ''}`;
        const res = await client.get(url);
        return res.data;
    }

    static async testConnection() {
        const client = this.init();
        try {
            await client.get('/courses?limit=1');
            return true;
        } catch (err) {
            return false;
        }
    }


    static async getRegistrationScore(registrationId) {
        const client = this.init();
        try {
            const res = await client.get(`/registrations/${registrationId}`);
            const data = res.data;

            return {
                raw: data.score?.raw || null,           // actual score (e.g. 85)
                scaled: data.score?.scaled || null,     // 0–1 scale (e.g. 0.85)
                min: data.score?.min || null,
                max: data.score?.max || null,
                completion: data.completion || null,
                success: data.success || null,
                totalSecondsTracked: data.totalSecondsTracked || null
            };
        } catch (err) {
            console.error('[SCORE FETCH ERROR]', err.response?.data || err.message);
            throw new Error(`Failed to fetch score for registration ${registrationId}`);
        }
    }

    static async getCourse(scormCloudId) {
        const client = this.init();
        const res = await client.get(`/courses/${encodeURIComponent(scormCloudId)}`);
        return res.data;
    }

    /**
     * Fetch a single course asset (e.g. imsmanifest.xml) from SCORM Cloud.
     */
    static async getCourseAsset(scormCloudId, assetPath) {
        const client = this.init();
        const res = await client.get(
            `/courses/${encodeURIComponent(scormCloudId)}/asset`,
            {
                params: { path: assetPath },
                responseType: 'text',
                transformResponse: [(data) => data],
            },
        );
        return res.data;
    }
}