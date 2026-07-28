import { Types } from 'mongoose';
import OracleRun, { type IOracleRun } from '../../models/OracleRun';
import type { OracleExecutionMode } from '../providers/oraclePrompt.service';

export interface OracleRunWorkload {
  inputChars: number;
  contextChars: number;
  retrievalChars: number;
  citationCount: number;
}

type OracleRunHistorySample = Pick<
  IOracleRun,
  | 'durationMs'
  | 'createdAt'
  | 'completedAt'
  | 'inputChars'
  | 'contextChars'
  | 'retrievalChars'
  | 'citationCount'
>;

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

export async function estimateOracleRunDuration(
  userId: Types.ObjectId,
  mode: OracleExecutionMode,
  modelName: string,
  workload: OracleRunWorkload,
): Promise<{ minMs: number; maxMs: number }> {
  const history = await OracleRun.find({
    userId,
    status: 'completed',
    completedAt: { $exists: true },
    mode,
    modelName,
  })
    .sort({ completedAt: -1 })
    .limit(30)
    .select('durationMs createdAt completedAt inputChars contextChars retrievalChars citationCount')
    .lean();
  const nearestRuns = history
    .sort((left, right) => runDistance(left, workload) - runDistance(right, workload))
    .slice(0, 16);
  const samples = nearestRuns
    .map((run) => scaleObservedDuration(run, workload))
    .filter((value) => Number.isFinite(value) && value >= 1_000 && value <= 30 * 60_000);

  if (samples.length >= 3) return estimateFromHistory(samples);
  if (samples.length) {
    const observed = percentile(samples, 0.5);
    return {
      minMs: Math.max(5_000, Math.round(observed * 0.72)),
      maxMs: Math.max(15_000, Math.round(observed * 1.02)),
    };
  }
  const fallback = mode === 'chat' ? 90_000 : mode === 'creative_continuation' ? 300_000 : 420_000;
  return { minMs: Math.round(fallback * 0.7), maxMs: fallback };
}

function runDistance(
  run: OracleRunHistorySample,
  workload: OracleRunWorkload,
): number {
  const inputDistance = Math.abs(Math.log(
    (Number(run.inputChars) + 400) / (workload.inputChars + 400),
  ));
  const contextDistance = Number(run.contextChars) > 0
    ? Math.abs(Math.log((Number(run.contextChars) + 2_000) / (workload.contextChars + 2_000)))
    : 0;
  const retrievalDistance = Number(run.retrievalChars) > 0
    ? Math.abs(Math.log((Number(run.retrievalChars) + 1_000) / (workload.retrievalChars + 1_000)))
    : 0;
  const citationDistance = Number(run.citationCount) > 0
    ? Math.abs(Math.log((Number(run.citationCount) + 1) / (workload.citationCount + 1)))
    : 0;
  return inputDistance + contextDistance * 0.55 + retrievalDistance * 0.35 + citationDistance * 0.15;
}

function scaleObservedDuration(
  run: OracleRunHistorySample,
  workload: OracleRunWorkload,
): number {
  const duration = Number(run.durationMs)
    || (run.completedAt
      ? new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime()
      : 0);
  const inputScale = Math.pow(
    (workload.inputChars + 400) / (Number(run.inputChars) + 400),
    0.32,
  );
  const contextScale = Number(run.contextChars) > 0
    ? Math.pow((workload.contextChars + 2_000) / (Number(run.contextChars) + 2_000), 0.24)
    : 1;
  const retrievalScale = Number(run.retrievalChars) > 0
    ? Math.pow((workload.retrievalChars + 1_000) / (Number(run.retrievalChars) + 1_000), 0.16)
    : 1;
  const citationScale = Number(run.citationCount) > 0
    ? Math.pow((workload.citationCount + 1) / (Number(run.citationCount) + 1), 0.08)
    : 1;
  const totalScale = Math.max(
    0.65,
    Math.min(1.65, inputScale * contextScale * retrievalScale * citationScale),
  );
  return duration * totalScale;
}

function estimateFromHistory(samples: number[]): { minMs: number; maxMs: number } {
  const median = percentile(samples, 0.5);
  const deviations = samples.map((value) => Math.abs(value - median));
  const medianDeviation = percentile(deviations, 0.5);
  const robustSamples = medianDeviation > 0
    ? samples.filter((value) => Math.abs(value - median) <= medianDeviation * 3.5)
    : samples;
  const robustMedian = percentile(robustSamples, 0.5) || median;
  const robustDeviation = percentile(
    robustSamples.map((value) => Math.abs(value - robustMedian)),
    0.5,
  );
  const estimate = robustMedian + Math.min(robustMedian * 0.08, robustDeviation * 0.25);
  return {
    minMs: Math.max(5_000, Math.round(robustMedian * 0.72)),
    maxMs: Math.max(15_000, Math.round(estimate)),
  };
}
