import { generateStructuredJson } from '../../../../../infrastructure/llm.service';
import {
  buildDreamContinuationPrompt,
  selectFinalDreamScene,
} from '../prompts/dreamContinuation.prompt';

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

function validateContinuation(value: any, narrative: string, strict = true): DreamContinuation {
  const title = String(value?.title || '').trim();
  const continuation = String(value?.continuation || '').trim();
  const connectionToCurrentDream = String(value?.connectionToCurrentDream || '').trim();
  const startingAnchor = String(value?.startingAnchor || '').trim();
  const awakeningBridge = String(value?.awakeningBridge || '').trim();
  const endingWakeReaction = String(value?.endingWakeReaction || '').trim();
  const normalizedNarrative = normalizeForComparison(narrative);
  const normalizedFinalScene = normalizeForComparison(selectFinalDreamScene(narrative));
  const normalizedContinuation = normalizeForComparison(continuation);
  const normalizedAwakeningBridge = normalizeForComparison(awakeningBridge);
  const awakeningBridgeSentenceCount = awakeningBridge
    .split(/(?<=[.!?…])\s+/u)
    .map(sentence => sentence.trim())
    .filter(Boolean)
    .length;
  const awakeningBridgePosition = normalizedContinuation.indexOf(normalizedAwakeningBridge);
  const sourceAnchors = Array.isArray(value?.sourceAnchors)
    ? value.sourceAnchors.map((anchor: unknown) => String(anchor || '').trim()).filter(Boolean)
    : [];
  const groundedAnchors = sourceAnchors.filter((anchor: string) =>
    normalizedNarrative.includes(normalizeForComparison(anchor)),
  );
  const hasRequiredCore = Boolean(title && continuation && connectionToCurrentDream);
  const hasGrounding = groundedAnchors.length >= 2
    && Boolean(startingAnchor)
    && normalizedFinalScene.includes(normalizeForComparison(startingAnchor));
  const hasEarnedAwakening = Boolean(awakeningBridge)
    && awakeningBridgeSentenceCount >= 2
    && awakeningBridgePosition >= normalizedContinuation.length * 0.5
    && Boolean(endingWakeReaction)
    && normalizedContinuation.endsWith(normalizeForComparison(endingWakeReaction));
  if (!hasRequiredCore || (strict && (!hasGrounding || !hasEarnedAwakening))) {
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

function buildRepairPrompt(
  narrative: string,
  candidate: Record<string, unknown>,
): string {
  return `You are repairing a structured creative continuation of a dream.

Original dream (the only canon):
${narrative}

Candidate JSON that failed validation:
${JSON.stringify(candidate)}

Return JSON only with exactly these fields:
{
  "title": "short Vietnamese title",
  "continuation": "120-220 Vietnamese words",
  "connectionToCurrentDream": "one concise sentence",
  "sourceAnchors": ["two exact short excerpts from the original dream"],
  "startingAnchor": "an exact excerpt from the final unresolved scene",
  "awakeningBridge": "two to four exact sentences near the end: a concrete dream change, the narrator senses or realizes it, then the narrator wakes",
  "endingWakeReaction": "the exact final sentence, describing a new specific feeling after waking"
}

Keep the candidate's strongest ideas, but repair continuity. Continue only from the original dream's final moment; do not continue any old generated branch. Use only existing people, places and objects except one small connecting detail. The ending must earn the awakening through a concrete sensory or reality-breaking change, not an arbitrary alarm or an abrupt sentence.`;
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
  let lastCandidate: Record<string, unknown> | undefined;
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
      lastCandidate = result;
      return validateContinuation(result, narrative, true);
    } catch (error) {
      lastError = error;
    }
  }

  // A provider may return a good story while omitting our internal audit fields.
  // Repair once before falling back, so a transient schema miss never becomes a user-visible 500.
  if (lastCandidate) {
    try {
      const repaired = await generateStructuredJson<Record<string, unknown>>(
        buildRepairPrompt(narrative, lastCandidate),
        undefined,
        { temperature: 0.45, seed: Math.floor(Date.now() / 1000) + 2 },
      );
      return validateContinuation(repaired, narrative, true);
    } catch (error) {
      lastError = error;
    }

    // Keep the core story available if the provider still omits only audit metadata.
    try {
      return validateContinuation(lastCandidate, narrative, false);
    } catch {
      // Fall through to the original error for genuinely unusable provider output.
    }
  }
  throw lastError;
}
