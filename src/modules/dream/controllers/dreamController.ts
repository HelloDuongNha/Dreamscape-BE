import { Request, Response } from 'express';
import Dream, { IDream } from '../models/Dream';
import Comment           from '../../social/models/Comment';
import { Types }         from 'mongoose';
import crypto            from 'crypto';
import Notification      from '../../social/models/Notification';
import User              from '../../identity/models/User';
import { calculateRank } from '../../identity/services/rank.service';
import { runDreamAnalysis } from '../services/analysis/orchestration/analyze.service';
import { OllamaServiceError } from '../../../infrastructure/llm.service';
import { logger } from '../../../infrastructure/logger';
import { retrieveSymbolsHybrid } from '../services/analysis/retrieval/symbolRetrieval.service';
import {
  buildFeedbackChangeSet,
  buildFeedbackConclusion,
  buildFeedbackRevision,
  enrichScientificNotesForResponse,
  reconcileAlternateQuestionAfterFeedback,
  resolveQuestionRuleIds,
} from '../services/analysis/grounding/dreamAnalysisGrounding.service';
import { setRuleValidationFeedback } from '../../rules_v3/services/ruleV3ValidationScore.service';
import { estimateDreamAnalysisSeconds } from '../services/analysis/execution/dreamAnalysisTiming.service';
import {
  composeDreamNarrative,
  mapDreamResponse,
} from '../services/content/dreamNarrative.service';
import { parseCreateDreamRequest } from '../dto/dreamCreate.dto';
import { createPendingDream } from '../services/content/dreamCreate.service';
import { enqueueDreamAnalysis } from '../services/analysis/execution/dreamAnalysisQueue.service';
import {
  abortDreamAnalysisExecution,
  clearDreamAnalysisController,
  registerDreamAnalysisController,
} from '../services/analysis/execution/dreamAnalysisRuntime.service';
import { syncDreamSymbolObservations } from '../services/analysis/execution/dreamSymbolObservationSync.service';

export { composeDreamNarrative };

// ─── POST /api/dreams ─────────────────────────────────────────────────────────

/**
 * Create a new dream. Protected route — requires a valid JWT.
 * The logged-in user's _id is extracted from req.user (set by authMiddleware).
 * ai_status defaults to "pending"; ai_result defaults to null.
 */
export const createDream = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = parseCreateDreamRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({ success: false, message: parsed.message });
      return;
    }

    const { dream, analysisRunId } = await createPendingDream({
      ...parsed.value,
      userId: req.user!._id as Types.ObjectId,
    });

    if (analysisRunId) {
      enqueueDreamAnalysis({
        dreamId: String(dream._id),
        userId: String(req.user!._id),
        runId: analysisRunId,
        execute: () => runBackgroundAnalysis(
          dream._id,
          String(req.user!._id),
          dream.content,
          {},
          analysisRunId,
        ),
      });
    }

    res.status(201).json({
      success: true,
      message: 'Dream created successfully.',
      data: mapDreamResponse(dream),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create dream.', error: err });
  }
};

// ─── POST /api/dreams/:id/comments ──────────────────────────────────────────────

/**
 * Add a comment to a dream. Protected route — requires JWT.
 * Increments dream.comments_count atomically.
 */
export const addComment = async (req: Request, res: Response): Promise<void> => {
  try {
    const myId    = req.user!._id as Types.ObjectId;
    const dreamId = String(req.params.id);

    if (!Types.ObjectId.isValid(dreamId)) {
      res.status(400).json({ success: false, message: 'Invalid dreamId.' });
      return;
    }

    const { content } = req.body as { content?: string };
    if (!content || content.trim() === '') {
      res.status(400).json({ success: false, message: 'content is required.' });
      return;
    }

    // Verify the dream exists
    const dream = await Dream.findById(new Types.ObjectId(dreamId));
    if (!dream) {
      res.status(404).json({ success: false, message: 'Dream not found.' });
      return;
    }

    const comment = await Comment.create({
      dreamId:    new Types.ObjectId(dreamId),
      userId:     myId,
      content:    content.trim(),
    });

    // Increment comment counter atomically
    await Dream.findByIdAndUpdate(
      new Types.ObjectId(dreamId),
      { $inc: { comments_count: 1 } }
    );

    // Populate author for the response so the client can render immediately
    await comment.populate('userId', 'username display_name avatar');

    // Trigger Notification & socket emission for comment (if not post owner)
    if (dream.userId.toString() !== myId.toString()) {
      try {
        const notif = await Notification.create({
          recipientId: dream.userId,
          senderId: myId,
          type: 'comment',
          postId: dream._id,
        });
        await notif.populate('senderId', 'username display_name avatar');
        const io = req.app.get('io');
        if (io) {
          io.to(dream.userId.toString()).emit('new_notification', notif);
        }
        // ── Rank points: post owner gains +15 for a comment ──
        const postOwner = await User.findById(dream.userId);
        if (postOwner) {
          postOwner.rankPoints  += 15;

          // Count post owner's new total likes/comments to check milestones
          const ownerDreams = await Dream.find({ userId: postOwner._id });
          let ownerLikes = 0;
          let ownerComments = 0;
          for (const d of ownerDreams) {
            ownerLikes += d.likes ? d.likes.length : 0;
            ownerComments += d.comments_count ?? 0;
          }

          const { checkAndAwardAchievements } = await import('../../identity/services/rank.service');
          checkAndAwardAchievements(
            postOwner,
            ownerLikes,
            ownerComments,
            ownerDreams.length,
            postOwner.followers ? postOwner.followers.length : 0,
            postOwner.following ? postOwner.following.length : 0,
            postOwner.totalTimeOnline ?? 0
          );

          postOwner.currentRank  = calculateRank(postOwner.rankPoints, postOwner.achievements, postOwner.streakCount, postOwner.highestStreak);
          await postOwner.save();
        }
      } catch (err) {
        console.error('❌ Failed to trigger comment notification:', err);
      }
    }

    res.status(201).json({ success: true, data: comment });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to add comment.', error: err });
  }
};

// ─── GET /api/dreams/:id/comments ────────────────────────────────────────────────

/**
 * Fetch all comments for a dream, sorted chronologically (oldest first).
 * Populates userId with public profile fields.
 */
export const getComments = async (req: Request, res: Response): Promise<void> => {
  try {
    const dreamId = String(req.params.id);

    if (!Types.ObjectId.isValid(dreamId)) {
      res.status(400).json({ success: false, message: 'Invalid dreamId.' });
      return;
    }

    const comments = await Comment.find({ dreamId: new Types.ObjectId(dreamId) })
      .sort({ created_at: 1 })
      .populate('userId', 'username display_name avatar')
      .lean();

    res.status(200).json({ success: true, data: comments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch comments.', error: err });
  }
};

/**
 * Analyze a user's dream using the RAG Orchestration Engine and Ollama.
 * Protected route - requires JWT.
 */
export const analyzeDream = async (req: Request, res: Response): Promise<void> => {
  try {
    const { dreamText, sleepContext, visibility } = req.body as {
      dreamText?: string;
      sleepContext?: Record<string, any>;
      visibility?: 'public' | 'private';
    };

    // Extract userId strictly from the authenticated user context (not req.body)
    const userId = String(req.user!._id);

    // Strict validation
    if (!dreamText || typeof dreamText !== 'string' || dreamText.trim() === '') {
      res.status(400).json({ success: false, message: 'dreamText is required.' });
      return;
    }

    if (dreamText.length > 2000) {
      res.status(400).json({ success: false, message: 'dreamText must not exceed 2000 characters.' });
      return;
    }

    const targetVisibility = visibility || 'private';
    if (!['public', 'private'].includes(targetVisibility)) {
      res.status(400).json({ success: false, message: 'visibility must be "public" or "private".' });
      return;
    }

    logger.info('Starting dream analysis pipeline', { userId, visibility: targetVisibility });

    // Execute the analysis orchestration service
    const { aiAnalysis, retrievedContext, strategyUsed, analysisEmbedding } = await runDreamAnalysis(
      userId,
      dreamText,
      sleepContext || {}
    );

    // Save to Component C (dreams collection) ONLY AFTER all steps completed and validation passed
    const savedDream = new Dream({
      userId: new Types.ObjectId(userId),
      content: dreamText.trim(),
      mood_tag: aiAnalysis.emotional_tone || '',
      is_public: targetVisibility === 'public',
      privacy: targetVisibility,
      ai_status: 'completed',
      ai_result: aiAnalysis as any,
      analysisEmbedding,
      // Auditable analysis fields
      dreamText: dreamText.trim(),
      sleepContext: sleepContext || {},
      visibility: targetVisibility,
      retrievedContext: retrievedContext as any,
      analysisMetadata: {
        strategyUsed,
        llmModel: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
        embeddingModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
        ragTopK: retrievedContext.componentA.usedSymbols.length,
        minSimilarityScore: parseFloat(process.env.SYMBOL_RAG_MIN_SCORE || '0.55'),
        vectorBackend: retrievedContext.componentA.retrievalConfig.vectorBackend,
        analysisVersion: '2.0.0-grounded',
        generatedAt: new Date()
      } as any
    });

    // Explicitly prevent aiAnalysis from being persisted in MongoDB by setting to undefined
    // and deleting it from the internal mongoose document state.
    savedDream.set('aiAnalysis', undefined, { strict: false });
    if ((savedDream as any)._doc) {
      delete (savedDream as any)._doc.aiAnalysis;
    }

    await savedDream.save();
    await syncDreamSymbolObservations(savedDream);

    // Logging: Log retrieval counts, model name, validation status, and saved dream ID.
    // Never log full dreamText in production.
    logger.info('Dream analysis pipeline completed and saved successfully', {
      dreamId: String(savedDream._id),
      userId,
      rulesCount: retrievedContext.componentD.appliedRules.length,
      symbolsCount: retrievedContext.componentA.usedSymbols.length,
      strategyUsed,
      modelUsed: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
      validationStatus: 'passed'
    });

    // Map response for backward compatibility and clean up duplication
    const responseData = mapDreamResponse(savedDream);
    delete responseData.dreamText;

    res.status(201).json({
      success: true,
      message: 'Dream analyzed and saved successfully.',
      data: responseData
    });
  } catch (err: any) {
    // Error Response Policy (No DB saves on fail)
    if (err instanceof OllamaServiceError) {
      logger.error('Ollama Service Error encountered in analysis controller', {
        statusCode: err.statusCode,
        message: err.message
      });
      res.status(err.statusCode).json({
        success: false,
        message: err.message
      });
      return;
    }

    logger.error('Unexpected error encountered in dream analysis controller', err);
    res.status(500).json({
      success: false,
      message: 'An unexpected internal error occurred during dream analysis.',
      error: err.message
    });
  }
};

/**
 * RAG retrieval debug endpoint. Does NOT call Ollama generation.
 * Protected route - requires JWT.
 */
export const debugRag = async (req: Request, res: Response): Promise<void> => {
  try {
    const { dreamText } = req.body as { dreamText?: string };

    // Request-level validation
    if (!dreamText || typeof dreamText !== 'string' || dreamText.trim() === '') {
      res.status(400).json({ success: false, message: 'dreamText is required as a non-empty string.' });
      return;
    }

    const trimmedDreamText = dreamText.trim();
    if (trimmedDreamText.length > 2000) {
      res.status(400).json({ success: false, message: 'dreamText must not exceed 2000 characters.' });
      return;
    }

    logger.info('Executing debug-rag retrieval pipeline', { userId: String(req.user!._id) });

    // Run the hybrid search strategy service
    const { symbols, extractedKeywords } = await retrieveSymbolsHybrid(trimmedDreamText);

    // Map response body keys matching the debug specifications
    const topSymbols = symbols.map((item) => ({
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
      matchedVariants: item.matchedVariants
    }));

    res.status(200).json({
      queryText: trimmedDreamText,
      embeddingDimension: 768,
      retrievalStrategy: 'hybrid_rerank',
      extractedKeywords,
      topSymbols
    });
  } catch (err: any) {
    logger.error('Error in debugRag controller', err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve RAG debug results.',
      error: err.message
    });
  }
};

/**
 * Background analysis helper runner.
 */
async function rollbackDreamAnalysisRun(
  dreamId: Types.ObjectId | string,
  runId: string,
  outcome: 'cancelled' | 'failed',
  errorMessage?: string,
): Promise<IDream | null> {
  const dream = await Dream.findOne({
    _id: dreamId,
    ai_status: 'pending',
    'analysisRun.runId': runId,
  }).select('+analysisRollback');
  if (!dream) return null;

  const run = (dream.analysisRun || {}) as NonNullable<IDream['analysisRun']>;
  const rollback = (dream.analysisRollback || {}) as NonNullable<IDream['analysisRollback']>;
  const now = new Date();
  const startedAt = run.startedAt ? new Date(run.startedAt) : now;
  const targetSequences = Array.isArray(run.targetAdditionSequences)
    ? run.targetAdditionSequences.filter(Number.isInteger)
    : [];
  const isAdditionRun = run.trigger === 'dream_addition'
    || run.trigger === 'addition_retry'
    || run.trigger === 'content_edit'
    || run.trigger === 'addition_edit';
  const hasPreviousAnalysis = rollback.runId === runId && rollback.hadPreviousResult;
  const previousMetadata = rollback.runId === runId && rollback.previousAnalysisMetadata
    ? { ...rollback.previousAnalysisMetadata }
    : {};
  const failedAtStage = String((dream.analysisMetadata as any)?.currentStage || 'preparing');

  const update: Record<string, any> = {
    $set: {
      ai_status: hasPreviousAnalysis ? 'completed' : outcome,
      analysisMetadata: hasPreviousAnalysis
        ? {
            ...previousMetadata,
            lastReplacementOutcome: outcome,
            lastReplacementTrigger: run.trigger,
            replacementEndedAt: now,
            replacementDurationMs: Math.max(0, now.getTime() - startedAt.getTime()),
            hasUnanalyzedAdditions: isAdditionRun || Boolean(previousMetadata.hasUnanalyzedAdditions),
          }
        : {
            ...(dream.analysisMetadata || {}),
            currentStage: outcome,
            ...(outcome === 'failed' ? { failedAtStage } : {}),
            statusMessage: outcome === 'cancelled'
              ? 'Đã hủy phân tích theo yêu cầu.'
              : 'Phân tích chưa hoàn tất. Bạn có thể thử lại.',
            currentMiniStep: '',
            progress: Math.max(0, Number((dream.analysisMetadata as any)?.progress) || 0),
            endedAt: now,
            durationMs: Math.max(0, now.getTime() - startedAt.getTime()),
            lastReplacementOutcome: outcome,
            lastReplacementTrigger: run.trigger,
            hasUnanalyzedAdditions: isAdditionRun,
          },
    },
    $unset: {
      analysisRun: 1,
      analysisRollback: 1,
    },
  };

  if (!hasPreviousAnalysis && outcome === 'failed') {
    update.$set.ai_result = {
      errorSummary: errorMessage || 'An unexpected internal error occurred during dream analysis.',
      title: 'Không thể phân tích',
      summary: 'Oracle chưa thể phân tích giấc mơ này. Vui lòng thử lại sau.',
      emotional_tone: 'Unknown',
      scientific_context_notes: [],
      symbolic_notes: [],
      cultural_symbolic_notes: [],
      real_life_hypotheses: [],
      confidence: 0,
      core_analysis: 'Đã xảy ra lỗi trong quá trình phân tích giấc mơ. Vui lòng thử lại.',
      disclaimer: 'Phân tích không thành công do lỗi hệ thống.',
    };
  }

  const options: Record<string, any> = { new: true };
  if (targetSequences.length > 0) {
    update.$set['additions.$[target].analysisState'] = 'unanalyzed';
    update.$unset['additions.$[target].analysisRunId'] = 1;
    options.arrayFilters = [{ 'target.sequence': { $in: targetSequences } }];
  }

  return Dream.findOneAndUpdate(
    { _id: dreamId, ai_status: 'pending', 'analysisRun.runId': runId },
    update,
    options,
  ).select('+analysisRollback');
}

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
    const durationMs = Date.now() - analysisStartedAt.getTime();
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

/**
 * Rebuilds the fair in-memory scheduler from persisted pending Dream runs.
 * A process restart therefore delays a job instead of silently losing it.
 */
export async function recoverPendingDreamAnalysisQueue(): Promise<number> {
  const pendingDreams = await Dream.find({
    ai_status: 'pending',
    'analysisRun.runId': { $exists: true, $ne: '' },
  })
    .select('_id userId content additions sleepContext analysisRun')
    .sort({ created_at: 1 })
    .lean();

  let recovered = 0;
  for (const dream of pendingDreams) {
    const runId = String((dream as any)?.analysisRun?.runId || '').trim();
    const userId = String((dream as any)?.userId || '').trim();
    if (!runId || !userId) continue;

    const scheduled = enqueueDreamAnalysis({
      dreamId: String((dream as any)._id),
      userId,
      runId,
      execute: () => runBackgroundAnalysis(
        (dream as any)._id,
        userId,
        composeDreamNarrative(
          String((dream as any).content || ''),
          Array.isArray((dream as any).additions) ? (dream as any).additions : [],
        ),
        (dream as any).sleepContext || {},
        runId,
      ),
    });
    if (scheduled) recovered += 1;
  }

  if (recovered > 0) {
    logger.info('Recovered pending Dream analysis jobs after startup.', { recovered });
  }
  return recovered;
}

/**
 * Retry analyzing an existing dream.
 * POST /api/dreams/:id/analyze
 */
export const analyzeDreamById = async (req: Request, res: Response): Promise<void> => {
  try {
    const dreamId = String(req.params.id);
    if (!Types.ObjectId.isValid(dreamId)) {
      res.status(400).json({ success: false, message: 'Invalid dream ID.' });
      return;
    }

    const dream = await Dream.findById(new Types.ObjectId(dreamId));
    if (!dream) {
      res.status(404).json({ success: false, message: 'Dream not found.' });
      return;
    }

    // Verify ownership
    if (dream.userId.toString() !== req.user!._id.toString()) {
      res.status(403).json({ success: false, message: 'Access denied. You do not own this dream.' });
      return;
    }
    if (dream.ai_analysis_enabled === false) {
      res.status(409).json({
        success: false,
        message: 'Enable AI analysis for this post before requesting a reanalysis.',
      });
      return;
    }

    // Reject if already pending
    if (dream.ai_status === 'pending') {
      res.status(400).json({ success: false, message: 'Analysis is already running for this dream.' });
      return;
    }

    // Update status to pending
    const completeNarrative = composeDreamNarrative(dream.content, dream.additions || []);
    const analysisStartedAt = new Date();
    const analysisRunId = crypto.randomUUID();
    const targetAdditionSequences = (dream.additions || [])
      .filter(addition => addition.analysisState === 'unanalyzed' || addition.analysisState === 'pending')
      .map(addition => addition.sequence);
    const trigger = targetAdditionSequences.length > 0 ? 'addition_retry' : 'retry';
    const previousStatus = dream.ai_status;
    const previousAnalysisMetadata = dream.analysisMetadata
      ? { ...(dream.analysisMetadata as Record<string, any>) }
      : null;
    const estimatedDurationSeconds = await estimateDreamAnalysisSeconds(req.user!._id as Types.ObjectId, completeNarrative);
    dream.ai_status = 'pending';
    for (const addition of dream.additions || []) {
      if (!targetAdditionSequences.includes(addition.sequence)) continue;
      addition.analysisState = 'pending';
      addition.analysisRunId = analysisRunId;
    }
    dream.analysisMetadata = {
      currentStage: 'queued',
      progress: 0,
      statusMessage: 'Đã thêm lần thử lại vào hàng chờ.',
      currentMiniStep: 'Tác vụ sẽ tự bắt đầu khi tới lượt.',
      queuePosition: 1,
      stageResults: {},
      enqueuedAt: analysisStartedAt,
      startedAt: analysisStartedAt,
      lastProgressAt: analysisStartedAt,
      estimatedDurationSeconds,
      trigger,
      runId: analysisRunId,
    };
    dream.analysisRun = {
      runId: analysisRunId,
      trigger,
      startedAt: analysisStartedAt,
      previousStatus,
      targetAdditionSequences,
    };
    dream.analysisRollback = {
      runId: analysisRunId,
      previousStatus,
      hadPreviousResult: previousStatus === 'completed' && Boolean(dream.ai_result),
      previousAnalysisMetadata,
    };
    dream.markModified('analysisMetadata');
    dream.markModified('analysisRun');
    dream.markModified('analysisRollback');
    dream.markModified('additions');
    await dream.save();

    enqueueDreamAnalysis({
      dreamId: String(dream._id),
      userId: String(req.user!._id),
      runId: analysisRunId,
      execute: () => runBackgroundAnalysis(
        dream._id,
        String(req.user!._id),
        completeNarrative,
        dream.sleepContext || {},
        analysisRunId,
      ),
    });

    res.status(200).json({
      success: true,
      message: 'Dream analysis restarted successfully.',
      data: mapDreamResponse(dream),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to restart dream analysis.', error: err.message });
  }
};

/**
 * Cancel a running analysis without deleting the dream. A late provider result
 * cannot overwrite the cancelled state because runBackgroundAnalysis persists
 * only while ai_status remains pending.
 */
export const cancelDreamAnalysis = async (req: Request, res: Response): Promise<void> => {
  const dreamId = String(req.params.id);
  if (!Types.ObjectId.isValid(dreamId)) {
    res.status(400).json({ success: false, message: 'Invalid dream ID.' });
    return;
  }
  const dream = await Dream.findOne({
    _id: new Types.ObjectId(dreamId),
    userId: req.user!._id,
  }).select('+analysisRollback');
  if (!dream) {
    res.status(404).json({ success: false, message: 'Dream not found.' });
    return;
  }
  if (dream.ai_status !== 'pending') {
    res.status(409).json({ success: false, message: 'Dream analysis is not running.' });
    return;
  }

  const runId = String((dream.analysisRun as any)?.runId || '');
  if (!runId) {
    res.status(409).json({ success: false, message: 'Dream analysis run is missing.' });
    return;
  }

  abortDreamAnalysisExecution(dreamId, runId);
  const restoredDream = await rollbackDreamAnalysisRun(dreamId, runId, 'cancelled');
  if (!restoredDream) {
    res.status(409).json({ success: false, message: 'Dream analysis has already finished.' });
    return;
  }
  res.status(200).json({
    success: true,
    message: 'Dream analysis cancelled.',
    data: mapDreamResponse(restoredDream),
  });
};

/**
 * Save user feedback for a real-life hypothesis.
 * POST /api/dreams/:id/hypothesis-feedback
 */
export const saveHypothesisFeedback = async (req: Request, res: Response): Promise<void> => {
  try {
    const dreamId = String(req.params.id);
    const userId = String(req.user!._id);
    const { hypothesisIndex, verificationKey: requestedVerificationKey, answer } = req.body as {
      hypothesisIndex?: number;
      verificationKey?: string;
      answer: 'yes' | 'no' | 'unsure' | null;
    };

    if (!Types.ObjectId.isValid(dreamId)) {
      res.status(400).json({ success: false, message: 'ID giấc mơ không hợp lệ.' });
      return;
    }

    const hasValidIndex = typeof hypothesisIndex === 'number' && Number.isInteger(hypothesisIndex) && hypothesisIndex >= 0;
    const cleanRequestedKey = String(requestedVerificationKey || '').trim();
    if (!hasValidIndex && !cleanRequestedKey) {
      res.status(400).json({ success: false, message: 'Thiếu mã câu hỏi hợp lệ.' });
      return;
    }

    const isClearingAnswer = answer === null;
    if (!isClearingAnswer && !['yes', 'no', 'unsure'].includes(answer as string)) {
      res.status(400).json({ success: false, message: 'Câu trả lời không hợp lệ.' });
      return;
    }

    const dream = await Dream.findById(new Types.ObjectId(dreamId));
    if (!dream) {
      res.status(404).json({ success: false, message: 'Không tìm thấy giấc mơ.' });
      return;
    }

    // 1. Verify dream ownership
    if (dream.userId.toString() !== userId) {
      res.status(403).json({ success: false, message: 'Bạn không có quyền thực hiện hành động này.' });
      return;
    }

    // 2. Validate index against stored hypotheses in ai_result / aiAnalysis
    const activeAnalysis = dream.ai_result || (dream as any).aiAnalysis || {};
    const completeNarrative = composeDreamNarrative(dream.content || '', dream.additions || []);
    const renderedAnalysis = enrichScientificNotesForResponse(
      activeAnalysis,
      dream.retrievedContext,
      completeNarrative,
    );
    const hypotheses = (renderedAnalysis as any).real_life_hypotheses;
    const matchedIndex = Array.isArray(hypotheses)
      ? (cleanRequestedKey
          ? hypotheses.findIndex((item: any) => String(item?.verificationKey || '') === cleanRequestedKey)
          : Number(hypothesisIndex))
      : -1;
    if (!Array.isArray(hypotheses) || matchedIndex < 0 || matchedIndex >= hypotheses.length) {
      res.status(400).json({ success: false, message: 'Không tìm thấy câu hỏi tương ứng.' });
      return;
    }

    const matchedHypothesis = hypotheses[matchedIndex];
    if (!matchedHypothesis || !matchedHypothesis.followUpQuestion) {
      res.status(400).json({ success: false, message: 'Không tìm thấy câu hỏi tương ứng cho giả thuyết này.' });
      return;
    }

    // Get questionText from DB, do not trust frontend payload blindly
    const questionText = matchedHypothesis.followUpQuestion;
    const linkedRuleIds = resolveQuestionRuleIds(matchedHypothesis);
    const ruleId = linkedRuleIds[0];
    if (!ruleId) {
      res.status(400).json({
        success: false,
        message: 'Câu hỏi này không gắn với một lập luận đã duyệt nên không thể dùng để xác minh.'
      });
      return;
    }
    const verificationKey = matchedHypothesis.verificationKey
      ? String(matchedHypothesis.verificationKey)
      : undefined;
    const declaredEffect = isClearingAnswer ? undefined : matchedHypothesis.answerSemantics?.[answer as 'yes' | 'no' | 'unsure'];
    const effect: 'supports' | 'weakens' | 'unresolved' = ['supports', 'weakens', 'unresolved'].includes(declaredEffect)
      ? declaredEffect
      : 'unresolved';

    // 3. Update realLifeHypothesesFeedback source of truth
    if (!dream.realLifeHypothesesFeedback) {
      dream.realLifeHypothesesFeedback = [];
    }

    // One precomputed question may represent the same requested datum for
    // several rules. Persist one feedback row per linked rule so each rule's
    // moderation statistics are updated without asking the user twice.
    for (const linkedRuleId of linkedRuleIds) {
      const existingIndex = dream.realLifeHypothesesFeedback.findIndex(
        (f: any) => (verificationKey
          ? f.verificationKey === verificationKey
          : f.hypothesisIndex === hypothesisIndex)
          && String(f.ruleId || '') === linkedRuleId
      );
      const feedbackEntry = {
        hypothesisIndex: matchedIndex,
        ruleId: linkedRuleId,
        ...(verificationKey ? { verificationKey } : {}),
        answer: answer as 'yes' | 'no' | 'unsure',
        effect,
        questionText,
        userId: new Types.ObjectId(userId),
        updatedAt: new Date()
      };
      if (isClearingAnswer && existingIndex !== -1) {
        dream.realLifeHypothesesFeedback.splice(existingIndex, 1);
      } else if (!isClearingAnswer && existingIndex !== -1) {
        dream.realLifeHypothesesFeedback[existingIndex] = feedbackEntry;
      } else if (!isClearingAnswer) {
        dream.realLifeHypothesesFeedback.push(feedbackEntry);
      }
    }

    if (String(matchedHypothesis?.questionDimension || '') === 'external_sound_at_wake') {
      const nextSleepContext = { ...(dream.sleepContext || {}) };
      if (isClearingAnswer || answer === 'unsure') delete nextSleepContext.externalSoundAtWake;
      else nextSleepContext.externalSoundAtWake = answer === 'yes';
      dream.sleepContext = nextSleepContext;
      dream.markModified('sleepContext');
      const retrievedContext = (dream.retrievedContext || {}) as any;
      retrievedContext.componentA = retrievedContext.componentA || {};
      retrievedContext.componentA.sleepContext = nextSleepContext;
      dream.retrievedContext = retrievedContext;
      dream.markModified('retrievedContext');
    }

    // 4. Re-materialize the complete analysis from the new answer. Feedback is
    // not a counter: it changes the synthesis, retained interpretation threads,
    // contextual details and practical next steps returned to the reader.
    hypotheses[matchedIndex].userFeedback = isClearingAnswer ? null : answer;
    const activeHypotheses = verificationKey
      ? reconcileAlternateQuestionAfterFeedback(hypotheses, verificationKey, answer)
      : hypotheses;
    const feedbackRevision = buildFeedbackRevision(
      activeHypotheses,
      dream.realLifeHypothesesFeedback || [],
    );
    const analysisWithFeedback = {
      ...renderedAnalysis,
      real_life_hypotheses: activeHypotheses,
      feedback_revision: feedbackRevision,
      feedback_conclusion: buildFeedbackConclusion(feedbackRevision),
    };
    const refreshedAnalysis = enrichScientificNotesForResponse(
      analysisWithFeedback,
      dream.retrievedContext,
      completeNarrative,
    );
    const feedbackChanges = buildFeedbackChangeSet(renderedAnalysis, refreshedAnalysis);
    refreshedAnalysis.feedback_changed_paths = feedbackChanges.paths;
    refreshedAnalysis.feedback_changed_fragments = feedbackChanges.fragments;
    dream.ai_result = refreshedAnalysis;
    dream.markModified('ai_result');
    if ((dream as any).aiAnalysis) {
      (dream as any).aiAnalysis = refreshedAnalysis;
      dream.markModified('aiAnalysis');
    }

    await dream.save();
    const ruleScoreUpdates = await setRuleValidationFeedback({
      userId: new Types.ObjectId(userId),
      verificationKey: verificationKey || `${ruleId}:${matchedIndex}`,
      origin: 'dream_analysis',
      originId: dream._id as Types.ObjectId,
      questionText,
      answer,
      directRuleIds: linkedRuleIds,
      sourceId: String(matchedHypothesis.validationSourceId || '').trim() || undefined,
      exactQuote: String(matchedHypothesis.validationExactQuote || '').trim() || undefined,
    });
    await syncDreamSymbolObservations(dream);

    res.status(200).json({
      success: true,
      message: isClearingAnswer ? 'Đã bỏ lựa chọn.' : 'Đã ghi nhận phản hồi.',
      data: {
        feedback: dream.realLifeHypothesesFeedback,
        feedbackRevision: refreshedAnalysis?.feedback_revision || [],
        feedbackConclusion: refreshedAnalysis?.feedback_conclusion || null,
        analysis: refreshedAnalysis,
        ruleScoreUpdates,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Không thể lưu phản hồi.', error: err.message });
  }
};
