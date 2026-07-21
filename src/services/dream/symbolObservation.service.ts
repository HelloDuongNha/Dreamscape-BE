import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import DreamSymbolObservation from '../../models/DreamSymbolObservation';

const CANONICAL_ALIASES: Array<{ key: string; aliases: RegExp }> = [
  { key: 'grandmother', aliases: /^(?:bà|bà ngoại|bà nội|grandmother|grandma)$/iu },
  { key: 'grandfather', aliases: /^(?:ông|ông ngoại|ông nội|grandfather|grandpa)$/iu },
  { key: 'notebook', aliases: /^(?:cuốn sổ|quyển sổ|sổ tay|sổ|notebook)$/iu },
  { key: 'bridge', aliases: /^(?:cây cầu|cầu|bridge)$/iu },
  { key: 'door', aliases: /^(?:cánh cửa|cửa|door)$/iu },
  { key: 'chase', aliases: /^(?:đuổi theo|bị đuổi|rượt đuổi|chase|chasing)$/iu },
  { key: 'water', aliases: /^(?:dòng nước|mặt nước|nước|water)$/iu },
  { key: 'school', aliases: /^(?:ngôi trường|trường cũ|trường học|school|old school)$/iu },
];

export function canonicalizeObservedSymbol(value: unknown): string {
  const normalized = String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return CANONICAL_ALIASES.find(item => item.aliases.test(normalized))?.key || normalized;
}

export function buildObservedSymbolLookupCandidates(narrative: string, limit = 400): string[] {
  const tokens = String(narrative || '')
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/gu)
    .filter(Boolean);
  const ignored = new Set(['tôi', 'mình', 'bạn', 'một', 'những', 'các', 'và', 'là', 'có', 'không', 'trong', 'khi', 'sau', 'trước']);
  const output: string[] = [];
  const seen = new Set<string>();
  for (let width = Math.min(4, tokens.length); width >= 1; width -= 1) {
    for (let index = 0; index + width <= tokens.length; index += 1) {
      const value = tokens.slice(index, index + width).join(' ');
      if (value.length < 3 || (width === 1 && ignored.has(value))) continue;
      const canonical = canonicalizeObservedSymbol(value);
      if (!seen.has(canonical)) {
        seen.add(canonical);
        output.push(value);
      }
      if (output.length >= limit) return output;
    }
  }
  return output;
}

export async function materializeDreamSymbolObservations(input: {
  dreamId: Types.ObjectId;
  userId: Types.ObjectId;
  isPublic: boolean;
  symbolicNotes: any[];
}): Promise<void> {
  const notes = (input.symbolicNotes || []).flatMap((note, noteIndex) => {
    const displayLabel = String(note?.symbol || '').trim();
    const evidence = String(note?.dreamEvidence || '').trim();
    const symbolKey = canonicalizeObservedSymbol(displayLabel);
    if (!displayLabel || !evidence || symbolKey.length < 2) return [];
    return [{ note, noteIndex, displayLabel, evidence, symbolKey }];
  });

  const retainedKeys = [...new Set(notes.map(item => item.symbolKey))];
  if (retainedKeys.length === 0) {
    await DreamSymbolObservation.deleteMany({ dreamId: input.dreamId });
    return;
  }

  await DreamSymbolObservation.bulkWrite(notes.map(({ note, noteIndex, displayLabel, evidence, symbolKey }) => ({
    updateOne: {
      filter: { dreamId: input.dreamId, symbolKey },
      update: {
        $set: {
          userId: input.userId,
          displayLabel,
          noteIndex,
          contextFingerprint: createHash('sha256').update(evidence, 'utf8').digest('hex'),
          contextualTone: ['threatening', 'reassuring', 'ambivalent'].includes(note?.contextualTone)
            ? note.contextualTone
            : 'neutral',
          origin: note?.origin === 'dictionary' ? 'dictionary' : 'contextual_observation',
          ...(note?.dictionarySymbol ? { dictionarySymbol: String(note.dictionarySymbol) } : {}),
          isPublic: input.isPublic,
        },
      },
      upsert: true,
    },
  })), { ordered: false });

  await DreamSymbolObservation.deleteMany({
    dreamId: input.dreamId,
    symbolKey: { $nin: retainedKeys },
  });
}

export interface ObservedSymbolPattern {
  symbolKey: string;
  matchedLabels: string[];
  personalDreamCount: number;
  publicDreamCount: number;
  toneCounts: Record<'threatening' | 'reassuring' | 'ambivalent' | 'neutral', number>;
}

type ObservedTone = keyof ObservedSymbolPattern['toneCounts'];

export async function loadObservedSymbolPatterns(
  symbols: string[],
  userId: Types.ObjectId,
): Promise<ObservedSymbolPattern[]> {
  const keys = [...new Set(symbols.map(canonicalizeObservedSymbol).filter(key => key.length >= 2))].slice(0, 400);
  const labelsByKey = new Map<string, string[]>();
  for (const symbol of symbols) {
    const key = canonicalizeObservedSymbol(symbol);
    if (!keys.includes(key)) continue;
    labelsByKey.set(key, [...new Set([...(labelsByKey.get(key) || []), String(symbol).trim()].filter(Boolean))]);
  }
  if (keys.length === 0) return [];
  const rows = await DreamSymbolObservation.aggregate<{
    _id: { symbolKey: string; owner: 'personal' | 'public'; tone: ObservedTone };
    count: number;
  }>([
    { $match: {
      symbolKey: { $in: keys },
      $or: [{ userId }, { isPublic: true }],
    } },
    { $project: {
      symbolKey: 1,
      contextualTone: 1,
      owner: { $cond: [{ $eq: ['$userId', userId] }, 'personal', 'public'] },
    } },
    { $group: {
      _id: { symbolKey: '$symbolKey', owner: '$owner', tone: '$contextualTone' },
      count: { $sum: 1 },
    } },
  ]);

  const byKey = new Map<string, ObservedSymbolPattern>();
  for (const row of rows) {
    const current = byKey.get(row._id.symbolKey) || {
      symbolKey: row._id.symbolKey,
      matchedLabels: labelsByKey.get(row._id.symbolKey) || [],
      personalDreamCount: 0,
      publicDreamCount: 0,
      toneCounts: { threatening: 0, reassuring: 0, ambivalent: 0, neutral: 0 },
    };
    if (row._id.owner === 'personal') current.personalDreamCount += row.count;
    else current.publicDreamCount += row.count;
    const tone = row._id.tone;
    if (tone in current.toneCounts) current.toneCounts[tone] += row.count;
    byKey.set(row._id.symbolKey, current);
  }
  return [...byKey.values()];
}
