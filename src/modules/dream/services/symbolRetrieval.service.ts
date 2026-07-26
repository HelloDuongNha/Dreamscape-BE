import { generateEmbedding } from '../../../infrastructure/llm.service';
import { logger } from '../../../infrastructure/logger';
import DreamSymbol from '../models/DreamSymbol';
import {
  extractDreamSegments as segmentDreamNarrative,
  isExplicitSleepContextClause as matchExplicitSleepContext,
  type DreamSegments,
} from './analysis/segmentation/dreamSegmentation.service';
import { rankSymbolCandidates } from './analysis/retrieval/symbolCandidateRanking.service';
import {
  isStrictExactMatch as matchStrictSymbol,
  removeVietnameseDiacritics as foldVietnameseDiacritics,
} from './analysis/retrieval/symbolMatching.service';
import { prepareSymbolQuery } from './analysis/retrieval/symbolQuery.service';
import type {
  RetrievedSymbol,
  SymbolVectorBackend,
} from './analysis/retrieval/symbolRetrieval.types';
import { getSymbolVectorScores } from './analysis/retrieval/symbolVectorSearch.service';

/**
 * Stable public facade for Dream and Oracle callers.
 *
 * The implementation is split by capability under analysis/retrieval, while
 * this file preserves the existing import path and response contract.
 */
export type IRetrievedSymbol = RetrievedSymbol;
export type IDreamSegments = DreamSegments;

export function removeVietnameseDiacritics(value: string): string {
  return foldVietnameseDiacritics(value);
}

export function isStrictExactMatch(
  normalizedSymbol: string,
  tokens: Set<string>,
  ngrams: Set<string>,
  isEnglish: boolean,
): ReturnType<typeof matchStrictSymbol> {
  return matchStrictSymbol(normalizedSymbol, tokens, ngrams, isEnglish);
}

export function isExplicitSleepContextClause(
  clause: string,
): ReturnType<typeof matchExplicitSleepContext> {
  return matchExplicitSleepContext(clause);
}

export function extractDreamSegments(rawText: string): DreamSegments {
  return segmentDreamNarrative(rawText);
}

export interface SymbolRetrievalResult extends DreamSegments {
  symbols: RetrievedSymbol[];
  strategyUsed: 'hybrid_rerank';
  vectorBackend: SymbolVectorBackend;
  extractedKeywords: string[];
}

export async function retrieveSymbolsHybrid(
  dreamText: string,
): Promise<SymbolRetrievalResult> {
  const segments = segmentDreamNarrative(dreamText);
  const query = prepareSymbolQuery(segments.dreamNarrative);
  const offline = process.env.RAG_OFFLINE === 'true';

  const fullTextEmbedding = offline
    ? null
    : await generateEmbedding(segments.dreamNarrative);
  const fullText = await getSymbolVectorScores(fullTextEmbedding);

  const rows = await DreamSymbol.find().lean() as any[];
  const ranked = rankSymbolCandidates({
    rows,
    fullTextScores: fullText.scores,
    normalizedDreamText: query.normalizedText,
    tokens: query.tokens,
    tokenSet: query.tokenSet,
    ngramSet: query.ngramSet,
    minimumScore: Number.parseFloat(process.env.SYMBOL_RAG_MIN_SCORE || '0.55'),
  });

  logger.info('Hybrid RAG symbol retrieval completed', {
    extractedKeywordsCount: query.extractedKeywords.length,
    exactMatchCount: ranked.exactMatchCount,
    fullTextVectorResultCount: ranked.fullTextResultCount,
    finalRerankedSymbolCount: ranked.symbols.length,
    retrievalStrategy: 'hybrid_rerank',
    vectorBackend: fullText.backend,
  });

  return {
    ...segments,
    symbols: ranked.symbols,
    strategyUsed: 'hybrid_rerank',
    vectorBackend: fullText.backend,
    extractedKeywords: query.extractedKeywords,
  };
}
