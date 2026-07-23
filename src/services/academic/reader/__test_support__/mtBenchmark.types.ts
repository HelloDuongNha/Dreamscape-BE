// Phase I18N-3B.2B-MT0 — Local Machine Translation Benchmark Types

export interface BenchmarkTargetItem {
  targetId: string;
  targetType: 'block_text' | 'figure_caption' | 'table_cell';
  text: string;
  expectedTokens?: string[]; // Citation/numbers/p-values that MUST be preserved exactly
}

export interface WorkerTranslateRequest {
  modelName: string;
  sourceLanguage: 'en' | 'vi';
  targetLanguage: 'en' | 'vi';
  text: string;
  decodingSettings?: {
    temperature?: number;
    numBeams?: number;
    doSample?: boolean;
  };
}

export interface WorkerTranslateResponse {
  translatedText?: string;
  error?: string;
  errorCode?: 'engine_unavailable' | 'model_not_found' | 'inference_failed' | 'timeout';
  loadTimeMs?: number;
  inferenceTimeMs?: number;
  peakRssBytes?: number;
}

export interface ModelValidationResult {
  hasMissingTokens: boolean;
  missingTokens: string[];
  isPreserved: boolean;
}

export interface ModelMetrics {
  modelName: string;
  isDeterministic: boolean; // byte-identical repeats
  coldLoadTimeMs: number;
  coldLatencyMs: number;
  warmLatencyMs: number;
  peakRssBytes: number;
  pipelineAccuracy: number; // percentage of targets preserving all protected tokens
  failures: {
    targetId: string;
    originalText: string;
    translatedText?: string;
    reason: string;
  }[];
}
