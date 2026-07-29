const ACTIVE_READER_STAGES = new Set([
  'uploaded',
  'inspecting',
  'extracting_text',
  'resolving_identifiers',
  'fetching_preferred_source',
  'ocr_processing',
  'compiling_reader',
]);

interface ReaderApprovalState {
  fullTextStatus?: string;
  extractionStatus?: string;
}

// Prevents review from promoting an incomplete reader into an approved source.
export function isReaderBuildInProgress(source: ReaderApprovalState): boolean {
  return source.fullTextStatus === 'importing'
    || ACTIVE_READER_STAGES.has(String(source.extractionStatus || ''));
}
