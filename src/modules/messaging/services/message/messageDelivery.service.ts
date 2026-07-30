import { Types } from 'mongoose';
import { SendMessagePayload } from '../../dto/realtime.dto';
import { findParticipantConversation } from '../conversation/conversationAuthorization.service';
import { persistEncryptedMessage } from './messagePersistence.service';
import Dream from '../../../dream/models/Dream';
import Message from '../../models/Message';
import { presentMessageSafely } from './messagePersistence.service';

export class MessageDeliveryError extends Error {
  constructor(
    message: string,
    public readonly clientPayload: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MessageDeliveryError';
  }
}

export async function deliverOutgoingMessage(
  senderId: string,
  payload: SendMessagePayload,
) {
  const conversationId = payload?.conversationId;
  const content = payload?.content;
  const messageType = payload?.messageType || 'text';
  const sharedPostId = payload?.sharedPostId;
  if (
    !conversationId ||
    !content?.trim() ||
    !['text', 'shared_post'].includes(messageType) ||
    !Types.ObjectId.isValid(conversationId)
  ) {
    throw new MessageDeliveryError('Invalid send_message payload.', {
      code: 'invalid_message_payload',
      message: 'Invalid send_message payload.',
    });
  }
  if (messageType === 'shared_post') {
    if (!sharedPostId || !Types.ObjectId.isValid(sharedPostId)) {
      throw new MessageDeliveryError('Invalid shared post.', {
        code: 'invalid_shared_post',
        message: 'Invalid shared post.',
      });
    }
    const sharedPost = await Dream.exists({
      _id: new Types.ObjectId(sharedPostId),
      is_public: true,
      privacy: { $ne: 'private' },
    });
    if (!sharedPost) {
      throw new MessageDeliveryError('This post is not available for sharing.', {
        code: 'shared_post_unavailable',
        message: 'This post is not available for sharing.',
      });
    }
  }

  const conversation = await findParticipantConversation(
    conversationId,
    senderId,
  );
  if (!conversation) {
    throw new MessageDeliveryError(
      'Not a participant in this conversation.',
      {
        code: 'conversation_access_denied',
        message: 'Not a participant in this conversation.',
      },
    );
  }

  let replyTo;
  if (payload.replyToMessageId) {
    if (!Types.ObjectId.isValid(payload.replyToMessageId)) {
      throw new MessageDeliveryError('Invalid replied message.', {
        code: 'invalid_reply_message',
        message: 'Invalid replied message.',
      });
    }
    const replyDocument = await Message.findOne({
      _id: new Types.ObjectId(payload.replyToMessageId),
      conversationId: new Types.ObjectId(conversationId),
    }).lean();
    if (!replyDocument) {
      throw new MessageDeliveryError('The replied message is unavailable.', {
        code: 'reply_message_unavailable',
        message: 'The replied message is unavailable.',
      });
    }
    const presentedReply = presentMessageSafely(replyDocument);
    replyTo = {
      _id: presentedReply._id,
      senderId: presentedReply.senderId,
      content: presentedReply.content,
      messageType: presentedReply.messageType,
      sharedPostId: presentedReply.sharedPostId,
      unsentAt: presentedReply.unsentAt,
      content_unavailable: presentedReply.content_unavailable,
    };
  }

  const saved = await persistEncryptedMessage({
    conversationId: new Types.ObjectId(conversationId),
    senderId: new Types.ObjectId(senderId),
    content: content.trim(),
    messageType,
    sharedPostId: sharedPostId ? new Types.ObjectId(sharedPostId) : undefined,
    replyToMessageId: payload.replyToMessageId
      ? new Types.ObjectId(payload.replyToMessageId)
      : undefined,
    forwarded: payload.forwarded === true,
    clientMessageId: payload.clientMessageId || payload.tempId,
  });
  const recipientPayload = {
    _id: saved._id,
    conversationId: saved.conversationId,
    senderId,
    content: saved.content,
    messageType: saved.messageType,
    sharedPostId: saved.sharedPostId ? String(saved.sharedPostId) : undefined,
    replyToMessageId: saved.replyToMessageId ? String(saved.replyToMessageId) : undefined,
    forwarded: saved.forwarded,
    replyTo,
    timestamp: saved.timestamp,
    status: saved.status,
  };
  const recipientId = saved.deduplicated
    ? undefined
    : conversation.participant_ids
      .map((id: Types.ObjectId) => id.toString())
      .find((id: string) => id !== senderId);

  return {
    conversationId,
    messageId: String(saved._id),
    recipientId,
    recipientPayload,
    senderPayload: {
      ...recipientPayload,
      tempId: payload.tempId,
      clientMessageId: payload.clientMessageId || payload.tempId,
    },
  };
}
