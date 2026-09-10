import { CourseCategoryService } from '../service/CourseCategoryService.js';

export const listCourseCategories = async (req, res) => {
    try {
        const categories = await CourseCategoryService.list();
        res.json(categories);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const createCourseCategory = async (req, res) => {
    try {
        const category = await CourseCategoryService.create(req.body);
        res.status(201).json(category);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};
