import { Types } from 'mongoose';

export interface DreamAiPolicyDto {
  dreamId: string;
  enabled: boolean;
  resultPolicy?: 'keep' | 'delete';
}

export function parseDreamAiPolicy(
  params: Record<string, unknown>,
  body: unknown,
):
  | { ok: true; value: DreamAiPolicyDto }
  | { ok: false; status: 400; message: string } {
  const dreamId = String(params.id || '');
  if (!Types.ObjectId.isValid(dreamId)) {
    return { ok: false, status: 400, message: 'Invalid dream ID.' };
  }
  const enabled = (body as any)?.enabled;
  if (typeof enabled !== 'boolean') {
    return { ok: false, status: 400, message: 'enabled must be a boolean.' };
  }
  const resultPolicy = (body as any)?.resultPolicy;
  if (resultPolicy !== undefined && resultPolicy !== 'keep' && resultPolicy !== 'delete') {
    return { ok: false, status: 400, message: 'resultPolicy must be keep or delete.' };
  }
  return { ok: true, value: { dreamId, enabled, resultPolicy } };
}
