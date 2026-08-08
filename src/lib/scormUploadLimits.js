/** Max SCORM ZIP size accepted by our API (SCORM Cloud itself has no hard per-file cap). */
export const SCORM_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB

export const SCORM_MAX_UPLOAD_MB = Math.round(SCORM_MAX_UPLOAD_BYTES / (1024 * 1024));
