import mongoose from 'mongoose';
import { logger } from '../../../../../infrastructure/logger';
import Dream from '../../../models/Dream';
import {
  collectPersonalSymbolPatterns,
  extractContextualMotifHints,
} from '../grounding/dreamAnalysisGrounding.service';
import {
  retrieveSimilarDreams,
  SimilarDreamRetrievalResult,
} from '../retrieval/similarDreamRetrieval.service';
import {
  loadObservedSymbolPatterns,
  ObservedSymbolPattern,
} from '../retrieval/symbolObservation.service';
import {
  retrieveSymbolsHybrid,
  SymbolRetrievalResult,
} from '../retrieval/symbolRetrieval.service';

interface DreamAnalysisContext extends SymbolRetrievalResult {
  enrichedSleepContext: Record<string, any>;
  similarDreamResult: SimilarDreamRetrievalResult;
  personalSymbolPatterns: Array<{ symbol: string; occurrences: number; recentMeaning: string }>;
  contextualMotifHints: string[];
  observedSymbolPatterns: ObservedSymbolPattern[];
}

export async function retrieveDreamAnalysisContext(
  userId: string,
  dreamText: string,
  sleepContext: Record<string, any>,
): Promise<DreamAnalysisContext> {
  const symbolResult = await retrieveSymbolsHybrid(dreamText);
  const enrichedSleepContext = { ...(sleepContext || {}) };
  const similarDreamResult = await retrieveSimilarDreams(userId, symbolResult.dreamNarrative, 4);
  const recentDreamRows = await Dream.find({
    userId: new mongoose.Types.ObjectId(userId),
    ai_status: 'completed',
  })
    .select('ai_result.symbolic_notes')
    .sort({ created_at: -1 })
    .limit(30)
    .lean();
  const personalSymbolPatterns = collectPersonalSymbolPatterns(
    recentDreamRows,
    symbolResult.dreamNarrative,
  );
  const contextualMotifHints = extractContextualMotifHints(symbolResult.dreamNarrative);
  let observedSymbolPatterns: ObservedSymbolPattern[] = [];

  try {
    observedSymbolPatterns = await loadObservedSymbolPatterns(
      [
        ...contextualMotifHints,
        ...symbolResult.symbols.flatMap(symbol => [
          symbol.symbol,
          symbol.canonicalSymbol,
          symbol.matchedTextVariant || '',
        ]),
      ],
      new mongoose.Types.ObjectId(userId),
    );
  } catch (error) {
    logger.warn('Observed symbol index unavailable; continuing with dictionary and personal history.', {
      error: String(error),
    });
  }

  return {
    ...symbolResult,
    enrichedSleepContext,
    similarDreamResult,
    personalSymbolPatterns,
    contextualMotifHints,
    observedSymbolPatterns,
  };
}
