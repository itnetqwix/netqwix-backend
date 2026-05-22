/** Per-file clip upload cap (50 MB). */
export const MAX_CLIP_FILE_BYTES = 50 * 1024 * 1024;

/** Default estimate for legacy session PDFs missing `report_file_size_bytes`. */
export const LEGACY_PDF_SIZE_ESTIMATE_BYTES = 2 * 1024 * 1024;

/** Optional cap for a single game-plan PDF upload. */
export const MAX_PDF_FILE_BYTES = 25 * 1024 * 1024;
