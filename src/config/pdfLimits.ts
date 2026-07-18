const DEFAULT_PDF_MAX_FILE_SIZE_MB = 250;

function readPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Maximum accepted original PDF size. Configurable without changing code. */
export const PDF_MAX_FILE_SIZE_MB = readPositiveNumber(
  process.env.PDF_MAX_FILE_SIZE_MB,
  DEFAULT_PDF_MAX_FILE_SIZE_MB
);

export const PDF_MAX_FILE_SIZE_BYTES = Math.floor(PDF_MAX_FILE_SIZE_MB * 1024 * 1024);

/** Large raw PDFs need a longer bounded download window before Docling processing. */
export const PDF_DOWNLOAD_TIMEOUT_MS = Math.floor(
  readPositiveNumber(process.env.PDF_DOWNLOAD_TIMEOUT_SECONDS, 300) * 1000
);

/**
 * Docling has a short bounded window for normal text PDFs and a much longer
 * one for CPU OCR of scanned books. Both remain configurable for deployment.
 */
export const DOCLING_EXTRACTION_TIMEOUT_MS = Math.floor(
  readPositiveNumber(process.env.DOCLING_EXTRACTION_TIMEOUT_SECONDS, 1800) * 1000
);

export const DOCLING_OCR_TIMEOUT_MS = Math.floor(
  readPositiveNumber(process.env.DOCLING_OCR_TIMEOUT_SECONDS, 14400) * 1000
);

export const PDF_MAX_FILE_SIZE_LABEL = `${PDF_MAX_FILE_SIZE_MB}MB`;
