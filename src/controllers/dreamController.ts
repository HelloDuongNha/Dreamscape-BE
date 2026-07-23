import { Request, Response } from 'express';
import Dream, { IDream } from '../models/Dream';
import Comment           from '../models/Comment';
import { Types }         from 'mongoose';
import crypto            from 'crypto';
import Notification      from '../models/Notification';
import User              from '../models/User';
import { calculateRank } from '../services/user/rank.service';
import { runDreamAnalysis } from '../services/dream/analyze.service';
import { OllamaServiceError } from '../services/infrastructure/llm.service';
import { logger } from '../services/infrastructure/logger';
import { retrieveSymbolsHybrid } from '../services/dream/symbolRetrieval.service';
import {
  buildFeedbackChangeSet,
  buildFeedbackConclusion,
  buildFeedbackRevision,
  enrichScientificNotesForResponse,
  reconcileAlternateQuestionAfterFeedback,
  resolveQuestionRuleIds,
} from '../services/dream/dreamAnalysisGrounding.service';
import { materializeDreamSymbolObservations } from '../services/dream/symbolObservation.service';

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
  const completeNarrative = composeDreamNarrative(obj.content || obj.dreamText || '', obj.additions || []);
  if (obj.ai_result) {
    obj.ai_result = enrichScientificNotesForResponse(obj.ai_result, obj.retrievedContext, completeNarrative);
    obj.aiAnalysis = obj.ai_result;
    obj.mood_tag = obj.ai_result.emotional_tone || obj.mood_tag || '';
  }
  return obj;
}

export function composeDreamNarrative(
  originalContent: string,
  additions: Array<{ sequence?: number; content?: string }> = [],
): string {
  const original = String(originalContent || '').trim();
  const validAdditions = additions
    .map((item, index) => ({
      sequence: Number.isInteger(item?.sequence) && Number(item.sequence) > 0 ? Number(item.sequence) : index + 1,
      content: String(item?.content || '').trim(),
    }))
    .filter(item => item.content)
    .sort((left, right) => left.sequence - right.sequence);
  if (validAdditions.length === 0) return original;
  const blocks = validAdditions.map((item, index) => validAdditions.length === 1
    ? `Bổ sung:\n${item.content}`
    : `${index + 1}. Bổ sung:\n${item.content}`);
  return [original, ...blocks].filter(Boolean).join('\n\n');
}

function normalizedDreamContent(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function dreamContentHash(value: string): string {
  return crypto.createHash('sha256').update(normalizedDreamContent(value), 'utf8').digest('hex');
}

async function syncDreamSymbolObservations(dream: any): Promise<void> {
  try {
    await materializeDreamSymbolObservations({
      dreamId: new Types.ObjectId(String(dream._id)),
      userId: new Types.ObjectId(String(dream.userId)),
      isPublic: dream.privacy === 'public' || dream.is_public === true,
      symbolicNotes: Array.isArray(dream.ai_result?.symbolic_notes)
        ? dream.ai_result.symbolic_notes
        : [],
    });
  } catch (error) {
    // The primary analysis remains valid if the secondary observation index
    // cannot be refreshed. The failure is visible in logs and can be replayed.
    logger.warn('Could not refresh dream symbol observations.', {
      dreamId: String(dream?._id || ''),
      error: String(error),
    });
  }
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

    const normalizedContent = normalizedDreamContent(content);
    const contentHash = dreamContentHash(normalizedContent);
    const analysisStartedAt = new Date();
    const dream = await Dream.create({
      userId:    req.user!._id as Types.ObjectId,
      content:   normalizedContent,
      contentHash,
      mood_tag:  mood_tag?.trim() ?? '',
      is_public: is_public !== undefined ? is_public : true,
      privacy: is_public === false ? 'private' : 'public',
      analysisMetadata: {
        currentStage: 'preparing',
        progress: 8,
        statusMessage: 'Đang chuẩn bị hồ sơ và ngữ cảnh phân tích...',
        currentMiniStep: 'Đang đọc hồ sơ và tách phần lời kể cần phân tích.',
        stageResults: {},
        startedAt: analysisStartedAt,
        lastProgressAt: analysisStartedAt,
      },
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
    dream.content = normalizedDreamContent(content);
    dream.contentHash = dreamContentHash(dream.content);

    await dream.save();

    res.status(200).json({ success: true, message: 'Dream updated.', data: mapDreamResponse(dream) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update dream.', error: err });
  }
};

// ─── POST /api/dreams/:id/additions ─────────────────────────────────────────

/**
 * Append remembered details without rewriting the original report. The full
 * versioned narrative is then re-analysed and old answers are invalidated.
 */
export const appendDreamAddition = async (req: Request, res: Response): Promise<void> => {
  try {
    const dreamId = String(req.params.id);
    const userId = req.user!._id as Types.ObjectId;
    if (!Types.ObjectId.isValid(dreamId)) {
      res.status(400).json({ success: false, message: 'ID giấc mơ không hợp lệ.' });
      return;
    }
    const addition = normalizedDreamContent(String(req.body?.content || ''));
    if (!addition) {
      res.status(400).json({ success: false, message: 'Nội dung bổ sung là bắt buộc.' });
      return;
    }
    if (addition.length > 2000) {
      res.status(413).json({ success: false, message: 'Mỗi phần bổ sung không được vượt quá 2.000 ký tự.' });
      return;
    }
    const dream = await Dream.findOne({ _id: new Types.ObjectId(dreamId), userId });
    if (!dream) {
      res.status(403).json({ success: false, message: 'Không tìm thấy giấc mơ hoặc bạn không có quyền bổ sung.' });
      return;
    }
    if (dream.ai_status === 'pending') {
      res.status(409).json({ success: false, message: 'Hãy chờ lần phân tích hiện tại hoàn tất trước khi bổ sung.' });
      return;
    }
    const additions = Array.isArray(dream.additions) ? dream.additions : [];
    if (additions.length >= 10) {
      res.status(409).json({ success: false, message: 'Giấc mơ đã đạt giới hạn 10 phần bổ sung.' });
      return;
    }
    const nextAddition = { sequence: additions.length + 1, content: addition, addedAt: new Date() };
    const completeNarrative = composeDreamNarrative(dream.content, [...additions, nextAddition]);
    if (completeNarrative.length > 12000) {
      res.status(413).json({ success: false, message: 'Tổng lời kể sau khi bổ sung không được vượt quá 12.000 ký tự.' });
      return;
    }

    dream.additions.push(nextAddition);
    dream.contentHash = dreamContentHash(completeNarrative);
    dream.ai_status = 'pending';
    dream.ai_result = null;
    dream.analysisEmbedding = undefined;
    dream.retrievedContext = null;
    dream.realLifeHypothesesFeedback = [];
    const analysisStartedAt = new Date();
    dream.analysisMetadata = {
      currentStage: 'preparing',
      progress: 8,
      statusMessage: 'Đang phân tích lại lời kể cùng phần bổ sung...',
      currentMiniStep: 'Đang ghép nội dung gốc và các phần bổ sung theo đúng thứ tự.',
      stageResults: {},
      startedAt: analysisStartedAt,
      lastProgressAt: analysisStartedAt,
      trigger: 'dream_addition',
      additionCount: dream.additions.length,
    };
    dream.markModified('analysisMetadata');
    await dream.save();

    setImmediate(() => {
      runBackgroundAnalysis(dream._id, String(userId), completeNarrative, dream.sleepContext || {});
    });

    res.status(202).json({
      success: true,
      message: 'Đã thêm chi tiết và bắt đầu phân tích lại.',
      data: mapDreamResponse(dream),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Không thể bổ sung nội dung giấc mơ.', error: err.message });
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
    const populatedOwner: any = dream.userId;
    const ownerId = String(populatedOwner?._id || populatedOwner);
    const requesterId = String(req.user!._id);
    if ((dream.privacy === 'private' || dream.is_public === false) && ownerId !== requesterId) {
      res.status(403).json({ success: false, message: 'Bạn không có quyền xem giấc mơ này.' });
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

          const { checkAndAwardAchievements } = await import('../services/user/rank.service');
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

          const { checkAndAwardAchievements } = await import('../services/user/rank.service');
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
    res.setHeader('Cache-Control', 'no-store');
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
export const runBackgroundAnalysis = async (
  dreamId: any,
  userId: string,
  content: string,
  sleepContext: any
): Promise<void> => {
  logger.info(`Starting background analysis for dream ${dreamId}`);
  const analysisStartedAt = new Date();

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
          { _id: dreamId, ai_status: 'pending' },
          {
            $set: progressFields,
          }
        );
      },
    );

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
    freshDream.mood_tag = aiAnalysis.emotional_tone || '';
    freshDream.analysisEmbedding = analysisEmbedding;
    freshDream.retrievedContext = retrievedContext as any;
    const progressHistory = (freshDream.analysisMetadata as any)?.stageResults || {};
    freshDream.analysisMetadata = {
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
      durationMs: Date.now() - analysisStartedAt.getTime(),
    } as any;

    // Remove duplicate aiAnalysis if any
    freshDream.set('aiAnalysis', undefined, { strict: false });
    if ((freshDream as any)._doc) {
      delete (freshDream as any)._doc.aiAnalysis;
    }

    await freshDream.save();
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
    // Feedback is bound to the exact generated question text. A new analysis may
    // produce different questions, so old answers must not be counted against
    // the replacement hypotheses.
    dream.realLifeHypothesesFeedback = [];
    await dream.save();

    // Start background analysis once
    const completeNarrative = composeDreamNarrative(dream.content, dream.additions || []);
    setImmediate(() => {
      runBackgroundAnalysis(dream._id, String(req.user!._id), completeNarrative, dream.sleepContext || {});
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
        message: 'Câu hỏi này không gắn với một quy luật đã duyệt nên không thể dùng để xác minh.'
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
    await syncDreamSymbolObservations(dream);

    res.status(200).json({
      success: true,
      message: isClearingAnswer ? 'Đã bỏ lựa chọn.' : 'Đã ghi nhận phản hồi.',
      data: {
        feedback: dream.realLifeHypothesesFeedback,
        feedbackRevision: refreshedAnalysis?.feedback_revision || [],
        feedbackConclusion: refreshedAnalysis?.feedback_conclusion || null,
        analysis: refreshedAnalysis,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Không thể lưu phản hồi.', error: err.message });
  }
};
