export interface JoinConversationPayload {
  conversationId?: string;
}

export interface SendMessagePayload {
  conversationId?: string;
  content?: string;
  messageType?: 'text' | 'shared_post';
  sharedPostId?: string;
  replyToMessageId?: string;
  forwarded?: boolean;
  tempId?: string;
  clientMessageId?: string;
}

export interface SendMessageAcknowledgement {
  success: boolean;
  code?: string;
  message?: string;
  data?: {
    _id: unknown;
    conversationId: unknown;
    senderId: string;
    content: string;
    messageType?: 'text' | 'shared_post';
    sharedPostId?: string;
    replyToMessageId?: string;
    replyTo?: {
      _id: unknown;
      senderId: unknown;
      content: string;
      messageType: 'text' | 'shared_post';
      sharedPostId?: unknown;
      unsentAt?: Date;
      content_unavailable?: boolean;
    };
    forwarded?: boolean;
    timestamp: Date;
    status: 'sent' | 'delivered' | 'seen';
    tempId?: string;
    clientMessageId?: string;
  };
}

export interface MessageDeliveredPayload {
  messageId?: string;
}

export interface MarkAsSeenPayload {
  conversationId?: string;
}
