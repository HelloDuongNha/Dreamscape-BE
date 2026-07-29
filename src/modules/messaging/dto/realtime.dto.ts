export interface JoinConversationPayload {
  conversationId?: string;
}

export interface SendMessagePayload {
  conversationId?: string;
  content?: string;
  tempId?: string;
}

export interface MessageDeliveredPayload {
  messageId?: string;
}

export interface MarkAsSeenPayload {
  conversationId?: string;
}
