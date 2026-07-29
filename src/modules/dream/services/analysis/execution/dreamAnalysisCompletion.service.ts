import type { IDream } from '../../../models/Dream';
import type {
  DreamAnalysisResult,
} from '../orchestration/dreamAnalysisOrchestration.types';
import { resolveDreamAnalysisModel } from '../grounding/dreamAnalysisQuality.service';

export interface DreamCompletionUpdate {
  $set: Record<string, unknown>;
  $unset: Record<string, number>;
}

interface DreamCompletionInput {
  pendingDream: IDream;
  result: DreamAnalysisResult;
  durationMs: number;
  estimatedDurationSeconds: number | null;
  analysisStartedAt: Date;
}

// Builds the fenced database update for one completed analysis run.
export function buildDreamCompletionUpdate(
  input: DreamCompletionInput,
): DreamCompletionUpdate {
  const analysis = input.pendingDream.analysisRun?.trigger === 'citation_migration'
    ? preserveCreativeContinuation(input.pendingDream.ai_result, input.result.aiAnalysis)
    : input.result.aiAnalysis;
  return {
    $set: {
      ai_status: 'completed',
      ai_result: analysis,
      mood_tag: analysis.emotional_tone || '',
      analysisEmbedding: input.result.analysisEmbedding,
      retrievedContext: input.result.retrievedContext,
      analysisMetadata: {
        strategyUsed: input.result.strategyUsed,
        llmModel: resolveDreamAnalysisModel(),
        embeddingModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
        ragTopK: input.result.retrievedContext.componentA.usedSymbols.length,
        minSimilarityScore: parseFloat(process.env.SYMBOL_RAG_MIN_SCORE || '0.55'),
        vectorBackend: input.result.retrievedContext.componentA.retrievalConfig.vectorBackend,
        analysisVersion: '2.0.0-grounded',
        currentStage: 'completed',
        progress: 100,
        statusMessage: 'Phân tích hoàn tất.',
        currentMiniStep: 'Kết quả đã sẵn sàng.',
        stageResults: input.pendingDream.analysisMetadata?.stageResults || {},
        startedAt: input.analysisStartedAt,
        generatedAt: new Date(),
        durationMs: input.durationMs,
        processingDurationMs: input.durationMs,
        estimatedDurationSeconds: input.estimatedDurationSeconds,
        timingDeltaSeconds: input.estimatedDurationSeconds === null
          ? null
          : Math.round(input.durationMs / 1000 - input.estimatedDurationSeconds),
        hasUnanalyzedAdditions: false,
      },
      realLifeHypothesesFeedback: [],
    },
    $unset: {
      analysisRun: 1,
      analysisRollback: 1,
      aiAnalysis: 1,
    },
  };
}

function preserveCreativeContinuation(
  previousAnalysis: Record<string, unknown> | null,
  nextAnalysis: DreamAnalysisResult['aiAnalysis'],
): DreamAnalysisResult['aiAnalysis'] {
  if (!previousAnalysis || typeof previousAnalysis !== 'object') return nextAnalysis;
  const creativeFields = [
    'creative_continuation',
    'creative_continuation_history',
    'creative_continuation_index',
  ] as const;
  const preserved = Object.fromEntries(creativeFields
    .filter((key) => previousAnalysis[key] !== undefined)
    .map((key) => [key, previousAnalysis[key]]));
  return { ...nextAnalysis, ...preserved };
}
