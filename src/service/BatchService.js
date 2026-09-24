import { BatchModel } from '../models/BatchModel.js';

const MAX_BATCH_NAME_LENGTH = 80;

export function assertBatchAssignable(batch, orgId) {
    if (!batch) {
        throw new Error('Batch not found');
    }
    if (!orgId || batch.orgId !== orgId) {
        throw new Error('Batch is not in this organization');
    }
    return batch.id;
}

function assertCanManageBatches(requester) {
    if (!requester || (requester.userRole !== 'HR_MANAGER' && requester.userRole !== 'SUPER_ADMIN')) {
        throw new Error('Insufficient role to manage batches');
    }
    if (!requester.orgId) {
        throw new Error('No organization found for user');
    }
}

export class BatchService {
    static async listBatches(requester) {
        assertCanManageBatches(requester);
        return BatchModel.listByOrgId(requester.orgId);
    }

    static async createBatch(name, requester) {
        assertCanManageBatches(requester);
        const trimmed = String(name ?? '').trim();
        if (!trimmed) {
            throw new Error('Batch name is required');
        }
        if (trimmed.length > MAX_BATCH_NAME_LENGTH) {
            throw new Error('Batch name must be 80 characters or fewer');
        }

        const existing = await BatchModel.findByOrgAndName(requester.orgId, trimmed);
        if (existing) {
            throw new Error('A batch with this name already exists');
        }

        return BatchModel.create({ orgId: requester.orgId, name: trimmed });
    }

    static async resolveBatchId(batchId, orgId) {
        if (batchId == null || String(batchId).trim() === '') {
            return null;
        }
        const batch = await BatchModel.findById(String(batchId));
        return assertBatchAssignable(batch, orgId);
    }
}
