import { generateStructuredJson } from '../../../../../infrastructure/llm.service';
import { buildDreamContinuationPrompt } from '../prompts/dreamContinuation.prompt';

export interface DreamContinuation {
  title: string;
  continuation: string;
  connectionToCurrentDream: string;
  disclaimer: string;
  inspirationIndexes: number[];
  inspirations?: Array<{ dreamId: string; title: string; similarity: number }>;
}

function normalizeForComparison(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('vi');
}

function validateContinuation(value: any, narrative: string): DreamContinuation {
  const title = String(value?.title || '').trim();
  const continuation = String(value?.continuation || '').trim();
  const connectionToCurrentDream = String(value?.connectionToCurrentDream || '').trim();
  const endingWakeReaction = String(value?.endingWakeReaction || '').trim();
  const normalizedNarrative = normalizeForComparison(narrative);
  const sourceAnchors = Array.isArray(value?.sourceAnchors)
    ? value.sourceAnchors.map((anchor: unknown) => String(anchor || '').trim()).filter(Boolean)
    : [];
  const groundedAnchors = sourceAnchors.filter((anchor: string) =>
    normalizedNarrative.includes(normalizeForComparison(anchor)),
  );
  if (!title || !continuation || !connectionToCurrentDream
    || groundedAnchors.length < 2
    || !endingWakeReaction
    || !normalizeForComparison(continuation).endsWith(normalizeForComparison(endingWakeReaction))) {
    throw new Error('dream_continuation_invalid');
  }
  return {
    title,
    continuation,
    connectionToCurrentDream,
    disclaimer: 'Đây là đoạn sáng tác tham khảo, không phải dự báo hay kết luận tâm lý.',
    inspirationIndexes: [],
  };
}

// Writes a new fictional branch without rerunning the scientific analysis.
export async function generateDreamContinuation(
  narrative: string,
  previousContinuations: DreamContinuation[] = [],
): Promise<DreamContinuation> {
  const prompt = buildDreamContinuationPrompt({
    narrative,
    previousContinuations: previousContinuations.slice(-3).map(item => item.continuation),
  });
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await generateStructuredJson<Record<string, unknown>>(
        prompt,
        undefined,
        {
          temperature: 0.58,
          seed: Math.floor(Date.now() / 1000) + attempt,
        },
      );
      return validateContinuation(result, narrative);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
