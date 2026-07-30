import { Types } from 'mongoose';
import Conversation from '../../models/Conversation';
import Message from '../../models/Message';
import { findParticipantConversation } from '../conversation/conversationAuthorization.service';
import { ConversationRequestError } from '../conversation/conversationRead.service';

export interface MessageMutationResult {
  messageId: string;
  conversationId: string;
  participantIds: string[];
  unsentAt?: string;
}

export async function deleteMessageForParticipant(
  messageId: string,
  userId: Types.ObjectId,
): Promise<MessageMutationResult> {
  assertMessageId(messageId);
  const message = await Message.findById(messageId);
  if (!message) throw new ConversationRequestError(404, 'Message not found.');

  await assertParticipant(String(message.conversationId), userId);
  await Message.updateOne(
    { _id: message._id },
    { $addToSet: { deletedFor: userId } },
  );

  return mutationResult(message, await participantIds(message.conversationId));
}

export async function unsendOwnMessage(
  messageId: string,
  userId: Types.ObjectId,
): Promise<MessageMutationResult> {
  assertMessageId(messageId);
  const message = await Message.findById(messageId);
  if (!message) throw new ConversationRequestError(404, 'Message not found.');

  await assertParticipant(String(message.conversationId), userId);
  if (String(message.senderId) !== String(userId)) {
    throw new ConversationRequestError(403, 'Only the sender can unsend this message.');
  }

  const unsentAt = message.unsentAt || new Date();
  if (!message.unsentAt) {
    await Message.updateOne(
      { _id: message._id },
      {
        $set: {
          unsentAt,
          unsentBy: userId,
          messageType: 'text',
          searchTokens: [],
        },
        $unset: {
          content: 1,
          ciphertext: 1,
          iv: 1,
          authTag: 1,
          keyVersion: 1,
          searchKeyVersion: 1,
          sharedPostId: 1,
        },
      },
    );
  }

  return {
    ...mutationResult(message, await participantIds(message.conversationId)),
    unsentAt: unsentAt.toISOString(),
  };
}

async function assertParticipant(
  conversationId: string,
  userId: Types.ObjectId,
): Promise<void> {
  const conversation = await findParticipantConversation(
    conversationId,
    String(userId),
  );
  if (!conversation) {
    throw new ConversationRequestError(403, 'Access denied to this conversation.');
  }
}

async function participantIds(conversationId: Types.ObjectId): Promise<string[]> {
  const conversation = await Conversation.findById(conversationId)
    .select('participant_ids')
    .lean();
  return (conversation?.participant_ids || []).map(String);
}

function mutationResult(
  message: { _id: unknown; conversationId: unknown },
  participants: string[],
): MessageMutationResult {
  return {
    messageId: String(message._id),
    conversationId: String(message.conversationId),
    participantIds: participants,
  };
}

function assertMessageId(messageId: string): void {
  if (!Types.ObjectId.isValid(messageId)) {
    throw new ConversationRequestError(400, 'Invalid messageId.');
  }
}
