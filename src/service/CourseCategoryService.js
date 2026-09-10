import { CourseCategoryModel } from '../models/CourseCategoryModel.js';
import { parseCategoryCreateInput } from '../lib/courseCategory.js';

export class CourseCategoryService {
    static async list() {
        return CourseCategoryModel.findMany();
    }

    static async create(body) {
        const { name, slug } = parseCategoryCreateInput(body);
        const existing = await CourseCategoryModel.findDuplicate({ name, slug });
        if (existing) {
            throw new Error('A category with this name already exists');
        }

        const sortOrder = await CourseCategoryModel.nextSortOrder();
        return CourseCategoryModel.create({ name, slug, sortOrder });
    }
}
