import { Types } from 'mongoose';
import Conversation from '../../models/Conversation';
import Message from '../../models/Message';

export interface PendingDeliveryBatch {
  senderId: string;
  messageIds: string[];
}

// Marks messages that arrived while a recipient was offline as delivered on reconnect.
export async function acknowledgePendingDeliveriesForRecipient(
  recipientId: string,
): Promise<PendingDeliveryBatch[]> {
  if (!Types.ObjectId.isValid(recipientId)) return [];

  const recipientObjectId = new Types.ObjectId(recipientId);
  const conversationIds = await Conversation.distinct('_id', {
    participant_ids: recipientObjectId,
  });
  if (!conversationIds.length) return [];

  const pendingMessages = await Message.find({
    conversationId: { $in: conversationIds },
    senderId: { $ne: recipientObjectId },
    status: 'sent',
  }).select('_id senderId').lean();
  if (!pendingMessages.length) return [];

  const updatedMessages = await Promise.all(
    pendingMessages.map(message => Message.findOneAndUpdate(
      { _id: message._id, status: 'sent' },
      { $set: { status: 'delivered' } },
      { returnDocument: 'after' },
    ).select('_id senderId').lean()),
  );

  return groupDeliveriesBySender(
    updatedMessages.filter((message): message is NonNullable<typeof message> => Boolean(message)),
  );
}

// Groups receipt events so reconnecting with many pending messages emits one event per sender.
function groupDeliveriesBySender(
  messages: Array<{ _id: Types.ObjectId; senderId: Types.ObjectId }>,
): PendingDeliveryBatch[] {
  const batches = new Map<string, string[]>();
  for (const message of messages) {
    const senderId = String(message.senderId);
    const messageIds = batches.get(senderId) || [];
    messageIds.push(String(message._id));
    batches.set(senderId, messageIds);
  }

  return [...batches.entries()].map(([senderId, messageIds]) => ({
    senderId,
    messageIds,
  }));
}
