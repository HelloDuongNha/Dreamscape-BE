export interface ConversationSearchRequestDto {
  username?: string;
  targetUserId?: string;
  open?: boolean;
  searchMode?: string;
  query?: string;
}

export function parseConversationSearchRequest(
  body: unknown,
): ConversationSearchRequestDto {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const input = body as Record<string, unknown>;
  return {
    username: input.username as string | undefined,
    targetUserId: input.targetUserId as string | undefined,
    open: input.open as boolean | undefined,
    searchMode: input.searchMode as string | undefined,
    query: input.query as string | undefined,
  };
}
