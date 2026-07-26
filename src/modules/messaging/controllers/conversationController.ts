import { Request, Response } from 'express';
import { Types } from 'mongoose';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import User from '../models/User';

// ─── Helper: Public user projection ──────────────────────────────────────────

/** Fields returned for the conversation partner profile */
const USER_PUBLIC = 'username display_name avatar bio';

// ─── GET /api/conversations ───────────────────────────────────────────────────

/**
 * Returns all conversations where the authenticated user is a participant.
 * Each conversation is enriched with the partner's public profile,
 * last_message preview, and unread_count (messages from partner not yet seen).
 * Sorted by most recent activity.
 */
export const getConversations = async (req: Request, res: Response): Promise<void> => {
  try {
    const myId = req.user!._id as Types.ObjectId;

    const conversations = await Conversation.find({ participant_ids: myId })
      .sort({ updated_at: -1 })
      .populate('participant_ids', USER_PUBLIC)
      .lean();

    // Compute unread_count for each conversation in parallel:
    // count messages in that conversation NOT sent by me AND not yet seen
    const withUnread = await Promise.all(
      conversations.map(async (conv) => {
        const unread_count = await Message.countDocuments({
          conversationId: conv._id,
          senderId:       { $ne: myId },
          status:         { $ne: 'seen' },
        });
        return { ...conv, unread_count };
      })
    );

    res.status(200).json({ success: true, data: withUnread });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch conversations.', error: err });
  }
};

// ─── GET /api/messages/:conversationId ───────────────────────────────────────

/**
 * Returns the last 50 messages for a specific conversation, ordered oldest→newest
 * (chronological order for rendering in the chat window).
 * Verifies the requesting user is a participant before returning data.
 */
export const getMessages = async (req: Request, res: Response): Promise<void> => {
  try {
    const conversationId = String(req.params.conversationId);
    const myId = req.user!._id as Types.ObjectId;

    if (!Types.ObjectId.isValid(conversationId)) {
      res.status(400).json({ success: false, message: 'Invalid conversationId.' });
      return;
    }

    // Guard: ensure user belongs to this conversation
    const conversation = await Conversation.findOne({
      _id:             new Types.ObjectId(conversationId),
      participant_ids: myId,
    }).lean();

    if (!conversation) {
      res.status(403).json({ success: false, message: 'Access denied to this conversation.' });
      return;
    }

    // Fetch last 50 messages, oldest first for chat rendering
    const messages = await Message.find({ conversationId: new Types.ObjectId(conversationId) })
      .sort({ timestamp: 1 })
      .limit(50)
      .populate('senderId', USER_PUBLIC)
      .lean();

    res.status(200).json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch messages.', error: err });
  }
};

// ─── POST /api/conversations/search ──────────────────────────────────────────

/**
 * Search users by @username prefix, then find-or-create a conversation with
 * the selected user. Returns the conversationId for the frontend to open.
 *
 * Request body:
 *   { username: "@query" }          — search mode: returns matched users
 *   { username: "@query", open: true, targetUserId: "<id>" } — open/create mode
 */
export const searchOrCreateConversation = async (req: Request, res: Response): Promise<void> => {
  try {
    const myId = req.user!._id as Types.ObjectId;
    const { username, targetUserId, open } = req.body as {
      username?:     string;
      targetUserId?: string;
      open?:         boolean;
    };

    // ── Mode 2: Open/create conversation with targetUserId ───────────────────
    // Triggered when open=true AND targetUserId is present (username can be empty)
    if (open && targetUserId) {
      if (!Types.ObjectId.isValid(targetUserId)) {
        res.status(400).json({ success: false, message: 'Invalid targetUserId.' });
        return;
      }

      const targetObjId = new Types.ObjectId(targetUserId);

      const existing = await Conversation.findOne({
        participant_ids: { $all: [myId, targetObjId] },
      })
        .select('_id')
        .lean();

      if (!existing) {
        // Enforce DM Privacy for new conversations
        const targetUser = await User.findById(targetObjId);
        if (!targetUser) {
          res.status(404).json({ success: false, message: 'Target user not found.' });
          return;
        }

        const dmPrivacySetting = targetUser.dmPrivacy || 'everyone';
        if (dmPrivacySetting !== 'everyone') {
          const targetFollowing = (targetUser.following || []).map((id: any) => id.toString());
          const isTargetFollowingMe = targetFollowing.includes(String(myId));

          if (dmPrivacySetting === 'following' && !isTargetFollowingMe) {
            res.status(403).json({
              success: false,
              message: "This user's privacy settings restrict who can send them direct messages."
            });
            return;
          }

          if (dmPrivacySetting === 'friends') {
            const currentUser = await User.findById(myId);
            const myFollowing = (currentUser?.following || []).map((id: any) => id.toString());
            const isMeFollowingTarget = myFollowing.includes(String(targetUserId));
            const isMutual = isTargetFollowingMe && isMeFollowingTarget;

            if (!isMutual) {
              res.status(403).json({
                success: false,
                message: "This user's privacy settings restrict direct messages to mutual friends."
              });
              return;
            }
          }
        }
      }

      const conversationId: Types.ObjectId = existing
        ? (existing._id as Types.ObjectId)
        : (
            await Conversation.create({
              participant_ids: [myId, targetObjId],
              last_message:    '',
              updated_at:      new Date(),
            })
          )._id as Types.ObjectId;

      res.status(200).json({ success: true, conversationId });
      return;
    }

    // ── Mode 1: Search only — return matching users ──────────────────────────
    if (!username || username.trim() === '') {
      res.status(400).json({ success: false, message: 'username is required for search.' });
      return;
    }

    if (!open || !targetUserId) {
      const users = await User.find({
        username: { $regex: new RegExp(username.trim(), 'i') },
        _id:      { $ne: myId },   // exclude self
      })
        .select(USER_PUBLIC)
        .limit(10)
        .lean();

      res.status(200).json({ success: true, data: users });
      return;
    }

    res.status(400).json({ success: false, message: 'Invalid request.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Search/create failed.', error: err });
  }
};

// ─── DELETE /api/conversations/:id ────────────────────────────────────────────

/**
 * Permanently deletes a conversation and all its messages.
 * Only participants of the conversation can delete it.
 */
export const deleteConversation = async (req: Request, res: Response): Promise<void> => {
  try {
    const myId           = req.user!._id as Types.ObjectId;
    const conversationId = String(req.params.id);

    if (!Types.ObjectId.isValid(conversationId)) {
      res.status(400).json({ success: false, message: 'Invalid conversationId.' });
      return;
    }

    // Guard: requester must be a participant
    const conversation = await Conversation.findOne({
      _id:             new Types.ObjectId(conversationId),
      participant_ids: myId,
    }).lean();

    if (!conversation) {
      res.status(403).json({ success: false, message: 'Access denied or conversation not found.' });
      return;
    }

    // Delete all messages belonging to this conversation
    await Message.deleteMany({ conversationId: new Types.ObjectId(conversationId) });

    // Delete the conversation document itself
    await Conversation.findByIdAndDelete(conversationId);

    res.status(200).json({ success: true, message: 'Conversation deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete conversation.', error: err });
  }
};
