import type { Request, Response } from 'express';
import { logger } from '../../../infrastructure/logger';
import { retrieveSymbolsHybrid } from '../services/analysis/retrieval/symbolRetrieval.service';

// Returns retrieval diagnostics without invoking answer generation.
export async function debugRag(req: Request, res: Response): Promise<void> {
  try {
    const { dreamText } = req.body as { dreamText?: string };
    if (!dreamText || typeof dreamText !== 'string' || dreamText.trim() === '') {
      res.status(400).json({
        success: false,
        message: 'dreamText is required as a non-empty string.',
      });
      return;
    }

    const trimmedDreamText = dreamText.trim();
    if (trimmedDreamText.length > 2000) {
      res.status(400).json({
        success: false,
        message: 'dreamText must not exceed 2000 characters.',
      });
      return;
    }

    logger.info('Executing debug-rag retrieval pipeline', { userId: String(req.user!._id) });
    const { symbols, extractedKeywords } = await retrieveSymbolsHybrid(trimmedDreamText);
    const topSymbols = symbols.map(item => ({
      symbol: item.symbol,
      category: item.category,
      symbolValence: item.symbolValence,
      rawSimilarityScore: item.rawSimilarityScore,
      adjustedScore: item.adjustedScore,
      retrievalMethods: item.retrievalMethods,
      lowConfidence: item.lowConfidence,
      interpretationPreview: item.interpretation || '',
      boostReasons: item.boostReasons,
      suppressedBoostReasons: item.suppressedBoostReasons,
      canonicalSymbol: item.canonicalSymbol,
      matchedVariants: item.matchedVariants,
    }));

    res.status(200).json({
      queryText: trimmedDreamText,
      embeddingDimension: 768,
      retrievalStrategy: 'hybrid_rerank',
      extractedKeywords,
      topSymbols,
    });
  } catch (error: any) {
    logger.error('Error in debugRag controller', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve RAG debug results.',
      error: error.message,
    });
  }
}
