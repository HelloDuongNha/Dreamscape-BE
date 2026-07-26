import crypto from 'crypto';
import { enrichScientificNotesForResponse } from '../analysis/grounding/dreamAnalysisGrounding.service';

export function composeDreamNarrative(
  originalContent: string,
  additions: Array<{ sequence?: number; content?: string }> = [],
): string {
  const original = String(originalContent || '').trim();
  const validAdditions = additions
    .map((item, index) => ({
      sequence: Number.isInteger(item?.sequence) && Number(item.sequence) > 0 ? Number(item.sequence) : index + 1,
      content: String(item?.content || '').trim(),
    }))
    .filter(item => item.content)
    .sort((left, right) => left.sequence - right.sequence);
  if (validAdditions.length === 0) return original;
  const blocks = validAdditions.map((item, index) => validAdditions.length === 1
    ? `Bổ sung:\n${item.content}`
    : `${index + 1}. Bổ sung:\n${item.content}`);
  return [original, ...blocks].filter(Boolean).join('\n\n');
}

export function normalizedDreamContent(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

export function dreamContentHash(value: string): string {
  return crypto.createHash('sha256').update(normalizedDreamContent(value), 'utf8').digest('hex');
}

export function mapDreamResponse(dream: any): any {
  if (!dream) return dream;
  const obj = typeof dream.toObject === 'function' ? dream.toObject() : { ...dream };
  delete obj.analysisRollback;
  const history = Array.isArray(obj.edit_history) ? obj.edit_history : [];
  const completeNarrative = composeDreamNarrative(obj.content || obj.dreamText || '', obj.additions || []);
  if (obj.ai_result) {
    obj.ai_result = enrichScientificNotesForResponse(obj.ai_result, obj.retrievedContext, completeNarrative);
    obj.aiAnalysis = obj.ai_result;
    obj.mood_tag = obj.ai_result.emotional_tone || obj.mood_tag || '';
  }

  obj.versions = [
    ...history.map((entry: any, index: number) => {
      const additions = Array.isArray(entry.additions) ? entry.additions : [];
      const narrative = composeDreamNarrative(entry.content || '', additions);
      const result = entry.ai_result
        ? enrichScientificNotesForResponse(entry.ai_result, entry.retrievedContext, narrative)
        : null;
      return {
        version: Number(entry.version) || index + 1,
        content: String(entry.content || ''),
        additions,
        ai_status: entry.ai_status || (result ? 'completed' : 'cancelled'),
        ai_result: result,
        mood_tag: entry.mood_tag || result?.emotional_tone || '',
        analysisMetadata: entry.analysisMetadata || null,
        editedAt: entry.editedAt,
        isCurrent: false,
        isLegacyPartial: !Object.prototype.hasOwnProperty.call(entry, 'additions'),
      };
    }),
    {
      version: history.length + 1,
      content: String(obj.content || ''),
      additions: Array.isArray(obj.additions) ? obj.additions : [],
      ai_status: obj.ai_status,
      ai_result: obj.ai_result || null,
      mood_tag: obj.mood_tag || '',
      analysisMetadata: obj.analysisMetadata || null,
      editedAt: obj.updated_at || obj.created_at,
      isCurrent: true,
      isLegacyPartial: false,
    },
  ];

  // Keep lightweight history for older clients; full snapshots live in versions.
  obj.edit_history = history.map((entry: any) => ({
    content: String(entry.content || ''),
    editedAt: entry.editedAt,
  }));
  return obj;
}
