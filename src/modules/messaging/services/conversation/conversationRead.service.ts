import { Types } from 'mongoose';
import Conversation from '../../models/Conversation';
import Message from '../../models/Message';
import { findParticipantConversation } from './conversationAuthorization.service';
import {
  presentConversation,
  presentMessageSafely,
} from '../message/messagePersistence.service';

const USER_PUBLIC = 'username display_name avatar bio lastHeartbeatAt streakCount';

export class ConversationRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ConversationRequestError';
  }
}

export async function loadUserConversations(userId: Types.ObjectId) {
  const conversations = await Conversation.find({ participant_ids: userId })
    .sort({ updated_at: -1 })
    .populate('participant_ids', USER_PUBLIC)
    .lean();

  return Promise.all(
    conversations.map(async (conversation) => {
      const [unread_count, latestVisibleMessage] = await Promise.all([
        Message.countDocuments({
          conversationId: conversation._id,
          senderId: { $ne: userId },
          status: { $ne: 'seen' },
          deletedFor: { $ne: userId },
        }),
        Message.findOne({
          conversationId: conversation._id,
          deletedFor: { $ne: userId },
        }).sort({ timestamp: -1 }).lean(),
      ]);
      const presentedConversation = presentConversation(conversation);
      if (!latestVisibleMessage) {
        return {
          ...presentedConversation,
          last_message: '',
          last_message_unsent: false,
          unread_count,
        };
      }
      const latest = presentMessageSafely(latestVisibleMessage);
      return {
        ...presentedConversation,
        last_message: latest.unsentAt ? '' : latest.content,
        last_message_unsent: Boolean(latest.unsentAt),
        preview_unavailable: latest.content_unavailable,
        updated_at: latest.timestamp,
        unread_count,
      };
    }),
  );
}

export async function loadConversationMessages(
  conversationId: string,
  userId: Types.ObjectId,
) {
  assertConversationId(conversationId);

  const conversation = await findParticipantConversation(
    conversationId,
    String(userId),
  );
  if (!conversation) {
    throw new ConversationRequestError(
      403,
      'Access denied to this conversation.',
    );
  }

  const messages = await Message.find({
    conversationId: new Types.ObjectId(conversationId),
    deletedFor: { $ne: userId },
  })
    .sort({ timestamp: 1 })
    .limit(50)
    .populate('senderId', USER_PUBLIC)
    .lean();

  const presented = messages.map(presentMessageSafely);
  const replyIds = presented
    .map(message => message.replyToMessageId)
    .filter((value): value is Types.ObjectId => value instanceof Types.ObjectId);
  if (!replyIds.length) return presented;

  const replyDocuments = await Message.find({ _id: { $in: replyIds } }).lean();
  const replies = new Map(replyDocuments.map(document => {
    const reply = presentMessageSafely(document);
    return [String(reply._id), {
      _id: reply._id,
      senderId: reply.senderId,
      content: reply.content,
      messageType: reply.messageType,
      sharedPostId: reply.sharedPostId,
      unsentAt: reply.unsentAt,
      content_unavailable: reply.content_unavailable,
    }];
  }));

  return presented.map(message => ({
    ...message,
    replyTo: message.replyToMessageId
      ? replies.get(String(message.replyToMessageId))
      : undefined,
  }));
}

function assertConversationId(conversationId: string): void {
  if (!Types.ObjectId.isValid(conversationId)) {
    throw new ConversationRequestError(400, 'Invalid conversationId.');
  }
}
