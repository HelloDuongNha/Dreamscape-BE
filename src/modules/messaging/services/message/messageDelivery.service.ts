import { Types } from 'mongoose';
import { SendMessagePayload } from '../../dto/realtime.dto';
import { findParticipantConversation } from '../conversation/conversationAuthorization.service';
import { persistEncryptedMessage } from './messagePersistence.service';

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
  if (
    !conversationId ||
    !content?.trim() ||
    !Types.ObjectId.isValid(conversationId)
  ) {
    throw new MessageDeliveryError('Invalid send_message payload.', {
      code: 'invalid_message_payload',
      message: 'Invalid send_message payload.',
    });
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

  const saved = await persistEncryptedMessage({
    conversationId: new Types.ObjectId(conversationId),
    senderId: new Types.ObjectId(senderId),
    content: content.trim(),
    clientMessageId: payload.clientMessageId || payload.tempId,
  });
  const recipientPayload = {
    _id: saved._id,
    conversationId: saved.conversationId,
    senderId,
    content: saved.content,
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
