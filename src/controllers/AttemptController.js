import { AttemptService } from '../service/AttemptService.js';
import { COURSE_LOCKED_MESSAGE } from '../lib/courseLock.js';

function statusForAttemptError(message) {
    if (message === COURSE_LOCKED_MESSAGE) return 403;
    if (message === 'Course not found') return 404;
    return 400;
}

export const updateProgress = async (req, res) => {
    try {
        const { courseId } = req.params;
        const { completionPercentage, status, notes } = req.body;
        const result = await AttemptService.updateProgress(courseId, { completionPercentage, status, notes }, req.user);
        res.json(result);
    } catch (error) {
        res.status(statusForAttemptError(error.message)).json({ error: error.message });
    }
};

export const syncScormProgress = async (req, res) => {
    try {
        const { scormAttemptId } = req.params;
        const updated = await AttemptService.syncScormProgress(scormAttemptId, req.user);
        res.json({
            success: true,
            data: updated
        });
    } catch (error) {
        console.error('[SCORM SYNC ERROR]', error);
        res.status(statusForAttemptError(error.message)).json({
            success: false,
            error: error.message
        });
    }
};

export const retakeCourse = async (req, res) => {
    try {
        const { courseId } = req.params;
        const result = await AttemptService.retakeCourse(courseId, req.user);
        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        res.status(statusForAttemptError(error.message)).json({
            success: false,
            error: error.message,
        });
    }
};

export const practiceRetakeCourse = async (req, res) => {
    try {
        const { courseId } = req.params;
        const result = await AttemptService.practiceRetakeCourse(courseId, req.user);
        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        res.status(statusForAttemptError(error.message)).json({
            success: false,
            error: error.message,
        });
    }
};