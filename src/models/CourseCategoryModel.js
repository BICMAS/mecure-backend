import { prisma } from '../utils/db.js';
import { categorySelect } from '../lib/courseCategory.js';

export class CourseCategoryModel {
    static async findMany() {
        return prisma.courseCategory.findMany({
            select: categorySelect(),
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });
    }

    static async findById(id) {
        return prisma.courseCategory.findUnique({
            where: { id },
            select: categorySelect(),
        });
    }

    static async findDuplicate({ name, slug }) {
        return prisma.courseCategory.findFirst({
            where: {
                OR: [
                    { slug },
                    { name: { equals: name, mode: 'insensitive' } },
                ],
            },
            select: categorySelect(),
        });
    }

    static async create({ name, slug, sortOrder }) {
        return prisma.courseCategory.create({
            data: { name, slug, sortOrder },
            select: categorySelect(),
        });
    }

    static async nextSortOrder() {
        const last = await prisma.courseCategory.findFirst({
            orderBy: { sortOrder: 'desc' },
            select: { sortOrder: true },
        });
        return (last?.sortOrder ?? -1) + 1;
    }
}
