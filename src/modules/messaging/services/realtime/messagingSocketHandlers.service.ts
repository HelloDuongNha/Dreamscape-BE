import { Types } from 'mongoose';
import { Server as SocketIOServer } from 'socket.io';
import { logger } from '../../../../infrastructure/logger';
import {
  JoinConversationPayload,
  MarkAsSeenPayload,
  MessageDeliveredPayload,
  SendMessagePayload,
} from '../../dto/realtime.dto';
import {
  findParticipantConversation,
  markConversationSeenByParticipant,
  markMessageDeliveredByRecipient,
} from '../conversation/conversationAuthorization.service';
import {
  deliverOutgoingMessage,
  MessageDeliveryError,
} from '../message/messageDelivery.service';
import { AuthenticatedMessagingSocket } from './socketAuthentication.service';
import {
  publishUserOfflineWhenLastSocketCloses,
  publishUserOnline,
} from './userPresence.service';

export function registerMessagingSocketHandlers(
  io: SocketIOServer,
  socket: AuthenticatedMessagingSocket,
): void {
  const userId = socket.userId;
  socket.join(userId);
  void publishUserOnline(io, userId).catch((error) => {
    logger.error('Could not publish online presence.', error, { userId });
  });
  logger.info('Messaging socket connected.', { userId, socketId: socket.id });

  registerJoinConversationHandler(socket, userId);
  registerSendMessageHandler(io, socket, userId);
  registerDeliveryReceiptHandler(io, socket, userId);
  registerSeenReceiptHandler(io, socket, userId);
  registerDisconnectHandler(io, socket, userId);
}

function registerJoinConversationHandler(
  socket: AuthenticatedMessagingSocket,
  userId: string,
): void {
  socket.on('join_room', async (payload: JoinConversationPayload) => {
    if (!payload?.conversationId) return;

    const conversation = await findParticipantConversation(
      payload.conversationId,
      userId,
    );
    if (!conversation) {
      socket.emit('error_message', { code: 'conversation_access_denied' });
      return;
    }

    socket.join(`conv:${payload.conversationId}`);
    logger.info('Messaging socket joined an authorised conversation room.', {
      userId,
      conversationId: payload.conversationId,
    });
  });
}

function registerSendMessageHandler(
  io: SocketIOServer,
  socket: AuthenticatedMessagingSocket,
  userId: string,
): void {
  socket.on('send_message', async (payload: SendMessagePayload) => {
    try {
      const delivery = await deliverOutgoingMessage(userId, payload);
      if (delivery.recipientId) {
        io.to(delivery.recipientId).emit(
          'receive_message',
          delivery.recipientPayload,
        );
      }
      socket.emit('receive_message', delivery.senderPayload);
      logger.info('Encrypted message persisted and delivered.', {
        userId,
        conversationId: delivery.conversationId,
        messageId: delivery.messageId,
      });
    } catch (error) {
      if (error instanceof MessageDeliveryError) {
        socket.emit('error_message', error.clientPayload);
        return;
      }
      logger.error('Messaging send failed.', error, {
        userId,
        conversationId: payload?.conversationId,
      });
      socket.emit('error_message', {
        code: 'message_send_failed',
        tempId: payload?.tempId,
      });
    }
  });
}

function registerDeliveryReceiptHandler(
  io: SocketIOServer,
  socket: AuthenticatedMessagingSocket,
  userId: string,
): void {
  socket.on('message_delivered', async (payload: MessageDeliveredPayload) => {
    if (!payload?.messageId || !Types.ObjectId.isValid(payload.messageId)) return;
    try {
      const updated = await markMessageDeliveredByRecipient(
        payload.messageId,
        userId,
      );
      if (!updated) return;

      io.to(updated.senderId.toString()).emit('message_status_updated', {
        messageId: payload.messageId,
        status: 'delivered',
      });
    } catch (error) {
      logger.error('Messaging delivery receipt failed.', error, { userId });
    }
  });
}

function registerSeenReceiptHandler(
  io: SocketIOServer,
  socket: AuthenticatedMessagingSocket,
  userId: string,
): void {
  socket.on('mark_as_seen', async (payload: MarkAsSeenPayload) => {
    if (
      !payload?.conversationId ||
      !Types.ObjectId.isValid(payload.conversationId)
    ) {
      return;
    }

    try {
      const result = await markConversationSeenByParticipant(
        payload.conversationId,
        userId,
      );
      if (!result || result.modifiedCount <= 0) return;

      for (const senderId of result.senderIds) {
        io.to(senderId).emit('message_status_updated', {
          conversationId: payload.conversationId,
          status: 'seen',
        });
      }
    } catch (error) {
      logger.error('Messaging seen receipt failed.', error, {
        userId,
        conversationId: payload.conversationId,
      });
    }
  });
}

function registerDisconnectHandler(
  io: SocketIOServer,
  socket: AuthenticatedMessagingSocket,
  userId: string,
): void {
  socket.on('disconnect', (reason) => {
    logger.info('Messaging socket disconnected.', { userId, reason });
    void publishUserOfflineWhenLastSocketCloses(io, userId).catch((error) => {
      logger.error('Could not publish offline presence.', error, { userId });
    });
  });
}
