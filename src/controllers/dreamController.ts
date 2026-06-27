import { Request, Response } from 'express';
import Dream, { IDream } from '../models/Dream';
import Comment           from '../models/Comment';
import { Types }         from 'mongoose';
import Notification      from '../models/Notification';
import User              from '../models/User';
import { calculateRank } from '../utils/rankEngine';
import { runDreamAnalysis } from '../services/analyze.service';
import { OllamaServiceError } from '../services/llm.service';
import { logger } from '../utils/logger';
import { retrieveSymbolsHybrid } from '../services/symbolRetrieval.service';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Standard paginated response wrapper returned by all feed endpoints.
 */
interface PaginatedResponse {
  success: boolean;
  data: IDream[];
  limit: number;
  nextCursor: string | null; // ISO-8601 created_at of the last item, or null
}

// ─── Helper: Parse & Validate Pagination Params ───────────────────────────────

function parsePaginationParams(query: Request['query']): {
  limit: number;
  cursor: Date | null;
} {
  const rawLimit = parseInt(String(query.limit ?? '10'), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10;

  const rawCursor = query.nextCursor;
  let cursor: Date | null = null;
  if (typeof rawCursor === 'string' && rawCursor.trim() !== '') {
    const parsed = new Date(rawCursor);
    cursor = isNaN(parsed.getTime()) ? null : parsed;
  }

  return { limit, cursor };
}

function mapDreamResponse(dream: any): any {
  if (!dream) return dream;
  const obj = typeof dream.toObject === 'function' ? dream.toObject() : { ...dream };
  if (obj.ai_result) {
    obj.aiAnalysis = obj.ai_result;
  }
  return obj;
}

// ─── POST /api/dreams ─────────────────────────────────────────────────────────

/**
 * Create a new dream. Protected route — requires a valid JWT.
 * The logged-in user's _id is extracted from req.user (set by authMiddleware).
 * ai_status defaults to "pending"; ai_result defaults to null.
 */
export const createDream = async (req: Request, res: Response): Promise<void> => {
  try {
    const { content, mood_tag, is_public } = req.body as {
      content:   string;
      mood_tag?: string;
      is_public?: boolean;
    };

    if (!content || content.trim() === '') {
      res.status(400).json({ success: false, message: 'Dream content is required.' });
      return;
    }

    const dream = await Dream.create({
      userId:    req.user!._id as Types.ObjectId,
      content:   content.trim(),
      mood_tag:  mood_tag?.trim() ?? '',
      is_public: is_public !== undefined ? is_public : true,
      // ai_status and ai_result use schema defaults ('pending' and null)
    });

    // Kick off background analysis (never await this so the HTTP response is immediate)
    setImmediate(() => {
      runBackgroundAnalysis(dream._id, String(req.user!._id), dream.content, {});
    });

    res.status(201).json({
      success: true,
      message: 'Dream created successfully.',
      data: mapDreamResponse(dream),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create dream.', error: err });
  }
};

// ─── GET /api/dreams ──────────────────────────────────────────────────────────

/**
 * Global public feed — returns only is_public: true dreams.
 * Uses cursor-based pagination via the created_at timestamp to avoid the
 * performance degradation of offset/skip on large collections.
 *
 * Query params:
 *   limit      — max documents to return (default 10, max 100)
 *   nextCursor — ISO-8601 created_at of the last seen item; only docs
 *                OLDER than this cursor are returned ($lt comparison)
 */
export const getPublicFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit, cursor } = parsePaginationParams(req.query);

    const filter: Record<string, unknown> = { is_public: true };
    if (cursor) {
      filter['created_at'] = { $lt: cursor };
    }

    const dreams = await Dream.find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .populate('userId', 'username display_name avatar')
      .lean();

    const nextCursor =
      dreams.length === limit
        ? (dreams[dreams.length - 1] as IDream).created_at.toISOString()
        : null;

    const response: PaginatedResponse = {
      success: true,
      data: dreams.map(mapDreamResponse) as unknown as IDream[],
      limit,
      nextCursor,
    };

    res.status(200).json(response);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch feed.', error: err });
  }
};

// ─── GET /api/dreams/user/:userId ─────────────────────────────────────────────

/**
 * Personal archive — returns all dreams (public + private) for a given userId.
 * Used by the Profile page. Same cursor-based pagination as the global feed.
 *
 * Path param:  userId — MongoDB ObjectId of the target user
 * Query params: limit, nextCursor (same semantics as getPublicFeed)
 */
export const getUserDreams = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = String(req.params.userId);

    if (!Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid userId format.' });
      return;
    }

    const { limit, cursor } = parsePaginationParams(req.query);

    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (cursor) {
      filter['created_at'] = { $lt: cursor };
    }

    const dreams = await Dream.find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .populate('userId', 'username display_name avatar')
      .lean();

    const nextCursor =
      dreams.length === limit
        ? (dreams[dreams.length - 1] as IDream).created_at.toISOString()
        : null;

    const response: PaginatedResponse = {
      success: true,
      data: dreams.map(mapDreamResponse) as unknown as IDream[],
      limit,
      nextCursor,
    };

    res.status(200).json(response);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch user dreams.', error: err });
  }
};

// ─── PUT /api/dreams/:id ──────────────────────────────────────────────────────

/**
 * Edit a dream's content. Only the owner may edit.
 * Before saving the new content, the old content is pushed to edit_history
 * so the UI can display an "Edited" badge when edit_history.length > 0.
 */
export const updateDream = async (req: Request, res: Response): Promise<void> => {
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

    const dream = await Dream.findOne({ _id: new Types.ObjectId(dreamId), userId: myId });

    if (!dream) {
      res.status(403).json({ success: false, message: 'Not found or access denied.' });
      return;
    }

    // Archive the current content before overwriting
    dream.edit_history.push({ content: dream.content, editedAt: new Date() });
    dream.content = content.trim();

    await dream.save();

    res.status(200).json({ success: true, message: 'Dream updated.', data: mapDreamResponse(dream) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update dream.', error: err });
  }
};

// ─── DELETE /api/dreams/:id ───────────────────────────────────────────────────

/**
 * Permanently delete a dream. Only the owner may delete.
 */
export const deleteDream = async (req: Request, res: Response): Promise<void> => {
  try {
    const myId    = req.user!._id as Types.ObjectId;
    const dreamId = String(req.params.id);

    if (!Types.ObjectId.isValid(dreamId)) {
      res.status(400).json({ success: false, message: 'Invalid dreamId.' });
      return;
    }

    const result = await Dream.findOneAndDelete({ _id: new Types.ObjectId(dreamId), userId: myId });

    if (!result) {
      res.status(403).json({ success: false, message: 'Not found or access denied.' });
      return;
    }

    // Cascade delete associated comments
    await Comment.deleteMany({ dreamId: new Types.ObjectId(dreamId) });

    // Cascade delete notifications linked to this dream
    await Notification.deleteMany({ postId: new Types.ObjectId(dreamId) });

    res.status(200).json({ success: true, message: 'Dream deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete dream.', error: err });
  }
};

// ─── PATCH /api/dreams/:id/privacy ───────────────────────────────────────────

/**
 * Update the privacy setting of a dream. Only the owner may change it.
 * Keeps `is_public` in sync with the `privacy` field.
 */
export const updatePrivacy = async (req: Request, res: Response): Promise<void> => {
  try {
    const myId    = req.user!._id as Types.ObjectId;
    const dreamId = String(req.params.id);

    if (!Types.ObjectId.isValid(dreamId)) {
      res.status(400).json({ success: false, message: 'Invalid dreamId.' });
      return;
    }

    const { privacy } = req.body as { privacy?: 'public' | 'private' };
    if (!privacy || !['public', 'private'].includes(privacy)) {
      res.status(400).json({ success: false, message: 'privacy must be "public" or "private".' });
      return;
    }

    const dream = await Dream.findOneAndUpdate(
      { _id: new Types.ObjectId(dreamId), userId: myId },
      { $set: { privacy, is_public: privacy === 'public' } },
      { new: true }
    );

    if (!dream) {
      res.status(403).json({ success: false, message: 'Not found or access denied.' });
      return;
    }

    res.status(200).json({ success: true, message: 'Privacy updated.', data: mapDreamResponse(dream) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update privacy.', error: err });
  }
};

// ─── POST /api/dreams/:id/like ────────────────────────────────────────────────

/**
 * Toggle like on a dream.
 * - If myId is NOT in likes[] → push it and increment likes_count.
 * - If myId IS  in likes[] → pull it and decrement likes_count.
 * Returns: { liked: boolean, likes_count: number, likes: string[] }
 */
export const toggleLike = async (req: Request, res: Response): Promise<void> => {
  try {
    const myId    = String(req.user!._id);
    const dreamId = String(req.params.id);

    if (!Types.ObjectId.isValid(dreamId)) {
      res.status(400).json({ success: false, message: 'Invalid dreamId.' });
      return;
    }

    const dream = await Dream.findById(new Types.ObjectId(dreamId));
    if (!dream) {
      res.status(404).json({ success: false, message: 'Dream not found.' });
      return;
    }

    const alreadyLiked = dream.likes.includes(myId);

    if (alreadyLiked) {
      // Unlike
      dream.likes       = dream.likes.filter(id => id !== myId);
      dream.likes_count = Math.max(0, dream.likes_count - 1);
    } else {
      // Like
      dream.likes.push(myId);
      dream.likes_count += 1;
    }

    await dream.save();

    // Trigger Notification & socket emission if Like occurred (and not post owner)
    if (!alreadyLiked && dream.userId.toString() !== myId) {
      try {
        const notif = await Notification.create({
          recipientId: dream.userId,
          senderId: new Types.ObjectId(myId),
          type: 'like',
          postId: dream._id,
        });
        await notif.populate('senderId', 'username display_name avatar');
        const io = req.app.get('io');
        if (io) {
          io.to(dream.userId.toString()).emit('new_notification', notif);
        }
        // ── Rank points: post owner gains +10 for a like ──
        const postOwner = await User.findById(dream.userId);
        if (postOwner) {
          postOwner.rankPoints  += 10;

          // Count post owner's new total likes/comments to check milestones
          const ownerDreams = await Dream.find({ userId: postOwner._id });
          let ownerLikes = 0;
          let ownerComments = 0;
          for (const d of ownerDreams) {
            ownerLikes += d.likes ? d.likes.length : 0;
            ownerComments += d.comments_count ?? 0;
          }

          const { checkAndAwardAchievements } = await import('../utils/rankEngine');
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
        console.error('❌ Failed to trigger like notification:', err);
      }
    }

    res.status(200).json({
      success:     true,
      liked:       !alreadyLiked,
      likes_count: dream.likes_count,
      likes:       dream.likes,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to toggle like.', error: err });
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

          const { checkAndAwardAchievements } = await import('../utils/rankEngine');
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

// ─── GET /api/dreams/:id ──────────────────────────────────────────────────────────

/**
 * Fetch a single dream by ID, populating the author user details.
 */
export const getDream = async (req: Request, res: Promise<void> | any): Promise<void> => {
  try {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id as string)) {
      res.status(400).json({ success: false, message: 'Invalid dream ID.' });
      return;
    }
    const dream = await Dream.findById(id).populate('userId', 'username display_name avatar');
    if (!dream) {
      res.status(404).json({ success: false, message: 'Dream not found.' });
      return;
    }
    res.status(200).json({ success: true, data: mapDreamResponse(dream) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch dream.', error: err });
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
    const { aiAnalysis, retrievedContext, strategyUsed } = await runDreamAnalysis(
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
        analysisVersion: '1.0.0',
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
export const runBackgroundAnalysis = async (
  dreamId: any,
  userId: string,
  content: string,
  sleepContext: any
): Promise<void> => {
  logger.info(`Starting background analysis for dream ${dreamId}`);

  const analysisPromise = runDreamAnalysis(userId, content, sleepContext || {});
  
  // Timeout guard (90 seconds = 90000ms)
  const timeoutMs = 90000;
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error("Phân tích AI mất quá nhiều thời gian. Vui lòng thử lại sau."));
    }, timeoutMs);
  });

  try {
    const { aiAnalysis, retrievedContext, strategyUsed } = await Promise.race([
      analysisPromise,
      timeoutPromise
    ]);

    // Late Overwrite Protection: re-read the dream from database
    const freshDream = await Dream.findById(dreamId);
    if (!freshDream) {
      logger.warn(`Dream ${dreamId} not found during finalization.`);
      return;
    }

    if (freshDream.ai_status !== 'pending') {
      logger.warn(`Dream ${dreamId} status is already '${freshDream.ai_status}'. Discarding late LLM success.`);
      return;
    }

    // Save completed result
    freshDream.ai_status = 'completed';
    freshDream.ai_result = aiAnalysis as any;
    freshDream.retrievedContext = retrievedContext as any;
    freshDream.analysisMetadata = {
      strategyUsed,
      llmModel: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
      embeddingModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
      ragTopK: retrievedContext.componentA.usedSymbols.length,
      minSimilarityScore: parseFloat(process.env.SYMBOL_RAG_MIN_SCORE || '0.55'),
      vectorBackend: retrievedContext.componentA.retrievalConfig.vectorBackend,
      analysisVersion: '1.0.0',
      generatedAt: new Date()
    } as any;

    // Remove duplicate aiAnalysis if any
    freshDream.set('aiAnalysis', undefined, { strict: false });
    if ((freshDream as any)._doc) {
      delete (freshDream as any)._doc.aiAnalysis;
    }

    await freshDream.save();
    logger.info(`Background analysis completed successfully for dream ${dreamId}`);
  } catch (err: any) {
    logger.error(`Background analysis failed for dream ${dreamId}`, err);

    // Set status to failed and save safe error summary
    const safeErrorMessage = err.message || "An unexpected internal error occurred during dream analysis.";
    
    try {
      const freshDream = await Dream.findById(dreamId);
      if (freshDream && freshDream.ai_status === 'pending') {
        freshDream.ai_status = 'failed';
        freshDream.ai_result = {
          errorSummary: safeErrorMessage,
          title: "Không thể phân tích",
          summary: "Oracle chưa thể phân tích giấc mơ này. Vui lòng thử lại sau.",
          emotional_tone: "Unknown",
          scientific_context_notes: [],
          symbolic_notes: [],
          cultural_symbolic_notes: [],
          real_life_hypotheses: [],
          dreamValenceScore: 50,
          confidence: 0,
          core_analysis: "Đã xảy ra lỗi trong quá trình phân tích giấc mơ. Vui lòng thử lại.",
          disclaimer: "Phân tích không thành công do lỗi hệ thống hoặc quá hạn thời gian."
        };
        await freshDream.save();
      }
    } catch (saveErr) {
      logger.error(`Failed to mark dream ${dreamId} as failed:`, saveErr);
    }
  }
};

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

    // Reject if already pending
    if (dream.ai_status === 'pending') {
      res.status(400).json({ success: false, message: 'Analysis is already running for this dream.' });
      return;
    }

    // Update status to pending
    dream.ai_status = 'pending';
    dream.ai_result = null;
    await dream.save();

    // Start background analysis once
    setImmediate(() => {
      runBackgroundAnalysis(dream._id, String(req.user!._id), dream.content, dream.sleepContext || {});
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
 * Save user feedback for a real-life hypothesis.
 * POST /api/dreams/:id/hypothesis-feedback
 */
export const saveHypothesisFeedback = async (req: Request, res: Response): Promise<void> => {
  try {
    const dreamId = String(req.params.id);
    const userId = String(req.user!._id);
    const { hypothesisIndex, answer } = req.body as {
      hypothesisIndex: number;
      answer: 'yes' | 'no' | 'unsure';
    };

    if (!Types.ObjectId.isValid(dreamId)) {
      res.status(400).json({ success: false, message: 'ID giấc mơ không hợp lệ.' });
      return;
    }

    if (hypothesisIndex === undefined || isNaN(hypothesisIndex) || hypothesisIndex < 0) {
      res.status(400).json({ success: false, message: 'Index giả thuyết không hợp lệ.' });
      return;
    }

    if (!['yes', 'no', 'unsure'].includes(answer)) {
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
    const hypotheses = (activeAnalysis as any).real_life_hypotheses;
    if (!Array.isArray(hypotheses) || hypothesisIndex >= hypotheses.length) {
      res.status(400).json({ success: false, message: 'Không tìm thấy giả thuyết tương ứng với index được cung cấp.' });
      return;
    }

    const matchedHypothesis = hypotheses[hypothesisIndex];
    if (!matchedHypothesis || !matchedHypothesis.followUpQuestion) {
      res.status(400).json({ success: false, message: 'Không tìm thấy câu hỏi tương ứng cho giả thuyết này.' });
      return;
    }

    // Get questionText from DB, do not trust frontend payload blindly
    const questionText = matchedHypothesis.followUpQuestion;

    // 3. Update realLifeHypothesesFeedback source of truth
    if (!dream.realLifeHypothesesFeedback) {
      dream.realLifeHypothesesFeedback = [];
    }

    const existingIndex = dream.realLifeHypothesesFeedback.findIndex(
      (f: any) => f.hypothesisIndex === hypothesisIndex
    );

    const feedbackEntry = {
      hypothesisIndex,
      answer,
      questionText,
      userId: new Types.ObjectId(userId),
      updatedAt: new Date()
    };

    if (existingIndex !== -1) {
      dream.realLifeHypothesesFeedback[existingIndex] = feedbackEntry;
    } else {
      dream.realLifeHypothesesFeedback.push(feedbackEntry);
    }

    // 4. Update the render cache mirror fields:
    // Update ai_result.real_life_hypotheses[index].userFeedback
    if (dream.ai_result && (dream.ai_result as any).real_life_hypotheses) {
      const activeHypotheses = (dream.ai_result as any).real_life_hypotheses;
      if (activeHypotheses[hypothesisIndex]) {
        activeHypotheses[hypothesisIndex].userFeedback = answer;
        dream.markModified('ai_result');
      }
    }

    // Update aiAnalysis.real_life_hypotheses[index].userFeedback
    if ((dream as any).aiAnalysis && ((dream as any).aiAnalysis as any).real_life_hypotheses) {
      const activeHypotheses = ((dream as any).aiAnalysis as any).real_life_hypotheses;
      if (activeHypotheses[hypothesisIndex]) {
        activeHypotheses[hypothesisIndex].userFeedback = answer;
        dream.markModified('aiAnalysis');
      }
    }

    await dream.save();

    res.status(200).json({
      success: true,
      message: 'Đã ghi nhận phản hồi.',
      data: {
        feedback: dream.realLifeHypothesesFeedback
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Không thể lưu phản hồi.', error: err.message });
  }
};


