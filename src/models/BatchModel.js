import { prisma } from '../utils/db.js';

const batchSelect = {
    id: true,
    orgId: true,
    name: true,
    createdAt: true,
};

export class BatchModel {
    static async findById(id) {
        return prisma.batch.findUnique({
            where: { id },
            select: batchSelect,
        });
    }

    static async findByOrgAndName(orgId, name) {
        return prisma.batch.findFirst({
            where: {
                orgId,
                name: { equals: name, mode: 'insensitive' },
            },
            select: batchSelect,
        });
    }

    static async listByOrgId(orgId) {
        return prisma.batch.findMany({
            where: { orgId },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });
    }

    static async create({ orgId, name }) {
        return prisma.batch.create({
            data: { orgId, name },
            select: { id: true, name: true },
        });
    }
}
