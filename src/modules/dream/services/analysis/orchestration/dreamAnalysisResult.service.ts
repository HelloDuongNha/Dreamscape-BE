import { ILLMOutput } from '../../../../../infrastructure/llm.service';
import {
  DreamAnalysisReporter,
  DreamAnalysisResult,
} from './dreamAnalysisOrchestration.types';
import { retrieveDreamAnalysisContext } from './dreamContextRetrieval.service';
import { retrieveDreamRuleEvidence } from './dreamRuleEvidence.service';

interface BuildDreamAnalysisResultInput {
  context: Awaited<ReturnType<typeof retrieveDreamAnalysisContext>>;
  rules: Awaited<ReturnType<typeof retrieveDreamRuleEvidence>>;
  analysis: ILLMOutput;
  report: DreamAnalysisReporter;
}

// Build the persisted analysis result and its retrieval audit trail.
export async function buildDreamAnalysisResult(
  input: BuildDreamAnalysisResultInput,
): Promise<DreamAnalysisResult> {
  const usedSymbols = input.context.symbols.map(symbol => ({
    symbol: symbol.symbol,
    category: symbol.category,
    symbolValence: symbol.symbolValence,
    rawSimilarityScore: symbol.rawSimilarityScore,
    adjustedScore: symbol.adjustedScore,
    retrievalMethods: symbol.retrievalMethods,
    lowConfidence: symbol.lowConfidence,
    fallbackReason: symbol.fallbackReason,
    boostReasons: symbol.boostReasons,
    suppressedBoostReasons: symbol.suppressedBoostReasons,
    canonicalSymbol: symbol.canonicalSymbol,
    matchedVariants: symbol.matchedVariants,
    matchedTextVariant: symbol.matchedTextVariant,
  }));
  await input.report(
    'finalizing',
    96,
    'Đang hoàn tất kết quả phân tích...',
    'Đang lưu bản phân tích và dấu vết dữ liệu đã sử dụng.',
    `Giữ lại ${input.analysis.symbolic_notes?.length || 0} chi tiết nổi bật, ${input.analysis.scientific_context_notes?.length || 0} giải thích có nguồn, ${input.analysis.real_life_hypotheses?.length || 0} câu hỏi làm rõ và ${input.analysis.similar_dreams?.length || 0} giấc mơ tương đồng.`,
  );

  return {
    aiAnalysis: input.analysis,
    analysisEmbedding: input.context.similarDreamResult.queryEmbedding,
    retrievedContext: {
      componentA: {
        rawText: input.context.rawText,
        dreamNarrative: input.context.dreamNarrative,
        wakingReactionText: input.context.wakingReactionText,
        sleepContextText: input.context.sleepContextText,
        sleepContext: input.context.enrichedSleepContext,
        segmentationReasons: input.context.segmentationReasons,
        usedSymbols,
        retrievalConfig: {
          topK: usedSymbols.length,
          minSimilarityScore: parseFloat(process.env.SYMBOL_RAG_MIN_SCORE || '0.55'),
          embeddingModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
          retrievalStrategy: input.context.strategyUsed,
          vectorBackend: input.context.vectorBackend,
        },
      },
      componentC: {
        similarDreams: input.context.similarDreamResult.matches,
        personalSymbolPatterns: input.context.personalSymbolPatterns,
        observedSymbolPatterns: input.context.observedSymbolPatterns,
      },
      componentD: {
        appliedRules: input.rules.matchedRules,
        evidenceLinks: input.rules.evidenceLinksAudit,
      },
    },
    strategyUsed: input.context.strategyUsed,
  };
}
