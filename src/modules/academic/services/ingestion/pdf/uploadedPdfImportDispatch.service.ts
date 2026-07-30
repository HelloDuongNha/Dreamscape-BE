import type {
  UploadedPdfImportInput,
  UploadedPdfImportResult,
} from '../../../dto/uploadedPdfImport.dto';
import { hasStoredOriginalPdf } from '../../storage/originalPdfStorage.service';
import {
  cancelPdfImportProgress,
  queuePdfImportProgress,
  recordPdfImportTerminalResult,
  updatePdfImportProgress,
} from './pdfImportProgress.service';
import {
  cancelUploadedPdfImport,
  runUploadedPdfImport,
} from './uploadedPdfImport.service';
import { requireUploadedPdfTarget } from './uploadedPdfTarget.service';

interface QueuedPdfImport {
  key: string;
  input: UploadedPdfImportInput;
}

const knownKeys = new Set<string>();
const cancellationRequests = new Set<string>();
const queue: QueuedPdfImport[] = [];
let runningKey: string | null = null;

export interface PdfImportDispatchResult {
  accepted: boolean;
  reused: boolean;
}

export async function dispatchUploadedPdfImport(
  input: UploadedPdfImportInput,
): Promise<PdfImportDispatchResult> {
  const key = dispatchKey(input);
  if (knownKeys.has(key)) return { accepted: true, reused: true };

  const target = await requireUploadedPdfTarget(input.targetType, input.targetId);
  if (!target.originalFile || !hasStoredOriginalPdf(target.originalFile)) {
    throw new Error('Tài liệu không có tệp PDF gốc được tải lên.');
  }

  knownKeys.add(key);
  queue.push({ key, input });
  try {
    const claimed = await queuePdfImportProgress(input.targetType, input.targetId, queue.length);
    if (!claimed) {
      const queuedIndex = queue.findIndex(job => job.key === key);
      if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
      knownKeys.delete(key);
      await refreshQueuePositions();
      return { accepted: true, reused: true };
    }
  } catch (error) {
    const index = queue.findIndex(job => job.key === key);
    if (index >= 0) queue.splice(index, 1);
    knownKeys.delete(key);
    throw error;
  }
  void drainQueue();
  return { accepted: true, reused: false };
}

export async function cancelDispatchedPdfImport(
  targetType: UploadedPdfImportInput['targetType'],
  targetId: string,
): Promise<boolean> {
  const key = dispatchKey({ targetType, targetId });
  const queuedIndex = queue.findIndex(job => job.key === key);
  if (queuedIndex >= 0) {
    queue.splice(queuedIndex, 1);
    knownKeys.delete(key);
    await cancelPdfImportProgress(targetType, targetId);
    await recordPdfImportTerminalResult(targetType, targetId, cancelledResult());
    await refreshQueuePositions();
    return true;
  }
  if (runningKey !== key) return false;
  cancellationRequests.add(key);
  void cancelRunningImportWhenRegistered(targetType, targetId, key);
  return true;
}

async function drainQueue(): Promise<void> {
  if (runningKey) return;
  const job = queue.shift();
  if (!job) return;
  runningKey = job.key;
  try {
    await refreshQueuePositions();
    await executeDispatchedImport(job.input);
  } finally {
    cancellationRequests.delete(job.key);
    knownKeys.delete(job.key);
    runningKey = null;
    void drainQueue();
  }
}

async function cancelRunningImportWhenRegistered(
  targetType: UploadedPdfImportInput['targetType'],
  targetId: string,
  key: string,
): Promise<void> {
  for (let attempt = 0; attempt < 40 && cancellationRequests.has(key); attempt += 1) {
    if (await cancelUploadedPdfImport(targetType, targetId)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function refreshQueuePositions(): Promise<void> {
  await Promise.all(queue.map((job, index) => updatePdfImportProgress(
    job.input.targetType,
    job.input.targetId,
    'queued',
    { queuePosition: index + 1 },
  )));
}

async function executeDispatchedImport(input: UploadedPdfImportInput): Promise<void> {
  try {
    const result = await runUploadedPdfImport(input);
    await recordPdfImportTerminalResult(input.targetType, input.targetId, toTerminalResult(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPdfImportTerminalResult(input.targetType, input.targetId, {
      success: false,
      readerCreated: false,
      requiresOcr: false,
      selectedSource: 'none',
      metadataEnriched: false,
      message,
    }).catch(() => {});
    console.error('[PDF Import Dispatch] Background import failed:', message);
  }
}

function toTerminalResult(result: UploadedPdfImportResult) {
  return {
    success: result.success,
    cancelled: result.cancelled,
    readerCreated: result.readerCreated,
    requiresOcr: result.requiresOcr,
    selectedSource: result.selectedSource,
    metadataEnriched: result.metadataEnriched,
    resolvedTitle: result.resolvedTitle,
    detectedIdentifiers: result.detectedIdentifiers,
    message: result.message,
  };
}

function dispatchKey(input: UploadedPdfImportInput): string {
  return `${input.targetType}:${input.targetId}`;
}

function cancelledResult() {
  return {
    success: false,
    cancelled: true,
    readerCreated: false,
    requiresOcr: false,
    selectedSource: 'none' as const,
    metadataEnriched: false,
    message: 'Đã hủy nhập PDF khi tác vụ còn trong hàng chờ.',
  };
}
