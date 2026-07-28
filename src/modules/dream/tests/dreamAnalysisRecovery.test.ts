import assert from 'node:assert/strict';
import test from 'node:test';

import {
  orderPendingDreamJobs,
} from '../services/analysis/execution/dreamAnalysisRecovery.service';

test('recovered Dream jobs keep their persisted enqueue order across job types', () => {
  const jobs = orderPendingDreamJobs([
    {
      _id: 'analysis-dream',
      userId: 'user-1',
      ai_status: 'pending',
      analysisRun: {
        runId: 'analysis-run',
        startedAt: new Date('2026-07-28T10:05:00.000Z'),
      },
      analysisMetadata: {
        enqueuedAt: new Date('2026-07-28T10:03:00.000Z'),
      },
    },
    {
      _id: 'continuation-dream',
      userId: 'user-1',
      continuationMetadata: {
        runId: 'continuation-run',
        status: 'queued',
        enqueuedAt: new Date('2026-07-28T10:01:00.000Z'),
      },
    },
  ]);

  assert.deepEqual(
    jobs.map((job) => `${job.type}:${job.runId}`),
    ['continuation:continuation-run', 'analysis:analysis-run'],
  );
});
