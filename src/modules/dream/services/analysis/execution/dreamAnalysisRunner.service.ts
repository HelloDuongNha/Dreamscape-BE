import Dream from '../../../models/Dream';
import Notification from '../../../../social/models/Notification';
import { logger } from '../../../../../infrastructure/logger';
import { runDreamAnalysis } from '../orchestration/analyze.service';
import { rollbackDreamAnalysisRun } from './dreamAnalysisRollback.service';
import { registerDreamAnalysisController, clearDreamAnalysisController } from './dreamAnalysisRuntime.service';
import { syncDreamSymbolObservations } from './dreamSymbolObservationSync.service';

export const runBackgroundAnalysis = async (
  dreamId: any,
  userId: string,
  content: string,
  sleepContext: any,
  runId: string,
): Promise<void> => {
  logger.info(`Starting background analysis for dream ${dreamId}`);
  const queuedDream = await Dream.findOne({
    _id: dreamId,
    ai_status: 'pending',
    'analysisRun.runId': runId,
  }).select('ai_status analysisRun analysisMetadata').lean();
  if (!queuedDream) return;
  const analysisStartedAt = (queuedDream.analysisRun as any)?.startedAt
    ? new Date((queuedDream.analysisRun as any).startedAt)
    : new Date();
  const processingStartedAt = new Date();
  await Dream.updateOne(
    { _id: dreamId, ai_status: 'pending', 'analysisRun.runId': runId },
    {
      $set: {
        'analysisMetadata.processingStartedAt': processingStartedAt,
        'analysisMetadata.lastProgressAt': processingStartedAt,
      },
    },
  );
  const abortController = new AbortController();
  registerDreamAnalysisController(String(dreamId), runId, abortController);

  try {
    // Local models can legitimately take several minutes. Do not turn an estimate
    // into a cancellation deadline; the job remains pending until it finishes or
    // the provider returns a real error.
    const { aiAnalysis, retrievedContext, strategyUsed, analysisEmbedding } = await runDreamAnalysis(
      userId,
      content,
      sleepContext || {},
      async stage => {
        const progressFields: Record<string, unknown> = {
          'analysisMetadata.currentStage': stage.stage,
          'analysisMetadata.progress': stage.progress,
          'analysisMetadata.statusMessage': stage.message,
          'analysisMetadata.currentMiniStep': stage.miniStep || '',
          'analysisMetadata.startedAt': analysisStartedAt,
          'analysisMetadata.processingStartedAt': processingStartedAt,
          'analysisMetadata.lastProgressAt': new Date(),
        };
        if (stage.resultSummary) {
          progressFields[`analysisMetadata.stageResults.${stage.stage}`] = stage.resultSummary;
        }
        await Dream.updateOne(
          { _id: dreamId, ai_status: 'pending', 'analysisRun.runId': runId },
          {
            $set: progressFields,
          }
        );
      },
      abortController.signal,
    );

    const pendingDream = await Dream.findOne({
      _id: dreamId,
      ai_status: 'pending',
      'analysisRun.runId': runId,
    });
    if (!pendingDream) {
      logger.warn(`Dream ${dreamId} no longer owns analysis run ${runId}. Discarding late LLM success.`);
      return;
    }

    const progressHistory = (pendingDream.analysisMetadata as any)?.stageResults || {};
    const estimatedDurationSeconds = Number((pendingDream.analysisMetadata as any)?.estimatedDurationSeconds) || null;
    const durationMs = Date.now() - processingStartedAt.getTime();
    const completedMetadata = {
      strategyUsed,
      llmModel: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
      embeddingModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
      ragTopK: retrievedContext.componentA.usedSymbols.length,
      minSimilarityScore: parseFloat(process.env.SYMBOL_RAG_MIN_SCORE || '0.55'),
      vectorBackend: retrievedContext.componentA.retrievalConfig.vectorBackend,
      analysisVersion: '2.0.0-grounded',
      currentStage: 'completed',
      progress: 100,
      statusMessage: 'Phân tích hoàn tất.',
      currentMiniStep: 'Kết quả đã sẵn sàng.',
      stageResults: progressHistory,
      startedAt: analysisStartedAt,
      generatedAt: new Date(),
      durationMs,
      processingDurationMs: durationMs,
      estimatedDurationSeconds,
      timingDeltaSeconds: estimatedDurationSeconds === null
        ? null
        : Math.round(durationMs / 1000 - estimatedDurationSeconds),
      hasUnanalyzedAdditions: false,
    } as any;
    const targetSequences = Array.isArray((pendingDream.analysisRun as any)?.targetAdditionSequences)
      ? (pendingDream.analysisRun as any).targetAdditionSequences.filter(Number.isInteger)
      : [];
    const completionUpdate: Record<string, any> = {
      $set: {
        ai_status: 'completed',
        ai_result: aiAnalysis as any,
        mood_tag: aiAnalysis.emotional_tone || '',
        analysisEmbedding,
        retrievedContext: retrievedContext as any,
        analysisMetadata: completedMetadata,
        realLifeHypothesesFeedback: [],
      },
      $unset: {
        analysisRun: 1,
        analysisRollback: 1,
        aiAnalysis: 1,
      },
    };
    const completionOptions: Record<string, any> = { new: true };
    if (targetSequences.length > 0) {
      completionUpdate.$set['additions.$[target].analysisState'] = 'analyzed';
      completionUpdate.$set['additions.$[target].analyzedAt'] = new Date();
      completionUpdate.$unset['additions.$[target].analysisRunId'] = 1;
      completionOptions.arrayFilters = [{ 'target.sequence': { $in: targetSequences } }];
    }
    const freshDream = await Dream.findOneAndUpdate(
      { _id: dreamId, ai_status: 'pending', 'analysisRun.runId': runId },
      completionUpdate,
      completionOptions,
    );
    if (!freshDream) {
      logger.warn(`Dream ${dreamId} analysis run ${runId} lost its commit fence.`);
      return;
    }

    await syncDreamSymbolObservations(freshDream);
    try {
      await Notification.create({
        recipientId: freshDream.userId,
        senderId: freshDream.userId,
        type: 'dream_analysis',
        postId: freshDream._id,
      });
    } catch (notificationError) {
      // The analysis result is already durable. A notification failure must not
      // downgrade a completed analysis or make the client retry the LLM job.
      logger.warn(`Could not persist completion notification for dream ${dreamId}`, {
        error: notificationError instanceof Error ? notificationError.message : String(notificationError),
      });
    }
    logger.info(`Background analysis completed successfully for dream ${dreamId}`);
  } catch (err: any) {
    if (err?.name === 'AbortError' || err?.message === 'dream_analysis_cancelled') {
      logger.info(`Background analysis cancelled for dream ${dreamId}`);
      return;
    }
    logger.error(`Background analysis failed for dream ${dreamId}`, err);

    try {
      await rollbackDreamAnalysisRun(
        dreamId,
        runId,
        'failed',
        err.message || 'An unexpected internal error occurred during dream analysis.',
      );
    } catch (saveErr) {
      logger.error(`Failed to mark dream ${dreamId} as failed:`, saveErr);
    }
  } finally {
    clearDreamAnalysisController(String(dreamId), runId, abortController);
  }
};
