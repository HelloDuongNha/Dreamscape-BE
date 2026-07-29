import { Types } from 'mongoose';

export type DreamPrivacy = 'public' | 'private';

export type UpdateDreamPrivacyDto = {
  dreamId: Types.ObjectId;
  privacy: DreamPrivacy;
};

export type DreamPrivacyParseResult =
  | { ok: true; value: UpdateDreamPrivacyDto }
  | {
      ok: false;
      message: 'Invalid dreamId.' | 'privacy must be "public" or "private".';
    };

export function parseDreamPrivacyRequest(
  params: unknown,
  body: unknown,
): DreamPrivacyParseResult {
  const rawId = String((params as { id?: unknown } | null)?.id ?? '');
  if (!Types.ObjectId.isValid(rawId)) {
    return { ok: false, message: 'Invalid dreamId.' };
  }

  const privacy = (body as { privacy?: unknown } | null)?.privacy;
  if (privacy !== 'public' && privacy !== 'private') {
    return {
      ok: false,
      message: 'privacy must be "public" or "private".',
    };
  }

  return {
    ok: true,
    value: {
      dreamId: new Types.ObjectId(rawId),
      privacy,
    },
  };
}
