import { Types } from 'mongoose';
import Conversation from '../../models/Conversation';
import Message from '../../models/Message';
import {
  createMessageSearchTokens,
  decryptMessageText,
  encryptMessageText,
  type EncryptedTextEnvelope,
} from '../crypto/messagingCrypto.service';

export interface PlainMessage {
  _id: unknown;
  conversationId: unknown;
  senderId: unknown;
  content: string;
  messageType: 'text' | 'shared_post';
  sharedPostId?: unknown;
  replyToMessageId?: unknown;
  forwarded?: boolean;
  unsentAt?: Date;
  replyTo?: {
    _id: unknown;
    senderId: unknown;
    content: string;
    messageType: 'text' | 'shared_post';
    sharedPostId?: unknown;
    unsentAt?: Date;
    content_unavailable?: boolean;
  };
  timestamp: Date;
  status: 'sent' | 'delivered' | 'seen';
  content_unavailable?: boolean;
  deduplicated?: boolean;
}

export async function persistEncryptedMessage(input: {
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  content: string;
  messageType?: 'text' | 'shared_post';
  sharedPostId?: Types.ObjectId;
  replyToMessageId?: Types.ObjectId;
  forwarded?: boolean;
  clientMessageId?: string;
}): Promise<PlainMessage> {
  const content = input.content.normalize('NFKC').trim();
  if (!content || content.length > 2000) {
    throw new Error('Message content must contain between 1 and 2000 characters.');
  }
  const clientMessageId = normalizeClientMessageId(input.clientMessageId);
  if (clientMessageId) {
    const existing = await Message.findOne({
      senderId: input.senderId,
      messageType: input.messageType || 'text',
      sharedPostId: input.sharedPostId,
      replyToMessageId: input.replyToMessageId,
      forwarded: input.forwarded === true,
      clientMessageId,
    });
    if (existing) {
      assertSameConversation(existing.conversationId, input.conversationId);
      return { ...presentMessage(existing), deduplicated: true };
    }
  }

  const messageId = new Types.ObjectId();
  const messageContext = {
    recordType: 'message' as const,
    recordId: String(messageId),
    conversationId: String(input.conversationId),
    senderId: String(input.senderId),
  };
  const contentEnvelope = encryptMessageText(content, messageContext);
  const search = createMessageSearchTokens(content);
  const previewEnvelope = encryptMessageText(content.slice(0, 100), {
    recordType: 'conversation_preview',
    recordId: String(input.conversationId),
    conversationId: String(input.conversationId),
    senderId: String(input.senderId),
  });
  const timestamp = new Date();

  let message;
  try {
    message = await Message.create({
      _id: messageId,
      conversationId: input.conversationId,
      senderId: input.senderId,
      clientMessageId,
      messageType: input.messageType || 'text',
      sharedPostId: input.sharedPostId,
      replyToMessageId: input.replyToMessageId,
      forwarded: input.forwarded === true,
      ...contentEnvelope,
      searchTokens: search.tokens,
      searchKeyVersion: search.keyVersion,
      timestamp,
    });
  } catch (error: any) {
    if (error?.code !== 11000 || !clientMessageId) throw error;
    const existing = await Message.findOne({ senderId: input.senderId, clientMessageId });
    if (!existing) throw error;
    assertSameConversation(existing.conversationId, input.conversationId);
    return { ...presentMessage(existing), deduplicated: true };
  }

  try {
    await Conversation.findByIdAndUpdate(input.conversationId, {
      $set: {
        last_message: '',
        lastMessageSenderId: input.senderId,
        lastMessageCiphertext: previewEnvelope.ciphertext,
        lastMessageIv: previewEnvelope.iv,
        lastMessageAuthTag: previewEnvelope.authTag,
        lastMessageKeyVersion: previewEnvelope.keyVersion,
        updated_at: timestamp,
      },
    });
  } catch (error) {
    await Message.deleteOne({ _id: messageId });
    throw error;
  }

  return {
    _id: message._id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    content,
    messageType: message.messageType || 'text',
    sharedPostId: message.sharedPostId,
    replyToMessageId: message.replyToMessageId,
    forwarded: message.forwarded === true,
    timestamp: message.timestamp,
    status: message.status,
  };
}

function assertSameConversation(actual: unknown, expected: Types.ObjectId): void {
  if (String(actual) !== String(expected)) {
    throw new Error('clientMessageId is already bound to another conversation.');
  }
}

function normalizeClientMessageId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (!/^[a-zA-Z0-9:_-]{1,128}$/u.test(normalized)) {
    throw new Error('clientMessageId is invalid.');
  }
  return normalized;
}

export function presentMessage(document: any): PlainMessage {
  return {
    _id: document._id,
    conversationId: document.conversationId,
    senderId: document.senderId,
    content: document.unsentAt ? '' : readMessageContent(document),
    messageType: document.messageType || 'text',
    sharedPostId: document.sharedPostId,
    replyToMessageId: document.replyToMessageId,
    forwarded: document.forwarded === true,
    unsentAt: document.unsentAt,
    timestamp: document.timestamp,
    status: document.status,
  };
}

export function presentMessageSafely(document: any): PlainMessage {
  try {
    return presentMessage(document);
  } catch {
    return {
      _id: document._id,
      conversationId: document.conversationId,
      senderId: document.senderId,
      content: '',
      messageType: document.messageType || 'text',
      sharedPostId: document.sharedPostId,
      replyToMessageId: document.replyToMessageId,
      forwarded: document.forwarded === true,
      unsentAt: document.unsentAt,
      timestamp: document.timestamp,
      status: document.status,
      content_unavailable: true,
    };
  }
}

export function presentConversation(document: any): Record<string, unknown> {
  const {
    lastMessageCiphertext: _ciphertext,
    lastMessageIv: _iv,
    lastMessageAuthTag: _authTag,
    lastMessageKeyVersion: _keyVersion,
    lastMessageSenderId: _senderId,
    ...publicConversation
  } = document;
  try {
    return {
      ...publicConversation,
      last_message: readConversationPreview(document),
    };
  } catch {
    return {
      ...publicConversation,
      last_message: '',
      preview_unavailable: true,
    };
  }
}

export function readMessageContent(document: any): string {
  if (hasEnvelope(document)) {
    return decryptMessageText(envelopeFromMessage(document), {
      recordType: 'message',
      recordId: String(document._id),
      conversationId: String(document.conversationId),
      senderId: senderIdOf(document.senderId),
    });
  }
  return typeof document.content === 'string' ? document.content : '';
}

export function readConversationPreview(document: any): string {
  if (
    document.lastMessageCiphertext
    && document.lastMessageIv
    && document.lastMessageAuthTag
    && document.lastMessageKeyVersion
    && document.lastMessageSenderId
  ) {
    return decryptMessageText({
      ciphertext: document.lastMessageCiphertext,
      iv: document.lastMessageIv,
      authTag: document.lastMessageAuthTag,
      keyVersion: document.lastMessageKeyVersion,
    }, {
      recordType: 'conversation_preview',
      recordId: String(document._id),
      conversationId: String(document._id),
      senderId: String(document.lastMessageSenderId),
    });
  }
  return typeof document.last_message === 'string' ? document.last_message : '';
}

function hasEnvelope(document: any): boolean {
  return Boolean(
    document.ciphertext
    && document.iv
    && document.authTag
    && document.keyVersion,
  );
}

function envelopeFromMessage(document: any): EncryptedTextEnvelope {
  return {
    ciphertext: document.ciphertext,
    iv: document.iv,
    authTag: document.authTag,
    keyVersion: document.keyVersion,
  };
}

function senderIdOf(sender: any): string {
  return String(sender?._id ?? sender);
}
