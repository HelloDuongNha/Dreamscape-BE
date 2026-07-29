import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import DreamSymbolObservation from '../../../models/DreamSymbolObservation';

export function canonicalizeObservedSymbol(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
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
          meaning: String(note?.meaning || '').trim(),
          dreamEvidence: evidence,
          relevance: Math.min(1, Math.max(0, Number(note?.relevance) || 0)),
          symbolValence: Math.min(2, Math.max(-2, Number(note?.symbolValence) || 0)),
          noteIndex,
          contextFingerprint: createHash('sha256').update(evidence, 'utf8').digest('hex'),
          contextualTone: ['threatening', 'reassuring', 'ambivalent'].includes(note?.contextualTone)
            ? note.contextualTone
            : 'neutral',
          origin: 'contextual_observation',
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
  recentMeanings: string[];
  evidenceExamples: string[];
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
    observations: Array<{ label?: string; meaning?: string; evidence?: string }>;
  }>([
    { $match: {
      symbolKey: { $in: keys },
      $or: [{ userId }, { isPublic: true }],
    } },
    { $project: {
      symbolKey: 1,
      displayLabel: 1,
      contextualTone: 1,
      meaning: 1,
      dreamEvidence: 1,
      owner: { $cond: [{ $eq: ['$userId', userId] }, 'personal', 'public'] },
    } },
    { $group: {
      _id: { symbolKey: '$symbolKey', owner: '$owner', tone: '$contextualTone' },
      count: { $sum: 1 },
      observations: {
        $push: {
          label: '$displayLabel',
          meaning: '$meaning',
          evidence: '$dreamEvidence',
        },
      },
    } },
  ]);

  const byKey = new Map<string, ObservedSymbolPattern>();
  for (const row of rows) {
    const current = byKey.get(row._id.symbolKey) || {
      symbolKey: row._id.symbolKey,
      matchedLabels: labelsByKey.get(row._id.symbolKey) || [],
      recentMeanings: [],
      evidenceExamples: [],
      personalDreamCount: 0,
      publicDreamCount: 0,
      toneCounts: { threatening: 0, reassuring: 0, ambivalent: 0, neutral: 0 },
    };
    if (row._id.owner === 'personal') current.personalDreamCount += row.count;
    else current.publicDreamCount += row.count;
    for (const observation of row.observations || []) {
      if (observation.meaning && current.recentMeanings.length < 3) {
        current.recentMeanings.push(String(observation.meaning));
      }
      if (observation.evidence && current.evidenceExamples.length < 3) {
        current.evidenceExamples.push(String(observation.evidence));
      }
      if (observation.label && !current.matchedLabels.includes(String(observation.label))) {
        current.matchedLabels.push(String(observation.label));
      }
    }
    const tone = row._id.tone;
    if (tone in current.toneCounts) current.toneCounts[tone] += row.count;
    byKey.set(row._id.symbolKey, current);
  }
  return [...byKey.values()];
}
