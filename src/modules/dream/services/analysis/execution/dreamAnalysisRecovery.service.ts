import { Types } from 'mongoose';
import Dream from '../../../models/Dream';
import { enqueueDreamAnalysis } from './dreamAnalysisQueue.service';
import { composeDreamNarrative } from '../../content/dreamNarrative.service';
import { enqueueRecoveredDreamContinuation } from './dreamContinuationJob.service';

type BackgroundRunner = (
  dreamId: Types.ObjectId | string,
  userId: string,
  content: string,
  sleepContext: Record<string, any>,
  runId: string,
) => Promise<void>;

// Requeue persisted analysis and continuation jobs in their original order.
export async function recoverPendingDreamAnalysisQueue(
  runBackgroundAnalysis: BackgroundRunner,
): Promise<number> {
  await Dream.updateMany({
    'continuationMetadata.status': 'running',
    'continuationMetadata.runId': { $exists: true, $ne: '' },
  }, {
    $set: {
      'continuationMetadata.status': 'queued',
      'continuationMetadata.progress': 0,
      'continuationMetadata.statusMessage': 'Đang chờ khôi phục phần tiếp theo...',
      'continuationMetadata.queuePosition': 1,
      'continuationMetadata.lastProgressAt': new Date(),
    },
  });
  const pendingDreams = await Dream.find({
    $or: [
      {
        ai_status: 'pending',
        'analysisRun.runId': { $exists: true, $ne: '' },
      },
      {
        'continuationMetadata.status': 'queued',
        'continuationMetadata.runId': { $exists: true, $ne: '' },
      },
    ],
  }).select(
    '_id userId content additions sleepContext analysisRun analysisMetadata continuationMetadata created_at',
  ).lean();
  const jobs = orderPendingDreamJobs(pendingDreams);

  let recovered = 0;
  for (const job of jobs) {
    if (!job.runId || !job.userId) continue;
    const queued = job.type === 'continuation'
      ? enqueueRecoveredDreamContinuation(
        String(job.dream._id),
        job.userId,
        job.runId,
      )
      : enqueueDreamAnalysis({
        dreamId: String(job.dream._id),
        userId: job.userId,
        runId: job.runId,
        execute: () => runBackgroundAnalysis(
          job.dream._id,
          job.userId,
          composeDreamNarrative(
            String(job.dream.content || ''),
            job.dream.additions || [],
          ),
          job.dream.sleepContext || {},
          job.runId,
        ),
      });
    if (queued) recovered += 1;
  }
  return recovered;
}

export function orderPendingDreamJobs(pendingDreams: any[]) {
  return pendingDreams.flatMap((dream) => {
    const userId = String(dream.userId || '').trim();
    const analysisRunId = String(dream.analysisRun?.runId || '').trim();
    const continuationRunId = String(dream.continuationMetadata?.runId || '').trim();
    return [
      ...(dream.ai_status === 'pending' && analysisRunId ? [{
        type: 'analysis' as const,
        dream,
        userId,
        runId: analysisRunId,
        enqueuedAt: dream.analysisMetadata?.enqueuedAt
          || dream.analysisRun?.startedAt
          || dream.created_at,
      }] : []),
      ...(dream.continuationMetadata?.status === 'queued' && continuationRunId ? [{
        type: 'continuation' as const,
        dream,
        userId,
        runId: continuationRunId,
        enqueuedAt: dream.continuationMetadata?.enqueuedAt
          || dream.continuationMetadata?.startedAt
          || dream.created_at,
      }] : []),
    ];
  }).sort((left, right) =>
    new Date(left.enqueuedAt || 0).getTime() - new Date(right.enqueuedAt || 0).getTime());
}
