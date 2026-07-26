import Dream from '../../../models/Dream';
import { enqueueDreamAnalysis } from './dreamAnalysisQueue.service';
import { composeDreamNarrative } from '../../content/dreamNarrative.service';

type BackgroundRunner = (
  dreamId: unknown,
  userId: string,
  content: string,
  sleepContext: unknown,
  runId: string,
) => Promise<void>;

// Requeue persisted pending runs after a process restart.
export async function recoverPendingDreamAnalysisQueue(
  runBackgroundAnalysis: BackgroundRunner,
): Promise<number> {
  const pendingDreams = await Dream.find({
    ai_status: 'pending',
    'analysisRun.runId': { $exists: true, $ne: '' },
  }).select('_id userId content additions sleepContext analysisRun').sort({ created_at: 1 }).lean();

  let recovered = 0;
  for (const dream of pendingDreams) {
    const runId = String((dream as any)?.analysisRun?.runId || '').trim();
    const userId = String((dream as any)?.userId || '').trim();
    if (!runId || !userId) continue;
    if (enqueueDreamAnalysis({
      dreamId: String((dream as any)._id),
      userId,
      runId,
      execute: () => runBackgroundAnalysis(
        (dream as any)._id,
        userId,
        composeDreamNarrative(String((dream as any).content || ''), Array.isArray((dream as any).additions) ? (dream as any).additions : []),
        (dream as any).sleepContext || {},
        runId,
      ),
    })) recovered += 1;
  }
  return recovered;
}
