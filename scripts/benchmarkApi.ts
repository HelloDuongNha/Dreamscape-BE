interface BenchmarkResult {
  url: string;
  virtualUsers: number;
  requestCount: number;
  successCount: number;
  errorCount: number;
  errorRate: number;
  throughputPerSecond: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  maximumMs: number;
}

async function main(): Promise<void> {
  const url = process.env.BENCHMARK_URL?.trim();
  if (!url) throw new Error('BENCHMARK_URL is required.');
  const requestCount = positiveInteger(process.env.BENCHMARK_REQUESTS, 20);
  const virtualUsers = Math.min(
    requestCount,
    positiveInteger(process.env.BENCHMARK_VUS, 1),
  );
  const token = process.env.BENCHMARK_TOKEN?.trim();
  const durations: number[] = [];
  let successCount = 0;
  let errorCount = 0;
  let nextRequest = 0;
  const startedAt = performance.now();

  await Promise.all(Array.from({ length: virtualUsers }, async () => {
    while (true) {
      const requestIndex = nextRequest;
      nextRequest += 1;
      if (requestIndex >= requestCount) return;
      const requestStartedAt = performance.now();
      try {
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          signal: AbortSignal.timeout(30_000),
        });
        await response.arrayBuffer();
        if (response.ok) successCount += 1;
        else errorCount += 1;
      } catch {
        errorCount += 1;
      } finally {
        durations.push(performance.now() - requestStartedAt);
      }
    }
  }));

  const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1000);
  durations.sort((left, right) => left - right);
  const result: BenchmarkResult = {
    url,
    virtualUsers,
    requestCount,
    successCount,
    errorCount,
    errorRate: errorCount / requestCount,
    throughputPerSecond: requestCount / elapsedSeconds,
    p50Ms: percentile(durations, 0.5),
    p90Ms: percentile(durations, 0.9),
    p95Ms: percentile(durations, 0.95),
    maximumMs: durations[durations.length - 1] || 0,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (errorCount > 0) process.exitCode = 1;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function percentile(sorted: number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil(sorted.length * quantile) - 1;
  return Math.round(sorted[Math.max(0, index)] * 100) / 100;
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
