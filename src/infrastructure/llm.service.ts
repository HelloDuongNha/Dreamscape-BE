import { logger } from './logger';
import type {
  EvidenceClaimBinding,
  EvidenceClaimContentPath,
} from '../shared/evidence/citationClaim';

export interface ILLMOutput {
  title: string;
  emotional_tone: string;
  emotional_valence?: -2 | -1 | 0 | 1 | 2;
  emotional_tone_key?: 'urgent_conflicted' | 'anxious' | 'fearful' | 'sad' | 'calm' | 'mixed' | 'neutral';
  summary: string;
  evidence_claims?: {
    contentPath: EvidenceClaimContentPath;
    claimText: string;
    supportRuleId?: string;
  }[];
  citation_contract_version?: 1;
  claim_bindings?: EvidenceClaimBinding[];
  citations?: {
    index: number;
    sourceType: 'academic_source';
    sourceId: string;
    title: string;
    year?: number;
    excerpt: string;
    detail?: string;
  }[];
  scientific_context_notes: {
    ruleId: string;
    note: string;
    confidence: number;
    dreamEvidence?: string[];
    insightTitle?: string;
    boundary?: string;
    ruleCode?: string;
    ruleStatement?: string;
    matchedDreamDetails?: string[];
    evidenceQuotes?: {
      sourceId: string;
      chunkId: string;
      quote: string;
    }[];
    sources?: {
      sourceId: string;
      title: string;
      authors: string[];
      year?: number;
      journal?: string;
      doi?: string;
      chunkIds?: string[];
    }[];
  }[];
  symbolic_notes: {
    symbol: string;
    meaning: string;
    relevance: number;
    symbolValence: number;
    origin?: 'dictionary' | 'contextual_observation';
    dictionarySymbol?: string;
    dreamEvidence?: string;
    contextualTone?: 'threatening' | 'reassuring' | 'ambivalent' | 'neutral';
    motifStats?: {
      previousPersonalDreamCount: number;
      similarDreamCount: number;
      sameSequenceCount: number;
      confirmedContextCount: number;
    };
  }[];
  cultural_symbolic_notes: {
    source: string;
    note: string;
  }[];
  real_life_hypotheses: {
    ruleId?: string | null;
    ruleIds?: string[];
    hypothesis: string;
    localizedHypothesis?: { vi: string; en: string };
    evidenceFromDream: string[];
    confidence: number;
    needsUserConfirmation: boolean;
    followUpQuestion: string;
    localizedFollowUpQuestion?: { vi: string; en: string };
    reasonForAsking?: string;
    localizedReasonForAsking?: { vi: string; en: string };
    ifYesMeaning?: string;
    localizedIfYesMeaning?: { vi: string; en: string };
    ifNoMeaning?: string;
    localizedIfNoMeaning?: { vi: string; en: string };
    questionType?: 'past' | 'present' | 'future';
    verificationKey?: string;
    validationSourceId?: string;
    validationExactQuote?: string;
    userFeedback?: 'yes' | 'no' | 'unsure' | null;
    ruleScore?: number;
    ruleVoteDelta?: number;
    ruleScoreDelta?: number;
    questionBasis?: 'academic_rule' | 'dream_sequence' | 'sleep_context';
    questionDimension?: string;
    answerSemantics?: {
      yes: 'supports' | 'weakens' | 'unresolved';
      no: 'supports' | 'weakens' | 'unresolved';
      unsure: 'unresolved';
    };
    sources?: {
      sourceId: string;
      title: string;
      authors: string[];
      year?: number;
      journal?: string;
      doi?: string;
      chunkIds?: string[];
    }[];
  }[];
  interpretive_threads?: {
    title: string;
    dreamEvidence: string[];
    reasoning: string;
    alternativeExplanation: string;
  }[];
  practical_reflections?: {
    suggestion: string;
    rationale: string;
  }[];
  similar_dreams?: {
    dreamId: string;
    title: string;
    excerpt: string;
    createdAt: string;
    authorDisplayName: string;
    sameAuthor: boolean;
    similarity: number;
    matchedOn?: string[];
  }[];
  creative_continuation?: {
    title: string;
    continuation: string;
    connectionToCurrentDream: string;
    inspirationIndexes: number[];
    disclaimer?: string;
    inspirations?: Array<{
      dreamId: string;
      title: string;
      similarity: number;
      matchedOn?: string[];
    }>;
  };
  feedback_revision?: {
    hypothesis: string;
    status: 'supported' | 'weakened' | 'unresolved';
    interpretation: string;
    ruleId?: string;
  }[];
  confidence: number;
  core_analysis: string;
  disclaimer: string;
  feedback_conclusion?: string | null;
  feedback_changed_paths?: string[];
  feedback_analysis?: {
    confirmedFacts: string[];
    rejectedDirections: string[];
    interpretation: string;
    nextSteps: string[];
  } | null;
  grounding_summary?: {
    narrativeUsed: boolean;
    resolvedContextCount: number;
    unresolvedContextCount: number;
    dictionaryMotifCount: number;
    contextualMotifCount: number;
    appliedRuleCount: number;
    explanatoryRuleCount: number;
    similarDreamCount: number;
    sleepContextFactCount: number;
  };
  analysis_mode?: 'llm_grounded' | 'structured_fallback';
}

/**
 * Normalizes recoverable local-model shape drift before strict validation.
 * Invalid optional rows are removed independently; required narrative fields
 * are never invented here and still fail the strict contract below.
 */
export function normalizeLLMOutputShape(data: any): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

  const normalized = { ...data };
  const legacyValence: Record<string, -2 | -1 | 0 | 1 | 2> = {
    fearful: -2,
    sad: -2,
    anxious: -1,
    urgent_conflicted: -1,
    neutral: 0,
    mixed: 0,
    calm: 1,
  };
  const requestedValence = Number(data.emotional_valence);
  normalized.emotional_valence = Number.isInteger(requestedValence)
    && requestedValence >= -2
    && requestedValence <= 2
    ? requestedValence
    : (legacyValence[String(data.emotional_tone_key || '')] ?? 0);
  normalized.scientific_context_notes = Array.isArray(data.scientific_context_notes)
    ? data.scientific_context_notes.flatMap((item: any) => {
      if (!item || typeof item !== 'object'
        || typeof item.ruleId !== 'string'
        || typeof item.note !== 'string') return [];
      const { sources: _sources, ...baseItem } = item;
      const sources = Array.isArray(item.sources)
        ? item.sources.filter((source: any) =>
          source
          && typeof source.sourceId === 'string'
          && typeof source.title === 'string'
          && Array.isArray(source.authors))
        : undefined;
      return [{
        ...baseItem,
        confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
        ...(sources ? { sources } : {}),
      }];
    })
    : [];
  normalized.evidence_claims = Array.isArray(data.evidence_claims)
    ? data.evidence_claims.flatMap((item: any) => {
      if (!item || typeof item !== 'object') return [];
      const contentPath = String(item.contentPath || '');
      const claimText = String(item.claimText || '').trim();
      if (!/^core_analysis$|^interpretive_threads\.\d+\.reasoning$/u.test(contentPath)
        || claimText.length < 20) {
        return [];
      }
      const supportRuleId = String(item.supportRuleId || '').trim();
      return [{
        contentPath,
        claimText,
        ...(supportRuleId ? { supportRuleId } : {}),
      }];
    })
    : [];

  normalized.symbolic_notes = Array.isArray(data.symbolic_notes)
    ? data.symbolic_notes.flatMap((item: any) => {
      if (!item || typeof item !== 'object'
        || typeof item.symbol !== 'string'
        || typeof item.meaning !== 'string') return [];
      const {
        origin: _origin,
        contextualTone: _contextualTone,
        ...baseItem
      } = item;
      const origin = ['dictionary', 'contextual_observation'].includes(item.origin)
        ? item.origin
        : undefined;
      const contextualTone = ['threatening', 'reassuring', 'ambivalent', 'neutral']
        .includes(item.contextualTone)
        ? item.contextualTone
        : undefined;
      return [{
        ...baseItem,
        relevance: Math.min(1, Math.max(0, Number(item.relevance) || 0)),
        symbolValence: Number.isFinite(Number(item.symbolValence))
          ? Number(item.symbolValence)
          : 0,
        ...(origin ? { origin } : {}),
        ...(contextualTone ? { contextualTone } : {}),
      }];
    })
    : [];

  normalized.cultural_symbolic_notes = Array.isArray(data.cultural_symbolic_notes)
    ? data.cultural_symbolic_notes.filter((item: any) =>
      item
      && typeof item.source === 'string'
      && typeof item.note === 'string')
    : [];

  normalized.real_life_hypotheses = Array.isArray(data.real_life_hypotheses)
    ? data.real_life_hypotheses.flatMap((item: any) => {
      if (!item || typeof item !== 'object'
        || typeof item.hypothesis !== 'string'
        || typeof item.followUpQuestion !== 'string') return [];
      const { questionType: _questionType, ...baseItem } = item;
      return [{
        ...baseItem,
        evidenceFromDream: Array.isArray(item.evidenceFromDream)
          ? item.evidenceFromDream.filter((entry: unknown) => typeof entry === 'string')
          : [],
        confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
        needsUserConfirmation: item.needsUserConfirmation !== false,
        ...(['past', 'present', 'future'].includes(item.questionType)
          ? { questionType: item.questionType }
          : {}),
      }];
    })
    : [];

  normalized.interpretive_threads = Array.isArray(data.interpretive_threads)
    ? data.interpretive_threads
    : [];
  normalized.practical_reflections = Array.isArray(data.practical_reflections)
    ? data.practical_reflections
    : [];
  normalized.confidence = Math.min(1, Math.max(0, Number(data.confidence) || 0));
  return normalized;
}

/**
 * Validates the parsed JSON against the strict LLM schema.
 */
export function validateLLMOutput(data: any): data is ILLMOutput {
  if (!data || typeof data !== 'object') {
    logger.warn('LLM validation failed: output is not a valid object');
    return false;
  }
  if (typeof data.title !== 'string') {
    logger.warn('LLM validation failed: title is missing or not a string');
    return false;
  }
  if (typeof data.emotional_tone !== 'string') {
    logger.warn('LLM validation failed: emotional_tone is missing or not a string');
    return false;
  }
  if (!Number.isInteger(data.emotional_valence)
    || data.emotional_valence < -2
    || data.emotional_valence > 2) {
    logger.warn('LLM validation failed: emotional_valence must be an integer from -2 to 2');
    return false;
  }
  if (typeof data.summary !== 'string') {
    logger.warn('LLM validation failed: summary is missing or not a string');
    return false;
  }
  if (typeof data.core_analysis !== 'string') {
    logger.warn('LLM validation failed: core_analysis is missing or not a string');
    return false;
  }
  if (typeof data.disclaimer !== 'string') {
    logger.warn('LLM validation failed: disclaimer is missing or not a string');
    return false;
  }

  // Confidence is retained for internal diagnostics; it is not presented as a
  // psychological probability to the user.
  if (typeof data.confidence !== 'number' || data.confidence < 0.0 || data.confidence > 1.0) {
    logger.warn(`LLM validation failed: confidence must be a number between 0.0 and 1.0. Found: ${data.confidence}`);
    return false;
  }

  // Validate arrays
  if (!Array.isArray(data.scientific_context_notes)) {
    logger.warn('LLM validation failed: scientific_context_notes is missing or not an array');
    return false;
  }
  for (const item of data.scientific_context_notes) {
    if (typeof item.ruleId !== 'string') {
      logger.warn('LLM validation failed: scientific_context_notes element missing ruleId');
      return false;
    }
    if (typeof item.note !== 'string') {
      logger.warn('LLM validation failed: scientific_context_notes element missing note');
      return false;
    }
    if (typeof item.confidence !== 'number' || item.confidence < 0.0 || item.confidence > 1.0) {
      logger.warn(`LLM validation failed: scientific_context_notes element confidence invalid: ${item.confidence}`);
      return false;
    }
    if (item.sources !== undefined) {
      if (!Array.isArray(item.sources)) {
        logger.warn('LLM validation failed: scientific_context_notes sources is not an array');
        return false;
      }
      for (const src of item.sources) {
        if (typeof src.sourceId !== 'string') {
          logger.warn('LLM validation failed: scientific_context_notes source missing sourceId');
          return false;
        }
        if (typeof src.title !== 'string') {
          logger.warn('LLM validation failed: scientific_context_notes source missing title');
          return false;
        }
        if (!Array.isArray(src.authors)) {
          logger.warn('LLM validation failed: scientific_context_notes source authors is not an array');
          return false;
        }
      }
    }
  }

  if (!Array.isArray(data.symbolic_notes)) {
    logger.warn('LLM validation failed: symbolic_notes is missing or not an array');
    return false;
  }
  for (const item of data.symbolic_notes) {
    if (typeof item.symbol !== 'string') {
      logger.warn('LLM validation failed: symbolic_notes element missing symbol');
      return false;
    }
    if (typeof item.meaning !== 'string') {
      logger.warn('LLM validation failed: symbolic_notes element missing meaning');
      return false;
    }
    if (typeof item.relevance !== 'number' || item.relevance < 0.0 || item.relevance > 1.0) {
      logger.warn(`LLM validation failed: symbolic_notes element relevance invalid: ${item.relevance}`);
      return false;
    }
    if (typeof item.symbolValence !== 'number') {
      logger.warn('LLM validation failed: symbolic_notes element missing or invalid symbolValence');
      return false;
    }
    if (item.origin !== undefined && !['dictionary', 'contextual_observation'].includes(item.origin)) {
      logger.warn('LLM validation failed: symbolic_notes element origin invalid');
      return false;
    }
    if (item.contextualTone !== undefined && !['threatening', 'reassuring', 'ambivalent', 'neutral'].includes(item.contextualTone)) {
      logger.warn('LLM validation failed: symbolic_notes element contextualTone invalid');
      return false;
    }
  }

  if (!Array.isArray(data.cultural_symbolic_notes)) {
    logger.warn('LLM validation failed: cultural_symbolic_notes is missing or not an array');
    return false;
  }
  for (const item of data.cultural_symbolic_notes) {
    if (typeof item.source !== 'string') {
      logger.warn('LLM validation failed: cultural_symbolic_notes element missing source');
      return false;
    }
    if (typeof item.note !== 'string') {
      logger.warn('LLM validation failed: cultural_symbolic_notes element missing note');
      return false;
    }
  }

  if (!Array.isArray(data.real_life_hypotheses)) {
    logger.warn('LLM validation failed: real_life_hypotheses is missing or not an array');
    return false;
  }
  for (const item of data.real_life_hypotheses) {
    if (typeof item.hypothesis !== 'string') {
      logger.warn('LLM validation failed: real_life_hypotheses element missing hypothesis');
      return false;
    }
    if (!Array.isArray(item.evidenceFromDream)) {
      logger.warn('LLM validation failed: real_life_hypotheses element evidenceFromDream is not an array');
      return false;
    }
    for (const e of item.evidenceFromDream) {
      if (typeof e !== 'string') {
        logger.warn('LLM validation failed: evidenceFromDream contains non-string elements');
        return false;
      }
    }
    if (typeof item.confidence !== 'number' || item.confidence < 0.0 || item.confidence > 1.0) {
      logger.warn(`LLM validation failed: real_life_hypotheses element confidence invalid: ${item.confidence}`);
      return false;
    }
    if (typeof item.needsUserConfirmation !== 'boolean') {
      logger.warn('LLM validation failed: real_life_hypotheses element needsUserConfirmation must be boolean');
      return false;
    }
    if (typeof item.followUpQuestion !== 'string') {
      logger.warn('LLM validation failed: real_life_hypotheses element missing followUpQuestion');
      return false;
    }
    if (item.questionType !== undefined && !['past', 'present', 'future'].includes(item.questionType)) {
      logger.warn('LLM validation failed: real_life_hypotheses element questionType invalid');
      return false;
    }
  }

  if (data.creative_continuation !== undefined) {
    const continuation = data.creative_continuation;
    if (!continuation || typeof continuation !== 'object'
      || typeof continuation.title !== 'string'
      || typeof continuation.continuation !== 'string'
      || typeof continuation.connectionToCurrentDream !== 'string'
      || !Array.isArray(continuation.inspirationIndexes)
      || continuation.inspirationIndexes.some((index: unknown) => !Number.isInteger(index))) {
      // This is an optional creative feature. A malformed continuation must
      // never discard an otherwise valid evidence-grounded dream analysis.
      logger.warn('Dropping malformed optional creative_continuation');
      delete data.creative_continuation;
    }
  }

  return true;
}

export class OllamaServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'OllamaServiceError';
    this.statusCode = statusCode;
  }
}

/**
 * Helper to fetch with timeout.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  if ((!Number.isFinite(timeoutMs) || timeoutMs <= 0) && !externalSignal) {
    return fetch(url, options);
  }
  const controller = new AbortController();
  const id = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true });

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (id) clearTimeout(id);
    return response;
  } catch (err: any) {
    if (id) clearTimeout(id);
    if (err.name === 'AbortError') {
      if (externalSignal?.aborted) throw err;
      throw new OllamaServiceError(`Ollama request timed out after ${timeoutMs}ms`, 503);
    }
    throw err;
  } finally {
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}

/**
 * Generate 768-dimensional text embedding via nomic-embed-text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const embedModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT || '120000', 10);

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/embeddings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: embedModel,
          prompt: text,
        }),
      },
      timeoutMs
    );

    if (!response.ok) {
      throw new OllamaServiceError(`Ollama embeddings HTTP error: Status ${response.status}`, 503);
    }

    const data = await response.json() as { embedding?: number[] };
    if (!data || !Array.isArray(data.embedding)) {
      throw new OllamaServiceError('Invalid response shape from Ollama embeddings endpoint', 503);
    }

    return data.embedding;
  } catch (err: any) {
    if (err instanceof OllamaServiceError) {
      throw err;
    }
    logger.error('Failed to communicate with Ollama embeddings endpoint', err);
    throw new OllamaServiceError(`Ollama connection error: ${err.message}`, 503);
  }
}

export async function generateStructuredJson<T>(
  prompt: string,
  abortSignal?: AbortSignal,
  options: {
    temperature?: number;
    seed?: number;
    numCtx?: number;
    numPredict?: number;
    model?: string;
  } = {},
): Promise<T> {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const model = options.model || process.env.OLLAMA_MODEL || 'qwen2.5:14b';
  const timeoutMs = parseInt(process.env.OLLAMA_ANALYSIS_TIMEOUT || '0', 10);
  const temperature = options.temperature ?? Number(process.env.OLLAMA_DREAM_TEMPERATURE || '0');
  const seed = options.seed ?? parseInt(process.env.OLLAMA_DREAM_SEED || '42', 10);

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          format: 'json',
          stream: false,
          think: false,
          keep_alive: '30m',
          options: {
            temperature: Number.isFinite(temperature) ? temperature : 0,
            seed: Number.isFinite(seed) ? seed : 42,
            ...(Number.isFinite(options.numCtx)
              ? { num_ctx: options.numCtx }
              : {}),
            ...(Number.isFinite(options.numPredict)
              ? { num_predict: options.numPredict }
              : {}),
          },
        }),
      },
      timeoutMs,
      abortSignal,
    );

    if (!response.ok) {
      throw new OllamaServiceError(`Ollama chat HTTP error: Status ${response.status}`, 503);
    }

    const data = await response.json() as { message?: { content?: string } };
    const content = data?.message?.content;
    if (typeof content !== 'string') {
      throw new OllamaServiceError('Invalid response shape from Ollama chat endpoint', 502);
    }

    try {
      return JSON.parse(content) as T;
    } catch (parseErr: any) {
      logger.error('Failed to parse LLM response string as JSON', parseErr);
      throw new OllamaServiceError('Ollama response is not valid JSON', 502);
    }
  } catch (err: any) {
    if (abortSignal?.aborted || err?.name === 'AbortError') throw err;
    if (err instanceof OllamaServiceError) {
      throw err;
    }
    logger.error('Failed to generate analysis using Ollama', err);
    throw new OllamaServiceError(`Ollama connection error: ${err.message}`, 503);
  }
}

/**
 * Generate structured analysis from the compacted context prompt.
 */
export async function generateAnalysis(
  prompt: string,
  abortSignal?: AbortSignal,
  options: { numCtx?: number; numPredict?: number; model?: string } = {},
): Promise<ILLMOutput> {
  let rawResult: Record<string, unknown>;
  try {
    rawResult = await generateStructuredJson<Record<string, unknown>>(
      prompt,
      abortSignal,
      options,
    );
  } catch (error) {
    const fallbackModel = process.env.OLLAMA_FALLBACK_MODEL || 'qwen2.5:14b';
    const requestedModel = options.model || process.env.OLLAMA_MODEL || 'qwen2.5:14b';
    const canRetryWithFallback = error instanceof OllamaServiceError
      && error.statusCode === 503
      && requestedModel !== fallbackModel
      && !abortSignal?.aborted;
    if (!canRetryWithFallback) throw error;

    logger.warn('Primary Ollama model failed; retrying the same analysis with fallback model.', {
      requestedModel,
      fallbackModel,
      error: error.message,
    });
    rawResult = await generateStructuredJson<Record<string, unknown>>(
      prompt,
      abortSignal,
      { ...options, model: fallbackModel },
    );
  }

  const parsedResult = normalizeLLMOutputShape(rawResult);
  if (!validateLLMOutput(parsedResult)) {
    throw new OllamaServiceError('Ollama response JSON does not conform to required output schema', 502);
  }
  return parsedResult;
}
