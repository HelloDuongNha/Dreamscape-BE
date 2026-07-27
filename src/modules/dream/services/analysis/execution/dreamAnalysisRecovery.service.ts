import { Types } from 'mongoose';
import Dream from '../../../models/Dream';
import { enqueueDreamAnalysis } from './dreamAnalysisQueue.service';
import { composeDreamNarrative } from '../../content/dreamNarrative.service';

type BackgroundRunner = (
  dreamId: Types.ObjectId | string,
  userId: string,
  content: string,
  sleepContext: Record<string, any>,
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
    const runId = String(dream.analysisRun?.runId || '').trim();
    const userId = String(dream.userId || '').trim();
    if (!runId || !userId) continue;
    if (enqueueDreamAnalysis({
      dreamId: String(dream._id),
      userId,
      runId,
      execute: () => runBackgroundAnalysis(
        dream._id,
        userId,
        composeDreamNarrative(String(dream.content || ''), dream.additions || []),
        dream.sleepContext || {},
        runId,
      ),
    })) recovered += 1;
  }
  return recovered;
}
