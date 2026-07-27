import { Types } from 'mongoose';
import { logger } from '../../../../../infrastructure/logger';
import Notification from '../../../../social/models/Notification';
import Dream, { IDream } from '../../../models/Dream';
import { runDreamAnalysis } from '../orchestration/analyze.service';
import { DreamAnalysisResult } from '../orchestration/dreamAnalysisOrchestration.types';
import { rollbackDreamAnalysisRun } from './dreamAnalysisRollback.service';
import {
  clearDreamAnalysisController,
  registerDreamAnalysisController,
} from './dreamAnalysisRuntime.service';
import { syncDreamSymbolObservations } from './dreamSymbolObservationSync.service';

interface ActiveAnalysisRun {
  dreamId: Types.ObjectId | string;
  userId: string;
  content: string;
  sleepContext: Record<string, any>;
  runId: string;
  analysisStartedAt: Date;
  processingStartedAt: Date;
  abortController: AbortController;
}

interface DreamCompletionUpdate {
  $set: Record<string, unknown>;
  $unset: Record<string, number>;
}

// Execute one queued analysis behind its run fence and commit only its own result.
export async function runBackgroundAnalysis(
  dreamId: Types.ObjectId | string,
  userId: string,
  content: string,
  sleepContext: Record<string, any>,
  runId: string,
): Promise<void> {
  logger.info(`Starting background analysis for dream ${dreamId}`);
  const run = await startOwnedAnalysisRun({ dreamId, userId, content, sleepContext, runId });
  if (!run) return;

  try {
    const result = await executeDreamAnalysis(run);
    const dream = await commitDreamAnalysis(run, result);
    if (!dream) return;
    await finalizeCompletedDream(dream);
    logger.info(`Background analysis completed successfully for dream ${dreamId}`);
  } catch (error: unknown) {
    await handleAnalysisFailure(run, error);
  } finally {
    clearDreamAnalysisController(String(dreamId), runId, run.abortController);
  }
}

async function startOwnedAnalysisRun(input: {
  dreamId: Types.ObjectId | string;
  userId: string;
  content: string;
  sleepContext: Record<string, any>;
  runId: string;
}): Promise<ActiveAnalysisRun | null> {
  const queuedDream = await Dream.findOne({
    _id: input.dreamId,
    ai_status: 'pending',
    'analysisRun.runId': input.runId,
  }).select('ai_status analysisRun analysisMetadata').lean();
  if (!queuedDream) return null;

  const analysisStartedAt = queuedDream.analysisRun?.startedAt
    ? new Date(queuedDream.analysisRun.startedAt)
    : new Date();
  const processingStartedAt = new Date();
  await Dream.updateOne(
    {
      _id: input.dreamId,
      ai_status: 'pending',
      'analysisRun.runId': input.runId,
    },
    {
      $set: {
        'analysisMetadata.processingStartedAt': processingStartedAt,
        'analysisMetadata.lastProgressAt': processingStartedAt,
      },
    },
  );

  const abortController = new AbortController();
  registerDreamAnalysisController(String(input.dreamId), input.runId, abortController);
  return { ...input, analysisStartedAt, processingStartedAt, abortController };
}

async function executeDreamAnalysis(run: ActiveAnalysisRun): Promise<DreamAnalysisResult> {
  return runDreamAnalysis(
    run.userId,
    run.content,
    run.sleepContext || {},
    async stage => {
      const progressFields: Record<string, unknown> = {
        'analysisMetadata.currentStage': stage.stage,
        'analysisMetadata.progress': stage.progress,
        'analysisMetadata.statusMessage': stage.message,
        'analysisMetadata.currentMiniStep': stage.miniStep || '',
        'analysisMetadata.startedAt': run.analysisStartedAt,
        'analysisMetadata.processingStartedAt': run.processingStartedAt,
        'analysisMetadata.lastProgressAt': new Date(),
      };
      if (stage.resultSummary) {
        progressFields[`analysisMetadata.stageResults.${stage.stage}`] = stage.resultSummary;
      }
      await Dream.updateOne(
        {
          _id: run.dreamId,
          ai_status: 'pending',
          'analysisRun.runId': run.runId,
        },
        { $set: progressFields },
      );
    },
    run.abortController.signal,
  );
}

async function commitDreamAnalysis(
  run: ActiveAnalysisRun,
  result: DreamAnalysisResult,
): Promise<IDream | null> {
  const pendingDream = await Dream.findOne({
    _id: run.dreamId,
    ai_status: 'pending',
    'analysisRun.runId': run.runId,
  });
  if (!pendingDream) {
    logger.warn(`Dream ${run.dreamId} no longer owns analysis run ${run.runId}. Discarding late LLM success.`);
    return null;
  }

  const durationMs = Date.now() - run.processingStartedAt.getTime();
  const estimatedDurationSeconds = Number(
    pendingDream.analysisMetadata?.estimatedDurationSeconds,
  ) || null;
  const update = buildCompletionUpdate({
    pendingDream,
    result,
    durationMs,
    estimatedDurationSeconds,
    analysisStartedAt: run.analysisStartedAt,
  });
  const targetSequences = pendingDream.analysisRun?.targetAdditionSequences
    ?.filter(Number.isInteger) || [];
  const options: { new: true; arrayFilters?: Array<Record<string, unknown>> } = { new: true };
  if (targetSequences.length > 0) {
    update.$set['additions.$[target].analysisState'] = 'analyzed';
    update.$set['additions.$[target].analyzedAt'] = new Date();
    update.$unset['additions.$[target].analysisRunId'] = 1;
    options.arrayFilters = [{ 'target.sequence': { $in: targetSequences } }];
  }

  const completedDream = await Dream.findOneAndUpdate(
    {
      _id: run.dreamId,
      ai_status: 'pending',
      'analysisRun.runId': run.runId,
    },
    update,
    options,
  );
  if (!completedDream) {
    logger.warn(`Dream ${run.dreamId} analysis run ${run.runId} lost its commit fence.`);
  }
  return completedDream;
}

function buildCompletionUpdate(input: {
  pendingDream: IDream;
  result: DreamAnalysisResult;
  durationMs: number;
  estimatedDurationSeconds: number | null;
  analysisStartedAt: Date;
}): DreamCompletionUpdate {
  return {
    $set: {
      ai_status: 'completed',
      ai_result: input.result.aiAnalysis,
      mood_tag: input.result.aiAnalysis.emotional_tone || '',
      analysisEmbedding: input.result.analysisEmbedding,
      retrievedContext: input.result.retrievedContext,
      analysisMetadata: {
        strategyUsed: input.result.strategyUsed,
        llmModel: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
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

async function finalizeCompletedDream(dream: IDream): Promise<void> {
  await syncDreamSymbolObservations(dream);
  try {
    await Notification.create({
      recipientId: dream.userId,
      senderId: dream.userId,
      type: 'dream_analysis',
      postId: dream._id,
    });
  } catch (error: unknown) {
    logger.warn(`Could not persist completion notification for dream ${dream._id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleAnalysisFailure(
  run: ActiveAnalysisRun,
  error: unknown,
): Promise<void> {
  if (isAnalysisCancellation(error)) {
    logger.info(`Background analysis cancelled for dream ${run.dreamId}`);
    return;
  }

  logger.error(`Background analysis failed for dream ${run.dreamId}`, error);
  try {
    await rollbackDreamAnalysisRun(
      run.dreamId,
      run.runId,
      'failed',
      errorMessage(error) || 'An unexpected internal error occurred during dream analysis.',
    );
  } catch (saveError) {
    logger.error(`Failed to mark dream ${run.dreamId} as failed:`, saveError);
  }
}

function isAnalysisCancellation(error: unknown): boolean {
  return error instanceof Error
    && (error.name === 'AbortError' || error.message === 'dream_analysis_cancelled');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
