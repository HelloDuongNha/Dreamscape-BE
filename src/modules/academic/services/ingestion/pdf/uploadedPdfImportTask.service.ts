import type { UploadedPdfImportInput } from '../../../dto/uploadedPdfImport.dto';
import { cancelPdfImportProgress } from './pdfImportProgress.service';
import {
  requestReaderReplacementCancellation,
  waitForReaderReplacementTerminal,
} from '../../reader/persistence/readerReplacement.service';

const activeControllers = new Map<string, AbortController>();
const activeTasks = new Map<string, Promise<void>>();
const CANCELLATION_SETTLE_TIMEOUT_MS = 15 * 60 * 1000;

function importKey(targetType: UploadedPdfImportInput['targetType'], targetId: string): string {
  return `${targetType}:${targetId}`;
}

async function waitForActiveTask(task: Promise<void>): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('reader_replacement_cancellation_timeout')),
          CANCELLATION_SETTLE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function registerUploadedPdfImport(
  targetType: UploadedPdfImportInput['targetType'],
  targetId: string,
) {
  const key = importKey(targetType, targetId);
  activeControllers.get(key)?.abort();
  const abortController = new AbortController();
  activeControllers.set(key, abortController);

  let resolveFinished: (() => void) | undefined;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  activeTasks.set(key, finished);

  return {
    abortController,
    throwIfCancelled() {
      if (!abortController.signal.aborted) return;
      const error = new Error('pdf_import_cancelled');
      error.name = 'AbortError';
      throw error;
    },
    finish() {
      resolveFinished?.();
      if (activeTasks.get(key) === finished) activeTasks.delete(key);
      if (activeControllers.get(key) === abortController) activeControllers.delete(key);
    },
  };
}

export async function cancelRegisteredPdfImport(
  targetType: UploadedPdfImportInput['targetType'],
  targetId: string,
): Promise<boolean> {
  const key = importKey(targetType, targetId);
  const controller = activeControllers.get(key);
  const activeTask = activeTasks.get(key);
  controller?.abort();
  const durableCancellation = await requestReaderReplacementCancellation(targetType, targetId);
  if (!controller && !activeTask && !durableCancellation) return false;

  if (activeTask) await waitForActiveTask(activeTask);
  const terminalStatus = await waitForReaderReplacementTerminal(
    targetType,
    targetId,
    CANCELLATION_SETTLE_TIMEOUT_MS,
  );
  if (terminalStatus !== 'cancelled' && terminalStatus !== 'failed') return false;
  await cancelPdfImportProgress(targetType, targetId);
  return true;
}
