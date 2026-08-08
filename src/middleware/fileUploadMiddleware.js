import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { SCORM_MAX_UPLOAD_BYTES, SCORM_MAX_UPLOAD_MB } from '../lib/scormUploadLimits.js';

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(process.cwd(), 'uploads/temp');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const name = Date.now() + '-' + file.originalname;
        cb(null, name);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: SCORM_MAX_UPLOAD_BYTES },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
            cb(null, true);
        } else {
            cb(new Error('Only ZIP files allowed'), false);
        }
    }
});

// Wrap Multer so we can return the real Multer error message to clients.
export const uploadMiddleware = (req, res, next) => {
    const handler = upload.single('package');
    handler(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    error: `File too large. Maximum SCORM package size is ${SCORM_MAX_UPLOAD_MB} MB.`,
                });
            }
            const message = err?.message || 'File upload failed';
            return res.status(400).json({ error: message });
        }
        return next();
    });
};