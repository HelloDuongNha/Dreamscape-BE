import { Types } from 'mongoose';

export type DeleteDreamRequestDto = {
  dreamId: Types.ObjectId;
};

export type DeleteDreamRequestParseResult =
  | { ok: true; value: DeleteDreamRequestDto }
  | { ok: false; message: 'Invalid dreamId.' };

// Parse the route ID here; the service checks ownership.
export function parseDeleteDreamRequest(params: unknown): DeleteDreamRequestParseResult {
  const rawId = String((params as { id?: unknown } | null)?.id ?? '');
  if (!Types.ObjectId.isValid(rawId)) {
    return { ok: false, message: 'Invalid dreamId.' };
  }
  return {
    ok: true,
    value: { dreamId: new Types.ObjectId(rawId) },
  };
}
