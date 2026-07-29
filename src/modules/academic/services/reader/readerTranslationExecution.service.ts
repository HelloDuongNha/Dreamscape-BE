import {
  AppLocale,
  MAX_CONCURRENCY,
  MAX_PROVIDER_OUTPUT_BYTES,
  ProviderTranslationItem,
  ReaderTranslationBatchResponse,
  TranslateReaderRequest,
  TranslationServiceDeps,
} from './readerTranslation.types';
import { validateProtectedTokensPreserved } from './readerTranslationProtectedTokens.service';
import { validateProviderOutputObject } from './readerTranslationProviderResponse.validator';

export type TranslationExecutionResult =
  | { translated: string }
  | { failed: string };

interface TranslationExecutionInput {
  batches: ProviderTranslationItem[][];
  eligibleItems: ProviderTranslationItem[];
  provider: ReturnType<TranslationServiceDeps['resolveProvider']>;
  sourceLanguage: AppLocale;
  targetLocale: TranslateReaderRequest['targetLocale'];
  clientSignal?: AbortSignal;
  deadline?: number;
  deps: TranslationServiceDeps;
}

export async function executeTranslationBatches(
  input: TranslationExecutionInput,
): Promise<Map<string, TranslationExecutionResult>> {
  const results = new Map<string, TranslationExecutionResult>();
  let cumulativeOutputBytes = 0;

  for (let batchStart = 0; batchStart < input.batches.length; batchStart += MAX_CONCURRENCY) {
    if (shouldStopExecution(input)) {
      markUnfinishedAsTimedOut(input.eligibleItems, results);
      break;
    }

    const batchSlice = input.batches.slice(batchStart, batchStart + MAX_CONCURRENCY);
    const abortController = input.deps.createAbortController();
    const removeAbortForwarding = forwardClientAbort(input.clientSignal, abortController);
    const timerHandle = createDeadlineTimer(input, abortController);

    try {
      const batchSizes = await Promise.all(batchSlice.map(batch =>
        translateBatch(batch, input, abortController.signal, results),
      ));
      for (let index = 0; index < batchSizes.length; index += 1) {
        const batchBytes = batchSizes[index];
        if (cumulativeOutputBytes + batchBytes > MAX_PROVIDER_OUTPUT_BYTES) {
          markBatchAsFailed(batchSlice[index], results, 'translation_output_too_large');
        } else {
          cumulativeOutputBytes += batchBytes;
        }
      }
    } finally {
      if (timerHandle !== undefined) input.deps.clearTimer(timerHandle);
      removeAbortForwarding();
    }
  }

  return results;
}

async function translateBatch(
  batch: ProviderTranslationItem[],
  input: TranslationExecutionInput,
  signal: AbortSignal,
  results: Map<string, TranslationExecutionResult>,
): Promise<number> {
  try {
    const response = await requestProviderTranslation(batch, input, signal);
    const validation = validateProviderOutputObject(
      response.output,
      new Set(batch.map(item => item.targetId)),
    );
    if (!validation.valid) {
      markBatchAsFailed(batch, results, validation.reason);
      return 0;
    }

    const outputBytes = Buffer.byteLength(JSON.stringify(response.output), 'utf8');
    mapValidatedTranslations(batch, validation.output.items, results);
    return outputBytes;
  } catch (error: any) {
    const code = error?.name === 'AbortError' || error?.code === 'translation_timeout'
      ? 'translation_timeout'
      : 'translation_provider_failed';
    markBatchAsFailed(batch, results, code);
    return 0;
  }
}

async function requestProviderTranslation(
  batch: ProviderTranslationItem[],
  input: TranslationExecutionInput,
  signal: AbortSignal,
): Promise<ReaderTranslationBatchResponse> {
  return input.provider.translateBatch(
    {
      sourceLanguage: input.sourceLanguage,
      targetLocale: input.targetLocale,
      envelope: { items: batch },
    },
    { signal },
  );
}

function mapValidatedTranslations(
  batch: ProviderTranslationItem[],
  translatedItems: Array<{ targetId: string; translatedText: string }>,
  results: Map<string, TranslationExecutionResult>,
): void {
  const sourceTextByTargetId = new Map(batch.map(item => [item.targetId, item.text]));
  for (const item of translatedItems) {
    const tokenCheck = validateProtectedTokensPreserved(
      sourceTextByTargetId.get(item.targetId) || '',
      item.translatedText,
    );
    results.set(
      item.targetId,
      tokenCheck.valid
        ? { translated: item.translatedText }
        : { failed: 'translation_schema_invalid' },
    );
  }
}

function shouldStopExecution(input: TranslationExecutionInput): boolean {
  return Boolean(
    input.clientSignal?.aborted
    || (input.deadline !== undefined && input.deps.now() > input.deadline),
  );
}

function markUnfinishedAsTimedOut(
  items: ProviderTranslationItem[],
  results: Map<string, TranslationExecutionResult>,
): void {
  for (const item of items) {
    if (!results.has(item.targetId)) results.set(item.targetId, { failed: 'translation_timeout' });
  }
}

function markBatchAsFailed(
  batch: ProviderTranslationItem[],
  results: Map<string, TranslationExecutionResult>,
  code: string,
): void {
  for (const item of batch) results.set(item.targetId, { failed: code });
}

function forwardClientAbort(
  clientSignal: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (!clientSignal) return () => undefined;
  const handler = () => controller.abort();
  clientSignal.addEventListener('abort', handler, { once: true });
  return () => clientSignal.removeEventListener('abort', handler);
}

function createDeadlineTimer(
  input: TranslationExecutionInput,
  controller: AbortController,
): ReturnType<typeof setTimeout> | undefined {
  if (input.deadline === undefined) return undefined;
  return input.deps.setTimer(
    () => controller.abort(),
    Math.max(0, input.deadline - input.deps.now()),
  );
}
