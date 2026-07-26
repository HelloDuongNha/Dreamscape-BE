export interface CreateDreamRequestDto {
  content: string;
  moodTag?: string;
  isPublic?: boolean;
}

export type CreateDreamDtoResult =
  | { ok: true; value: CreateDreamRequestDto }
  | { ok: false; message: string };

export function parseCreateDreamRequest(body: unknown): CreateDreamDtoResult {
  const { content, mood_tag, is_public } = body as {
    content: string;
    mood_tag?: string;
    is_public?: boolean;
  };

  if (!content || content.trim() === '') {
    return { ok: false, message: 'Dream content is required.' };
  }

  return {
    ok: true,
    value: {
      content,
      moodTag: mood_tag,
      isPublic: is_public,
    },
  };
}

