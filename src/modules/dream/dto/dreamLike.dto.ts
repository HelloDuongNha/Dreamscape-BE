import { Types } from 'mongoose';

export type ToggleDreamLikeDto = {
  dreamId: Types.ObjectId;
};

export type DreamLikeParseResult =
  | { ok: true; value: ToggleDreamLikeDto }
  | { ok: false; message: 'Invalid dreamId.' };

export function parseDreamLikeRequest(params: unknown): DreamLikeParseResult {
  const rawId = String((params as { id?: unknown } | null)?.id ?? '');
  if (!Types.ObjectId.isValid(rawId)) {
    return { ok: false, message: 'Invalid dreamId.' };
  }
  return { ok: true, value: { dreamId: new Types.ObjectId(rawId) } };
}
