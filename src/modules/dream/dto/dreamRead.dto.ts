import type { Request } from 'express';
import { Types } from 'mongoose';

export interface DreamPaginationDto {
  limit: number;
  cursor: Date | null;
}

export interface UserDreamsRequestDto extends DreamPaginationDto {
  userId: string;
}

export interface DreamDetailRequestDto {
  dreamId: string;
}

export type DreamReadDtoResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export function parseDreamPagination(query: Request['query']): DreamPaginationDto {
  const rawLimit = parseInt(String(query.limit ?? '10'), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10;

  const rawCursor = query.nextCursor;
  let cursor: Date | null = null;
  if (typeof rawCursor === 'string' && rawCursor.trim() !== '') {
    const parsed = new Date(rawCursor);
    cursor = isNaN(parsed.getTime()) ? null : parsed;
  }

  return { limit, cursor };
}

export function parseUserDreamsRequest(
  params: Request['params'],
  query: Request['query'],
): DreamReadDtoResult<UserDreamsRequestDto> {
  const userId = String(params.userId);
  if (!Types.ObjectId.isValid(userId)) {
    return { ok: false, message: 'Invalid userId format.' };
  }

  return {
    ok: true,
    value: {
      userId,
      ...parseDreamPagination(query),
    },
  };
}

export function parseDreamDetailRequest(
  params: Request['params'],
): DreamReadDtoResult<DreamDetailRequestDto> {
  const dreamId = String(params.id);
  if (!Types.ObjectId.isValid(dreamId)) {
    return { ok: false, message: 'Invalid dream ID.' };
  }

  return { ok: true, value: { dreamId } };
}

