import { Request, Response } from 'express';
import { Types } from 'mongoose';
import type { Server as SocketIOServer } from 'socket.io';
import { parseConversationSearchRequest } from '../dto/conversation.dto';
import {
  deleteParticipantConversation,
  resolveConversationRequest,
} from '../services/conversation/conversationLifecycle.service';
import {
  ConversationRequestError,
  loadConversationMessages,
  loadUserConversations,
} from '../services/conversation/conversationRead.service';
import {
  deliverOutgoingMessage,
  MessageDeliveryError,
} from '../services/message/messageDelivery.service';

export async function getConversations(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const data = await loadUserConversations(req.user!._id as Types.ObjectId);
    res.status(200).json({ success: true, data });
  } catch (error) {
    respondConversationError(res, error, 'Failed to fetch conversations.');
  }
}

export async function getMessages(req: Request, res: Response): Promise<void> {
  try {
    const data = await loadConversationMessages(
      String(req.params.conversationId),
      req.user!._id as Types.ObjectId,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    respondConversationError(res, error, 'Failed to fetch messages.');
  }
}

export async function sendConversationMessage(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const delivery = await deliverOutgoingMessage(String(req.user!._id), {
      conversationId: String(req.params.conversationId),
      content: req.body?.content,
      tempId: req.body?.tempId,
      clientMessageId: req.body?.clientMessageId,
    });
    const io = req.app.get('io') as SocketIOServer | undefined;
    if (io && delivery.recipientId) {
      io.to(delivery.recipientId).emit('receive_message', delivery.recipientPayload);
    }
    res.status(201).json({ success: true, data: delivery.senderPayload });
  } catch (error) {
    respondConversationError(res, error, 'Failed to send message.');
  }
}

export async function searchOrCreateConversation(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const result = await resolveConversationRequest(
      req.user!._id as Types.ObjectId,
      parseConversationSearchRequest(req.body),
    );
    if (result.kind === 'conversation') {
      res.status(200).json({
        success: true,
        conversationId: result.conversationId,
      });
      return;
    }
    res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    respondConversationError(res, error, 'Search/create failed.');
  }
}

export async function deleteConversation(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    await deleteParticipantConversation(
      String(req.params.id),
      req.user!._id as Types.ObjectId,
    );
    res.status(200).json({ success: true, message: 'Conversation deleted.' });
  } catch (error) {
    respondConversationError(res, error, 'Failed to delete conversation.');
  }
}

function respondConversationError(
  res: Response,
  error: unknown,
  fallbackMessage: string,
): void {
  if (error instanceof ConversationRequestError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
    return;
  }
  if (error instanceof MessageDeliveryError) {
    res.status(400).json({
      success: false,
      ...error.clientPayload,
    });
    return;
  }
  res.status(500).json({
    success: false,
    message: fallbackMessage,
    error,
  });
}
