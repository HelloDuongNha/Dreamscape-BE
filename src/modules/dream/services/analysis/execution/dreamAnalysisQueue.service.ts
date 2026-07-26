import Dream from '../../../models/Dream';
import { logger } from '../../../../../infrastructure/logger';

export interface DreamAnalysisQueueJob {
  dreamId: string;
  userId: string;
  runId: string;
  execute: () => Promise<void>;
}

const queuesByUser = new Map<string, DreamAnalysisQueueJob[]>();
const activeUsers = new Set<string>();
const readyUsers: string[] = [];
const scheduledRunKeys = new Set<string>();

let activeJobCount = 0;
let schedulerQueued = false;

function globalConcurrency(): number {
  const configured = Number(process.env.DREAM_ANALYSIS_GLOBAL_CONCURRENCY || 1);
  return Number.isFinite(configured) && configured > 0
    ? Math.max(1, Math.floor(configured))
    : 1;
}

function runKey(job: DreamAnalysisQueueJob): string {
  return `${job.dreamId}:${job.runId}`;
}

function userQueue(userId: string): DreamAnalysisQueueJob[] {
  const existing = queuesByUser.get(userId);
  if (existing) return existing;
  const queue: DreamAnalysisQueueJob[] = [];
  queuesByUser.set(userId, queue);
  return queue;
}

function addReadyUser(userId: string) {
  if (activeUsers.has(userId) || readyUsers.includes(userId)) return;
  if ((queuesByUser.get(userId)?.length || 0) === 0) return;
  readyUsers.push(userId);
}

async function refreshQueuedMetadata(userId: string): Promise<void> {
  const queue = queuesByUser.get(userId) || [];
  if (queue.length === 0) return;
  await Dream.bulkWrite(queue.map((job, index) => ({
    updateOne: {
      filter: {
        _id: job.dreamId,
        ai_status: 'pending',
        'analysisRun.runId': job.runId,
      },
      update: {
        $set: {
          'analysisMetadata.currentStage': 'queued',
          'analysisMetadata.progress': 0,
          'analysisMetadata.statusMessage': `Đang chờ phân tích · vị trí ${index + 1}`,
          'analysisMetadata.currentMiniStep': 'Tác vụ sẽ tự bắt đầu khi lượt phía trước hoàn tất.',
          'analysisMetadata.queuePosition': index + 1,
          'analysisMetadata.lastProgressAt': new Date(),
        },
      },
    },
  })), { ordered: false });
}

async function markJobRunning(job: DreamAnalysisQueueJob): Promise<boolean> {
  const startedAt = new Date();
  const result = await Dream.updateOne({
    _id: job.dreamId,
    ai_status: 'pending',
    'analysisRun.runId': job.runId,
  }, {
    $set: {
      'analysisMetadata.currentStage': 'preparing',
      'analysisMetadata.progress': 1,
      'analysisMetadata.statusMessage': 'Đã tới lượt · đang bắt đầu phân tích...',
      'analysisMetadata.currentMiniStep': 'Đang cấp tài nguyên cho tác vụ phân tích.',
      'analysisMetadata.queuePosition': 0,
      'analysisMetadata.startedAt': startedAt,
      'analysisMetadata.lastProgressAt': startedAt,
      'analysisRun.startedAt': startedAt,
    },
  });
  return result.matchedCount === 1;
}

function requestSchedule() {
  if (schedulerQueued) return;
  schedulerQueued = true;
  setImmediate(() => {
    schedulerQueued = false;
    scheduleReadyJobs();
  });
}

async function executeJob(job: DreamAnalysisQueueJob) {
  try {
    const ownsRun = await markJobRunning(job);
    if (ownsRun) await job.execute();
  } catch (error) {
    logger.error(`Dream analysis queue could not execute ${runKey(job)}`, error);
  } finally {
    activeJobCount = Math.max(0, activeJobCount - 1);
    activeUsers.delete(job.userId);
    scheduledRunKeys.delete(runKey(job));

    const remaining = queuesByUser.get(job.userId) || [];
    if (remaining.length > 0) {
      addReadyUser(job.userId);
      void refreshQueuedMetadata(job.userId);
    } else {
      queuesByUser.delete(job.userId);
    }
    requestSchedule();
  }
}

function scheduleReadyJobs() {
  const limit = globalConcurrency();
  while (activeJobCount < limit && readyUsers.length > 0) {
    const userId = readyUsers.shift()!;
    if (activeUsers.has(userId)) continue;

    const queue = queuesByUser.get(userId);
    const job = queue?.shift();
    if (!job) {
      queuesByUser.delete(userId);
      continue;
    }

    activeUsers.add(userId);
    activeJobCount += 1;
    void refreshQueuedMetadata(userId);
    void executeJob(job);
  }
}

/**
 * Adds a persisted Dream run to the in-process fair scheduler.
 *
 * Invariants:
 * - At most one analysis from the same user is active.
 * - Users are rotated FIFO, so one account cannot monopolize the next slots.
 * - Global concurrency defaults to one for a local Ollama/GPU process and can
 *   be raised explicitly through DREAM_ANALYSIS_GLOBAL_CONCURRENCY.
 * - A runId can be scheduled only once.
 */
export function enqueueDreamAnalysis(job: DreamAnalysisQueueJob): boolean {
  const key = runKey(job);
  if (scheduledRunKeys.has(key)) return false;

  scheduledRunKeys.add(key);
  userQueue(job.userId).push(job);
  addReadyUser(job.userId);
  void refreshQueuedMetadata(job.userId);
  requestSchedule();
  return true;
}

export function dreamAnalysisQueueSnapshot() {
  return {
    activeJobCount,
    activeUsers: [...activeUsers],
    queuedByUser: [...queuesByUser.entries()].map(([userId, jobs]) => ({
      userId,
      dreamIds: jobs.map(job => job.dreamId),
    })),
  };
}
