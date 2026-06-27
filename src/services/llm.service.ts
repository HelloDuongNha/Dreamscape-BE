import { logger } from '../utils/logger';

export interface ILLMOutput {
  title: string;
  emotional_tone: string;
  summary: string;
  scientific_context_notes: {
    ruleId: string;
    note: string;
    confidence: number;
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
  }[];
  cultural_symbolic_notes: {
    source: string;
    note: string;
  }[];
  real_life_hypotheses: {
    hypothesis: string;
    evidenceFromDream: string[];
    confidence: number;
    needsUserConfirmation: boolean;
    followUpQuestion: string;
  }[];
  dreamValenceScore: number;
  confidence: number;
  core_analysis: string;
  disclaimer: string;
  score_breakdown?: any;
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

  // Validate confidence and dreamValenceScore
  if (typeof data.confidence !== 'number' || data.confidence < 0.0 || data.confidence > 1.0) {
    logger.warn(`LLM validation failed: confidence must be a number between 0.0 and 1.0. Found: ${data.confidence}`);
    return false;
  }
  if (typeof data.dreamValenceScore !== 'number' || data.dreamValenceScore < 0 || data.dreamValenceScore > 100) {
    logger.warn(`LLM validation failed: dreamValenceScore must be a number between 0 and 100. Found: ${data.dreamValenceScore}`);
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
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (err: any) {
    clearTimeout(id);
    if (err.name === 'AbortError') {
      throw new OllamaServiceError(`Ollama request timed out after ${timeoutMs}ms`, 503);
    }
    throw err;
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

/**
 * Generate structured analysis from the compacted context prompt.
 */
export async function generateAnalysis(prompt: string): Promise<ILLMOutput> {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL || 'qwen2.5:14b';
  const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT || '120000', 10);

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          format: 'json',
          stream: false,
        }),
      },
      timeoutMs
    );

    if (!response.ok) {
      throw new OllamaServiceError(`Ollama generate HTTP error: Status ${response.status}`, 503);
    }

    const data = await response.json() as { response?: string };
    if (!data || typeof data.response !== 'string') {
      throw new OllamaServiceError('Invalid response shape from Ollama generate endpoint', 502);
    }

    let parsedResult: any;
    try {
      parsedResult = JSON.parse(data.response);
    } catch (parseErr: any) {
      logger.error('Failed to parse LLM response string as JSON', parseErr);
      throw new OllamaServiceError('Ollama response is not valid JSON', 502);
    }

    // Pre-validation sanitization and clamping to resolve range issues
    if (parsedResult && typeof parsedResult === 'object') {
      if (parsedResult.confidence !== undefined) {
        parsedResult.confidence = Math.min(1.0, Math.max(0.0, Number(parsedResult.confidence) || 0.0));
      }
      if (parsedResult.dreamValenceScore !== undefined) {
        parsedResult.dreamValenceScore = Math.min(100, Math.max(0, Math.round(Number(parsedResult.dreamValenceScore) || 0)));
      }
      if (Array.isArray(parsedResult.scientific_context_notes)) {
        parsedResult.scientific_context_notes.forEach((note: any) => {
          if (note && note.confidence !== undefined) {
            note.confidence = Math.min(1.0, Math.max(0.0, Number(note.confidence) || 0.0));
          }
        });
      }
      if (Array.isArray(parsedResult.symbolic_notes)) {
        parsedResult.symbolic_notes.forEach((note: any) => {
          if (note && note.relevance !== undefined) {
            note.relevance = Math.min(1.0, Math.max(0.0, Number(note.relevance) || 0.0));
          }
        });
      }
      if (Array.isArray(parsedResult.real_life_hypotheses)) {
        parsedResult.real_life_hypotheses.forEach((hyp: any) => {
          if (hyp && hyp.confidence !== undefined) {
            hyp.confidence = Math.min(1.0, Math.max(0.0, Number(hyp.confidence) || 0.0));
          }
        });
      }
    }

    if (!validateLLMOutput(parsedResult)) {
      throw new OllamaServiceError('Ollama response JSON does not conform to required output schema', 502);
    }

    return parsedResult;
  } catch (err: any) {
    if (err instanceof OllamaServiceError) {
      throw err;
    }
    logger.error('Failed to generate analysis using Ollama', err);
    throw new OllamaServiceError(`Ollama connection error: ${err.message}`, 503);
  }
}
