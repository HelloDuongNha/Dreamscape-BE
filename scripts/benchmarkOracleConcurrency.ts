import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

interface RunStatus {
  runId: string;
  status: string;
  expectedMinMs: number | null;
  expectedMaxMs: number | null;
  errorCode: string | null;
}

interface MeasuredRun {
  request: number;
  runId: string;
  status: string;
  totalMs: number;
  expectedMinMs: number | null;
  expectedMaxMs: number | null;
  errorCode: string | null;
}

const apiBase = (process.env.ORACLE_BENCHMARK_URL
  || 'https://dreamscape-backend-d2an.onrender.com/api').replace(/\/+$/, '');
const token = process.env.ORACLE_BENCHMARK_TOKEN?.trim();
const modelLabel = process.env.ORACLE_BENCHMARK_MODEL?.trim();
const prompt = process.env.ORACLE_BENCHMARK_PROMPT?.trim()
  || 'Explain one possible meaning of dreaming about missing a train. Keep the answer short.';
const timeoutMs = positiveInteger(process.env.ORACLE_BENCHMARK_TIMEOUT_MS, 600_000);
const pollMs = positiveInteger(process.env.ORACLE_BENCHMARK_POLL_MS, 2_000);
const outputPath = resolve(
  process.env.ORACLE_BENCHMARK_OUTPUT
  || '../docs/evidence/chapter6/oracle-concurrency-evidence.json',
);

async function main(): Promise<void> {
  if (!token) throw new Error('ORACLE_BENCHMARK_TOKEN is required.');
  if (!modelLabel) throw new Error('ORACLE_BENCHMARK_MODEL is required as an evidence label.');

  const workloadId = createHash('sha256').update(prompt).digest('hex').slice(0, 12);
  const warmup = await runOne(0, 'warmup');
  if (warmup.status !== 'completed') {
    throw new Error(
      `Warm-up failed: ${JSON.stringify({
        runId: warmup.runId,
        status: warmup.status,
        errorCode: warmup.errorCode,
        totalMs: warmup.totalMs,
        expectedMinMs: warmup.expectedMinMs,
        expectedMaxMs: warmup.expectedMaxMs,
      })}`,
    );
  }

  const results = [];
  for (const concurrency of [1, 2]) {
    const startedAt = performance.now();
    const runs = await Promise.all(
      Array.from({ length: concurrency }, (_, index) =>
        runOne(index + 1, `c${concurrency}`),
      ),
    );
    results.push({
      concurrency,
      requestCount: concurrency,
      completedCount: runs.filter(run => run.status === 'completed').length,
      failedCount: runs.filter(run => run.status !== 'completed').length,
      batchDurationMs: round(performance.now() - startedAt),
      p50CompletionMs: percentile(runs.map(run => run.totalMs), 0.5),
      p95CompletionMs: percentile(runs.map(run => run.totalMs), 0.95),
      runs,
    });
  }

  const evidence = {
    evidence: 'Figure C.17 - Remote AI-worker Concurrency',
    measuredAt: new Date().toISOString(),
    apiBase,
    environment: 'Remote T4 AI worker through the deployed DreamScape API',
    model: modelLabel,
    workloadId,
    promptChars: prompt.length,
    warmup: {
      status: warmup.status,
      totalMs: warmup.totalMs,
    },
    queueIncludedInCompletionTime: true,
    results,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ...evidence, output: outputPath }, null, 2)}\n`);

  if (results.some(result => result.failedCount > 0)) process.exitCode = 1;
}

async function runOne(request: number, phase: string): Promise<MeasuredRun> {
  const thread = await requestJson('/oracle/threads', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'chat',
      title: `Report ${phase} ${request}`,
    }),
  });
  const threadId = String(thread.data?._id || thread.data?.id || '');
  if (!threadId) throw new Error('Oracle thread response did not contain an ID.');

  const startedAt = performance.now();
  const submission = await requestJson(`/oracle/threads/${threadId}/turns`, {
    method: 'POST',
    body: JSON.stringify({
      clientRequestId: `report-${phase}-${request}-${randomUUID()}`,
      content: prompt,
    }),
  });
  const runId = String(submission.data?.runId || '');
  if (!runId) throw new Error('Oracle turn response did not contain a run ID.');

  const finalStatus = await waitForRun(runId);
  return {
    request,
    runId,
    status: finalStatus.status,
    totalMs: round(performance.now() - startedAt),
    expectedMinMs: finalStatus.expectedMinMs,
    expectedMaxMs: finalStatus.expectedMaxMs,
    errorCode: finalStatus.errorCode,
  };
}

async function waitForRun(runId: string): Promise<RunStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await requestJson(`/oracle/runs/${runId}`);
    const data = response.data as RunStatus;
    if (['completed', 'failed', 'cancelled'].includes(data.status)) return data;
    await delay(pollMs);
  }
  throw new Error(`Oracle run ${runId} exceeded ${timeoutMs} ms.`);
}

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as Record<string, any>;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return round(sorted[index]);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
