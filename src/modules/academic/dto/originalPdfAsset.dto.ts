export interface CacheAttemptSummary {
  url: string;
  status: 'success' | 'failed' | 'skipped';
  contentType?: string;
  reason?: string;
}

export interface OriginalPdfCacheResult {
  status: 'cached' | 'already_cached' | 'cache_failed' | 'external_only' | 'recached';
  source?: any;
  attemptedCandidates: CacheAttemptSummary[];
  message: string;
}
