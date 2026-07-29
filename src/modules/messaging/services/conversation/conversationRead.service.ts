import { Types } from 'mongoose';
import Conversation from '../../models/Conversation';
import Message from '../../models/Message';
import { findParticipantConversation } from './conversationAuthorization.service';
import {
  presentConversation,
  presentMessageSafely,
} from '../message/messagePersistence.service';

const USER_PUBLIC = 'username display_name avatar bio lastHeartbeatAt';

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
      const unread_count = await Message.countDocuments({
        conversationId: conversation._id,
        senderId: { $ne: userId },
        status: { $ne: 'seen' },
      });
      return { ...presentConversation(conversation), unread_count };
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
  })
    .sort({ timestamp: 1 })
    .limit(50)
    .populate('senderId', USER_PUBLIC)
    .lean();

  return messages.map(presentMessageSafely);
}

function assertConversationId(conversationId: string): void {
  if (!Types.ObjectId.isValid(conversationId)) {
    throw new ConversationRequestError(400, 'Invalid conversationId.');
  }
}
