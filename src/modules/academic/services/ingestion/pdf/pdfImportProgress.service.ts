import AcademicSource from '../../../models/AcademicSource';
import SourceContribution from '../../../models/SourceContribution';

export type PdfImportStage =
  | 'received'
  | 'inspecting_text'
  | 'ocr_processing'
  | 'parsing_layout'
  | 'cleaning_ocr'
  | 'compiling_reader'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface PdfImportTimingSample {
  durationMs: number;
  estimatedDurationSeconds: number;
  pageCount: number;
  fileSizeBytes: number;
  ocrUsed: boolean;
  succeeded?: boolean;
  completedAt: Date;
}

export interface PdfImportProgressState {
  stage: PdfImportStage;
  startedAt: Date;
  updatedAt: Date;
  expectedDurationSeconds: number;
  pageCount: number;
  fileSizeBytes: number;
  ocrExpected: boolean;
  completedAt?: Date;
  durationMs?: number;
  timingDeltaSeconds?: number;
  failureCode?: string;
  failureMessage?: string;
}

type TargetType = 'contribution' | 'approved_source';

function modelFor(targetType: TargetType): any {
  return targetType === 'contribution' ? SourceContribution : AcademicSource;
}

function finitePositive(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Estimate a Docling build from stable input features and prior builds.
 *
 * The heuristic intentionally remains conservative on a first run. Once the
 * same document has completed at least once, observed seconds per page carry
 * 75% of the estimate so rebuilds converge quickly without pretending that an
 * ETA is a hard deadline.
 */
export function estimatePdfImportSeconds(input: {
  pageCount?: number | null;
  fileSizeBytes?: number | null;
  ocrExpected: boolean;
  history?: PdfImportTimingSample[];
}): number {
  const fileSizeBytes = finitePositive(input.fileSizeBytes) || 0;
  const fileMegabytes = fileSizeBytes / (1024 * 1024);
  const estimatedPagesFromFile = Math.max(1, Math.round(fileSizeBytes / (280 * 1024)));
  const pageCount = Math.max(1, Math.round(finitePositive(input.pageCount) || estimatedPagesFromFile));
  const setupSeconds = input.ocrExpected ? 40 : 18;
  // EasyOCR on a CPU-bound Vietnamese scan is substantially slower than
  // Docling's text-layer path. This default is calibrated from real scanned
  // pages; deployments with a GPU can override it and successful local runs
  // will still become the dominant estimate through the history weighting.
  const configuredOcrSecondsPerPage = finitePositive(process.env.PDF_OCR_ESTIMATED_SECONDS_PER_PAGE);
  const secondsPerPage = input.ocrExpected ? (configuredOcrSecondsPerPage || 7.5) : 0.62;
  const sizePenaltySeconds = Math.min(180, fileMegabytes * (input.ocrExpected ? 0.75 : 0.28));
  const heuristic = setupSeconds + pageCount * secondsPerPage + sizePenaltySeconds;

  const comparable = (input.history || [])
    .filter((sample) =>
      sample.succeeded === true &&
      sample.ocrUsed === input.ocrExpected &&
      finitePositive(sample.durationMs) &&
      finitePositive(sample.pageCount)
    )
    .slice(-8);
  const historicalSecondsPerPage = median(comparable.map((sample) =>
    Math.max(0.05, (sample.durationMs / 1000 - setupSeconds) / Math.max(1, sample.pageCount))
  ));

  const estimate = historicalSecondsPerPage === null
    ? heuristic
    : heuristic * 0.25 + (setupSeconds + historicalSecondsPerPage * pageCount + sizePenaltySeconds) * 0.75;
  return Math.max(20, Math.min(4 * 60 * 60, Math.round(estimate)));
}

export async function getPdfImportProgress(
  targetType: TargetType,
  targetId: string,
): Promise<{ progress: PdfImportProgressState | null; history: PdfImportTimingSample[]; estimateSeconds: number }> {
  const target = await modelFor(targetType)
    .findById(targetId)
    .select('pdfImportProgress pdfImportHistory pdfPageCount extractionMethod originalFile.fileSize')
    .lean();
  if (!target) throw new Error('Không tìm thấy tài liệu.');

  const history = Array.isArray(target.pdfImportHistory) ? target.pdfImportHistory : [];
  const ocrExpected = target.pdfImportProgress?.ocrExpected ??
    (target.extractionMethod === 'ocr' || history[history.length - 1]?.ocrUsed === true);
  const estimateSeconds = target.pdfImportProgress?.expectedDurationSeconds || estimatePdfImportSeconds({
    pageCount: target.pdfImportProgress?.pageCount || target.pdfPageCount,
    fileSizeBytes: target.pdfImportProgress?.fileSizeBytes || target.originalFile?.fileSize,
    ocrExpected,
    history,
  });
  return {
    progress: target.pdfImportProgress || null,
    history,
    estimateSeconds,
  };
}

export async function startPdfImportProgress(
  targetType: TargetType,
  targetId: string,
): Promise<PdfImportProgressState> {
  const model = modelFor(targetType);
  const target = await model
    .findById(targetId)
    .select('pdfImportHistory pdfPageCount extractionMethod originalFile.fileSize')
    .lean();
  if (!target) throw new Error('Không tìm thấy tài liệu.');

  const history = Array.isArray(target.pdfImportHistory) ? target.pdfImportHistory : [];
  const ocrExpected = target.extractionMethod === 'ocr' ||
    history[history.length - 1]?.ocrUsed === true;
  const pageCount = Math.max(0, Number(target.pdfPageCount) || 0);
  const fileSizeBytes = Math.max(0, Number(target.originalFile?.fileSize) || 0);
  const expectedDurationSeconds = estimatePdfImportSeconds({
    pageCount,
    fileSizeBytes,
    ocrExpected,
    history,
  });
  const now = new Date();
  const progress: PdfImportProgressState = {
    stage: 'received',
    startedAt: now,
    updatedAt: now,
    expectedDurationSeconds,
    pageCount,
    fileSizeBytes,
    ocrExpected,
  };
  await model.updateOne({ _id: targetId }, { $set: { pdfImportProgress: progress } });
  return progress;
}

export async function updatePdfImportProgress(
  targetType: TargetType,
  targetId: string,
  stage: PdfImportStage,
  patch: Partial<Pick<PdfImportProgressState, 'pageCount' | 'ocrExpected' | 'expectedDurationSeconds'>> = {},
): Promise<void> {
  const set: Record<string, unknown> = {
    'pdfImportProgress.stage': stage,
    'pdfImportProgress.updatedAt': new Date(),
  };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) set[`pdfImportProgress.${key}`] = value;
  }
  await modelFor(targetType).updateOne({ _id: targetId }, { $set: set });
}

export async function finishPdfImportProgress(
  targetType: TargetType,
  targetId: string,
  input: {
    succeeded: boolean;
    pageCount: number;
    ocrUsed: boolean;
    failureCode?: string;
    failureMessage?: string;
  },
): Promise<PdfImportProgressState | null> {
  const model = modelFor(targetType);
  const target = await model
    .findById(targetId)
    .select('pdfImportProgress originalFile.fileSize')
    .lean();
  if (!target?.pdfImportProgress?.startedAt) return null;

  const completedAt = new Date();
  const durationMs = Math.max(0, completedAt.getTime() - new Date(target.pdfImportProgress.startedAt).getTime());
  const estimatedDurationSeconds = Math.max(1, Number(target.pdfImportProgress.expectedDurationSeconds) || 1);
  const timingDeltaSeconds = Math.round(durationMs / 1000 - estimatedDurationSeconds);
  const state: PdfImportProgressState = {
    ...target.pdfImportProgress,
    stage: input.succeeded ? 'completed' : 'failed',
    updatedAt: completedAt,
    completedAt,
    durationMs,
    timingDeltaSeconds,
    pageCount: Math.max(0, input.pageCount || target.pdfImportProgress.pageCount || 0),
    ocrExpected: input.ocrUsed,
    failureCode: input.succeeded ? undefined : input.failureCode,
    failureMessage: input.succeeded ? undefined : input.failureMessage,
  };
  const sample: PdfImportTimingSample = {
    durationMs,
    estimatedDurationSeconds,
    pageCount: state.pageCount,
    fileSizeBytes: Number(target.originalFile?.fileSize) || state.fileSizeBytes || 0,
    ocrUsed: input.ocrUsed,
    succeeded: input.succeeded,
    completedAt,
  };

  const update: Record<string, unknown> = {
    $set: { pdfImportProgress: state },
  };
  // Failed startup/model checks are not processing-speed samples. Recording
  // them polluted later OCR estimates for the same book with unrealistically
  // short durations.
  if (input.succeeded) {
    update.$push = { pdfImportHistory: { $each: [sample], $slice: -20 } };
  }
  await model.updateOne(
    { _id: targetId },
    update,
  );
  return state;
}

export async function cancelPdfImportProgress(
  targetType: TargetType,
  targetId: string,
): Promise<void> {
  const now = new Date();
  const target = await modelFor(targetType).findById(targetId).select('pdfImportProgress').lean();
  if (!target?.pdfImportProgress || ['completed', 'failed', 'cancelled'].includes(target.pdfImportProgress.stage)) return;
  const startedAt = new Date(target.pdfImportProgress.startedAt);
  await modelFor(targetType).updateOne(
    { _id: targetId },
    {
      $set: {
        'pdfImportProgress.stage': 'cancelled',
        'pdfImportProgress.updatedAt': now,
        'pdfImportProgress.completedAt': now,
        'pdfImportProgress.durationMs': Math.max(0, now.getTime() - startedAt.getTime()),
      },
    },
  );
}
