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
 *   45s setup/retrieval + 0.06s per normalized input character. The prompt is
 *   compacted before generation, so raw narrative length is only a baseline.
 *
 * Later runs:
 *   30% baseline + 70% median processing seconds/character from the user's
 *   latest completed runs. Queue waiting time is excluded from the samples.
 */
export async function estimateDreamAnalysisSeconds(
  userId: string | Types.ObjectId,
  narrative: string,
): Promise<number> {
  const characterCount = Math.max(1, String(narrative || '').normalize('NFKC').trim().length);
  const heuristicSeconds = 45 + characterCount * 0.06;
  const history = await Dream.find({
    userId: new Types.ObjectId(String(userId)),
    ai_status: 'completed',
    'analysisMetadata.durationMs': { $gt: 0 },
  })
    .select('content additions analysisMetadata.durationMs analysisMetadata.processingDurationMs')
    .sort({ 'analysisMetadata.generatedAt': -1, created_at: -1 })
    .limit(8)
    .lean();

  const observedRates = history.flatMap((item: any) => {
    const previousLength = [
      String(item.content || ''),
      ...(Array.isArray(item.additions) ? item.additions.map((entry: any) => String(entry.content || '')) : []),
    ].join('\n').normalize('NFKC').trim().length;
    // Legacy durationMs included queue waiting time; only use the new
    // processing-only field for future estimates.
    const durationMilliseconds = Number(item.analysisMetadata?.processingDurationMs);
    const durationSeconds = durationMilliseconds / 1000;
    return previousLength > 0 && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? [durationSeconds / previousLength]
      : [];
  });
  const observedSecondsPerCharacter = median(observedRates);
  const estimated = observedSecondsPerCharacter === null
    ? heuristicSeconds
    : heuristicSeconds * 0.30 + (45 + observedSecondsPerCharacter * characterCount) * 0.70;
  return Math.max(45, Math.min(30 * 60, Math.round(estimated)));
}
