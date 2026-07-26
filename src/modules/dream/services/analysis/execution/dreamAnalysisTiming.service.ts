import { Types } from 'mongoose';
import Dream from '../../../models/Dream';

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Dream analysis ETA.
 *
 * First run:
 *   55s setup/retrieval + 0.18s per normalized input character.
 *
 * Later runs:
 *   35% first-run heuristic + 65% median observed seconds/character from the
 *   user's eight latest completed analyses. The estimate is a schedule, never
 *   a timeout, and is bounded to 45 seconds–30 minutes.
 */
export async function estimateDreamAnalysisSeconds(
  userId: string | Types.ObjectId,
  narrative: string,
): Promise<number> {
  const characterCount = Math.max(1, String(narrative || '').normalize('NFKC').trim().length);
  const heuristicSeconds = 55 + characterCount * 0.18;
  const history = await Dream.find({
    userId: new Types.ObjectId(String(userId)),
    ai_status: 'completed',
    'analysisMetadata.durationMs': { $gt: 0 },
  })
    .select('content additions analysisMetadata.durationMs')
    .sort({ 'analysisMetadata.generatedAt': -1, created_at: -1 })
    .limit(8)
    .lean();

  const observedRates = history.flatMap((item: any) => {
    const previousLength = [
      String(item.content || ''),
      ...(Array.isArray(item.additions) ? item.additions.map((entry: any) => String(entry.content || '')) : []),
    ].join('\n').normalize('NFKC').trim().length;
    const durationSeconds = Number(item.analysisMetadata?.durationMs) / 1000;
    return previousLength > 0 && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? [durationSeconds / previousLength]
      : [];
  });
  const observedSecondsPerCharacter = median(observedRates);
  const estimated = observedSecondsPerCharacter === null
    ? heuristicSeconds
    : heuristicSeconds * 0.35 + (35 + observedSecondsPerCharacter * characterCount) * 0.65;
  return Math.max(45, Math.min(30 * 60, Math.round(estimated)));
}
