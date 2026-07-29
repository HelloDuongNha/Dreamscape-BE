import type { Request } from 'express';

export const DREAM_MOOD_LEVELS = [
  'very-negative',
  'negative',
  'mixed',
  'positive',
  'very-positive',
] as const;

export type DreamMoodLevel = (typeof DREAM_MOOD_LEVELS)[number];

export interface DreamSearchRequestDto {
  query: string;
  mood: DreamMoodLevel | null;
  limit: number;
  cursor: Date | null;
}

export type DreamSearchDtoResult =
  | { ok: true; value: DreamSearchRequestDto }
  | { ok: false; message: string; code: string };

export function parseDreamSearchRequest(query: Request['query']): DreamSearchDtoResult {
  const searchQuery = normalizeSearchQuery(query.q);
  if (searchQuery.length > 120) {
    return {
      ok: false,
      code: 'dream_search_query_too_long',
      message: 'Search query must not exceed 120 characters.',
    };
  }

  const mood = parseMoodLevel(query.mood);
  if (mood === undefined) {
    return {
      ok: false,
      code: 'dream_search_invalid_mood',
      message: 'Invalid dream mood filter.',
    };
  }
  if (!searchQuery && !mood) {
    return {
      ok: false,
      code: 'dream_search_empty',
      message: 'Enter search text or select a mood colour.',
    };
  }

  const rawLimit = Number.parseInt(String(query.limit ?? '20'), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, 30)
    : 20;

  const cursor = parseCursor(query.nextCursor);
  return {
    ok: true,
    value: {
      query: searchQuery,
      mood,
      limit,
      cursor,
    },
  };
}

function normalizeSearchQuery(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ')
    : '';
}

function parseMoodLevel(value: unknown): DreamMoodLevel | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  return (DREAM_MOOD_LEVELS as readonly string[]).includes(value)
    ? value as DreamMoodLevel
    : undefined;
}

function parseCursor(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const cursor = new Date(value);
  return Number.isNaN(cursor.getTime()) ? null : cursor;
}
