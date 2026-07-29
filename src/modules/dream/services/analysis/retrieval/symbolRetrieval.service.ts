import { logger } from '../../../../../infrastructure/logger';
import {
  extractDreamSegments as segmentDreamNarrative,
  isExplicitSleepContextClause as matchExplicitSleepContext,
  type DreamSegments,
} from '../segmentation/dreamSegmentation.service';
import type {
  RetrievedSymbol,
} from './symbolRetrieval.types';

// Coordinates segmentation, vector lookup and ranking without owning their logic.
export type IRetrievedSymbol = RetrievedSymbol;
export type IDreamSegments = DreamSegments;

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
  strategyUsed: 'contextual_observation';
  vectorBackend: 'not_used';
  extractedKeywords: string[];
}

function extractNarrativeKeywords(narrative: string): string[] {
  return [...new Set(
    narrative
      .normalize('NFKC')
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]{2,}/gu) || [],
  )].slice(0, 120);
}

export async function retrieveSymbolsHybrid(
  dreamText: string,
): Promise<SymbolRetrievalResult> {
  const segments = segmentDreamNarrative(dreamText);
  const extractedKeywords = extractNarrativeKeywords(segments.dreamNarrative);

  logger.info('Contextual dream detail retrieval prepared', {
    extractedKeywordsCount: extractedKeywords.length,
    retrievalStrategy: 'contextual_observation',
    vectorBackend: 'not_used',
  });

  return {
    ...segments,
    symbols: [],
    strategyUsed: 'contextual_observation',
    vectorBackend: 'not_used',
    extractedKeywords,
  };
}
