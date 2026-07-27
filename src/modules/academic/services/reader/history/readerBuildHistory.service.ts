import AcademicSource from '../../../models/AcademicSource';
import SourceContribution from '../../../models/SourceContribution';

export interface ReaderBuildSnapshotInput {
  sourceId: unknown;
  isContribution: boolean;
  status?: 'success' | 'failed';
  engine: string;
  sourceType: string;
  sectionCount: number;
  chunkCount: number;
  failureCode?: string;
  failureMessage?: string;
  timing?: {
    startedAt?: number;
    estimatedDurationSeconds?: number;
    pageCount?: number;
    ocrUsed?: boolean;
  };
}

async function appendReaderBuildSnapshot(input: ReaderBuildSnapshotInput): Promise<void> {
  const builtAt = new Date();
  const durationMs = Number.isFinite(input.timing?.startedAt)
    ? Math.max(0, builtAt.getTime() - Number(input.timing?.startedAt))
    : undefined;
  const snapshot = {
    status: input.status || 'success',
    engine: input.engine,
    sourceType: input.sourceType,
    sectionCount: input.sectionCount,
    chunkCount: input.chunkCount,
    builtAt,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(input.timing?.estimatedDurationSeconds
      ? { estimatedDurationSeconds: input.timing.estimatedDurationSeconds }
      : {}),
    ...(input.timing?.pageCount !== undefined ? { pageCount: input.timing.pageCount } : {}),
    ...(input.timing?.ocrUsed !== undefined ? { ocrUsed: input.timing.ocrUsed } : {}),
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    ...(input.failureMessage ? { failureMessage: input.failureMessage } : {}),
  };
  const update = {
    $push: {
      readerBuildSnapshots: {
        $each: [snapshot],
        $slice: -20,
      },
    },
  } as any;

  if (input.isContribution) {
    await SourceContribution.updateOne({ _id: input.sourceId } as any, update);
    return;
  }
  await AcademicSource.updateOne({ _id: input.sourceId } as any, update);
}

export async function recordReaderBuildSnapshot(input: ReaderBuildSnapshotInput): Promise<void> {
  await appendReaderBuildSnapshot({ ...input, status: 'success' });
}

export async function recordReaderBuildFailure(
  input: Omit<ReaderBuildSnapshotInput, 'status' | 'sectionCount' | 'chunkCount'>,
): Promise<void> {
  await appendReaderBuildSnapshot({
    ...input,
    status: 'failed',
    sectionCount: 0,
    chunkCount: 0,
  });
}
