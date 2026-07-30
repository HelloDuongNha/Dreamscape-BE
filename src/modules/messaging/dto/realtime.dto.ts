export interface JoinConversationPayload {
  conversationId?: string;
}

export interface SendMessagePayload {
  conversationId?: string;
  content?: string;
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
