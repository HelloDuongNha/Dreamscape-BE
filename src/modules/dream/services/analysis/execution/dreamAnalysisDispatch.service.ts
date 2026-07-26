import type { PreparedDreamReanalysis } from './dreamReanalysisPreparation.service';
import { enqueueDreamAnalysis } from './dreamAnalysisQueue.service';
import { runBackgroundAnalysis } from '../../../controllers/dreamController';

// Queue one prepared reanalysis through the shared per-user scheduler.
export function dispatchPreparedDreamAnalysis(prepared: PreparedDreamReanalysis): void {
  enqueueDreamAnalysis({
    dreamId: String(prepared.dreamId),
    userId: prepared.userId,
    runId: prepared.runId,
    execute: () => runBackgroundAnalysis(
      prepared.dreamId,
      prepared.userId,
      prepared.narrative,
      prepared.sleepContext,
      prepared.runId,
    ),
  });
}
