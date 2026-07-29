import { Types } from 'mongoose';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import {
  createMessageSearchTokens,
  decryptMessageText,
  encryptMessageText,
  type EncryptedTextEnvelope,
} from './messagingCrypto.service';

export interface PlainMessage {
  _id: unknown;
  conversationId: unknown;
  senderId: unknown;
  content: string;
  timestamp: Date;
  status: 'sent' | 'delivered' | 'seen';
  content_unavailable?: boolean;
}

export async function persistEncryptedMessage(input: {
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  content: string;
}): Promise<PlainMessage> {
  const content = input.content.normalize('NFKC').trim();
  if (!content || content.length > 2000) {
    throw new Error('Message content must contain between 1 and 2000 characters.');
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

  const message = await Message.create({
    _id: messageId,
    conversationId: input.conversationId,
    senderId: input.senderId,
    ...contentEnvelope,
    searchTokens: search.tokens,
    searchKeyVersion: search.keyVersion,
    timestamp,
  });

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
    timestamp: message.timestamp,
    status: message.status,
  };
}

export function presentMessage(document: any): PlainMessage {
  return {
    _id: document._id,
    conversationId: document.conversationId,
    senderId: document.senderId,
    content: readMessageContent(document),
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
