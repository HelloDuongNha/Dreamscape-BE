import { Types } from 'mongoose';
import Conversation from '../../models/Conversation';
import Message from '../../models/Message';

export async function findParticipantConversation(
  conversationId: string,
  userId: string,
): Promise<any | null> {
  if (!Types.ObjectId.isValid(conversationId) || !Types.ObjectId.isValid(userId)) return null;
  return Conversation.findOne({
    _id: new Types.ObjectId(conversationId),
    participant_ids: new Types.ObjectId(userId),
  }).lean();
}

export async function markMessageDeliveredByRecipient(
  messageId: string,
  recipientId: string,
): Promise<any | null> {
  if (!Types.ObjectId.isValid(messageId) || !Types.ObjectId.isValid(recipientId)) return null;
  const message = await Message.findById(messageId).lean();
  if (!message || String(message.senderId) === recipientId) return null;
  const conversation = await findParticipantConversation(String(message.conversationId), recipientId);
  if (!conversation) return null;

  return Message.findOneAndUpdate(
    { _id: message._id, status: 'sent' },
    { $set: { status: 'delivered' } },
    { returnDocument: 'after' },
  ).lean();
}

export async function markConversationSeenByParticipant(
  conversationId: string,
  recipientId: string,
): Promise<{ modifiedCount: number; senderIds: string[] } | null> {
  const conversation = await findParticipantConversation(conversationId, recipientId);
  if (!conversation) return null;

  const recipientObjectId = new Types.ObjectId(recipientId);
  const senderIds = conversation.participant_ids
    .map((id: Types.ObjectId) => String(id))
    .filter((id: string) => id !== recipientId);
  const result = await Message.updateMany(
    {
      conversationId: new Types.ObjectId(conversationId),
      senderId: { $ne: recipientObjectId },
      status: { $ne: 'seen' },
    },
    { $set: { status: 'seen' } },
  );
  return { modifiedCount: result.modifiedCount, senderIds };
}
