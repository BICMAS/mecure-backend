import { BatchService } from '../service/BatchService.js';

const statusForBatchError = (message) => {
    if (
        message.includes('Insufficient role')
        || message.includes('No organization')
        || message.includes('not in this organization')
    ) {
        return 403;
    }
    if (message === 'Batch not found') {
        return 404;
    }
    return 400;
};

export const listBatches = async (req, res) => {
    try {
        const batches = await BatchService.listBatches(req.user);
        res.json(batches);
    } catch (error) {
        res.status(statusForBatchError(error.message)).json({ error: error.message });
    }
};

export const createBatch = async (req, res) => {
    try {
        const batch = await BatchService.createBatch(req.body?.name, req.user);
        res.status(201).json(batch);
    } catch (error) {
        res.status(statusForBatchError(error.message)).json({ error: error.message });
    }
};
