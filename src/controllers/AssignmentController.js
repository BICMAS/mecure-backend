import { AssignmentService } from '../service/AssignmentService.js';

export const createAssignments = async (req, res) => {
    try {
        const result = await AssignmentService.createAssignments(req.body, req.user);
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

export const getAssignedCourses = async (req, res) => {
    try {
        const result = await AssignmentService.getAssignedCourses(req.user);
        res.json(result);
    } catch (error) {
        res.status(403).json({ error: error.message });
    }
};

export const getCourseAssignees = async (req, res) => {
    try {
        const { courseId } = req.params;
        const result = await AssignmentService.getCourseAssignees(courseId, req.user);
        return res.status(200).json(result);
    } catch (error) {
        const notFound = error.message === 'Course not found';
        const forbidden =
            error.message === 'Only HR and super admin can view course assignees'
            || error.message === 'HR must be in an organization';
        const status = notFound ? 404 : forbidden ? 403 : 400;
        return res.status(status).json({ error: error.message });
    }
};
