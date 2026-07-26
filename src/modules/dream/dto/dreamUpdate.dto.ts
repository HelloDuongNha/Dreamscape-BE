import type { Request } from 'express';
import { Types } from 'mongoose';

export interface UpdateDreamRequestDto {
  dreamId: string;
  content: string;
  additions?: Array<{
    sequence?: number;
    content: string;
  }>;
}

export type UpdateDreamDtoResult =
  | { ok: true; value: UpdateDreamRequestDto }
  | { ok: false; status: 400; message: string };

// Parse the complete edit draft without changing the existing request contract.
export function parseUpdateDreamRequest(
  params: Request['params'],
  body: unknown,
): UpdateDreamDtoResult {
  const dreamId = String(params.id);
  if (!Types.ObjectId.isValid(dreamId)) {
    return { ok: false, status: 400, message: 'Invalid dreamId.' };
  }

  const content = (body as { content?: unknown } | null)?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    return { ok: false, status: 400, message: 'content is required.' };
  }

  const rawAdditions = (body as { additions?: unknown } | null)?.additions;
  if (rawAdditions === undefined) {
    return { ok: true, value: { dreamId, content } };
  }
  if (!Array.isArray(rawAdditions) || rawAdditions.length > 10) {
    return { ok: false, status: 400, message: 'additions must contain at most 10 items.' };
  }

  const additions: NonNullable<UpdateDreamRequestDto['additions']> = [];
  const seenSequences = new Set<number>();
  for (const item of rawAdditions) {
    const additionContent = typeof (item as any)?.content === 'string'
      ? (item as any).content.normalize('NFKC').replace(/\s+/gu, ' ').trim()
      : '';
    // Empty additions are removed; the service rebuilds their order.
    if (!additionContent) continue;
    if (additionContent.length > 2000) {
      return {
        ok: false,
        status: 400,
        message: 'Each addition must not exceed 2,000 characters.',
      };
    }
    const rawSequence = (item as any)?.sequence;
    if (Number.isInteger(rawSequence) && rawSequence > 0) {
      if (seenSequences.has(rawSequence)) {
        return { ok: false, status: 400, message: 'Addition sequences must be unique.' };
      }
      seenSequences.add(rawSequence);
    }
    additions.push({
      ...(Number.isInteger(rawSequence) && rawSequence > 0 ? { sequence: rawSequence } : {}),
      content: additionContent,
    });
  }

  return { ok: true, value: { dreamId, content, additions } };
}
