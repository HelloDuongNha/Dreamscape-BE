export interface AnalyzeDreamDto {
  dreamText: string;
  sleepContext: Record<string, unknown>;
  visibility: 'public' | 'private';
}

export function parseAnalyzeDreamRequest(body: unknown):
  | { ok: true; value: AnalyzeDreamDto }
  | { ok: false; status: 400; message: string } {
  const input = body && typeof body === 'object'
    ? body as Record<string, unknown>
    : {};
  const dreamText = typeof input.dreamText === 'string' ? input.dreamText.trim() : '';
  if (!dreamText) {
    return { ok: false, status: 400, message: 'dreamText is required.' };
  }
  if (dreamText.length > 2000) {
    return {
      ok: false,
      status: 400,
      message: 'dreamText must not exceed 2000 characters.',
    };
  }

  const visibility = input.visibility === undefined ? 'private' : input.visibility;
  if (visibility !== 'public' && visibility !== 'private') {
    return {
      ok: false,
      status: 400,
      message: 'visibility must be "public" or "private".',
    };
  }
  const sleepContext = input.sleepContext
    && typeof input.sleepContext === 'object'
    && !Array.isArray(input.sleepContext)
    ? input.sleepContext as Record<string, unknown>
    : {};
  return { ok: true, value: { dreamText, sleepContext, visibility } };
}
