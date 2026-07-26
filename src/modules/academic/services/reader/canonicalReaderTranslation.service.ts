/**
 * Phase I18N-3B.2A — Canonical Smart Reader Translation Application Service
 *
 * Orchestrates validation, classification, provider dispatch, and result assembly.
 * All dependencies are injected; no global state is mutated.
 * No database writes. Translation is an ephemeral display overlay produced by
 * a separately registered translation provider when one is available.
 */
import {
  TranslateReaderRequest,
  TranslateReaderResponse,
  TranslatedTargetItem,
  SuccessfulTranslatedTarget,
  FailedTranslationTarget,
  TranslationServiceDeps,
  TranslationServiceCallParams,
  CanonicalResolutionError,
  AppLocale,
  MT_BATCH_SIZE,
  MAX_CONCURRENCY,
  TRANSLATION_SCHEMA_VERSION,
  NORMALIZATION_VERSION,
  ProviderTranslationItem,
  ReaderTranslationBatchResponse,
  MAX_PROVIDER_OUTPUT_BYTES,
} from './readerTranslation.types';
import { classifyTarget } from './readerTranslationClassifier.service';
import {
  validateTargetsAgainstChunks,
  checkCanonicalProviderInputLimit,
} from './readerTranslationValidator.service';
import { validateProviderOutputObject } from './readerTranslationProviderResponse.validator';
import { validateProtectedTokensPreserved } from './readerTranslationProtectedTokens.service';
import { TranslationProviderUnavailableError } from './readerTranslationProvider.registry';

// ─── Error type ───────────────────────────────────────────────────────────────

export interface TranslationServiceError {
  code:
    | 'reader_translation_identity_stale'
    | 'reader_translation_target_invalid'
    | 'reader_translation_limit_exceeded'
    | 'reader_translation_document_unavailable'
    | 'reader_translation_forbidden'
    | 'reader_translation_provider_unavailable'
    | 'reader_block_identity_invalid'
    | 'reader_translation_internal_error';
  httpStatus: 400 | 403 | 404 | 409 | 413 | 503 | 500;
}

type TranslationServiceResult =
  | { success: true; response: TranslateReaderResponse }
  | { success: false; error: TranslationServiceError };

// ─── targetId encoding ────────────────────────────────────────────────────────

function encodeTargetId(target: TranslateReaderRequest['targets'][number]): string {
  if (target.targetType === 'table_cell') {
    return `${target.chunkId}:${target.row}:${target.column}`;
  }
  return target.chunkId;
}

// ─── Main Translation Service ─────────────────────────────────────────────────

export async function translateReaderTargets(
  params: TranslationServiceCallParams,
  deps: TranslationServiceDeps
): Promise<TranslationServiceResult> {
  if (process.env.NODE_ENV === 'test' && (global as any).__mockTranslateReaderTargets) {
    return (global as any).__mockTranslateReaderTargets(params, deps);
  }
  const { routeId, path, request, clientSignal } = params;
  const startTime = deps.now();
  const deadline =
    deps.deadlineMs !== undefined ? startTime + deps.deadlineMs : undefined;

  // ── 1. Resolve canonical context (documentId, sourceLanguage, sourceContentHash)
  //       using the actual routeId and path — never placeholder values
  let context: Awaited<ReturnType<typeof deps.resolveCanonicalContext>>;
  try {
    context = await deps.resolveCanonicalContext(routeId, path);
  } catch (err: any) {
    if (err instanceof CanonicalResolutionError) {
      return {
        success: false,
        error: {
          code: err.code as TranslationServiceError['code'],
          httpStatus: err.httpStatus as TranslationServiceError['httpStatus'],
        },
      };
    }
    return {
      success: false,
      error: { code: 'reader_translation_internal_error', httpStatus: 500 },
    };
  }

  // ── 2. Validate sourceContentHash (full-document hash, not just target chunks)
  if (context.sourceContentHash !== request.sourceContentHash) {
    return {
      success: false,
      error: { code: 'reader_translation_identity_stale', httpStatus: 409 },
    };
  }

  // ── 3. Load target chunks
  const uniqueChunkIds = [...new Set(request.targets.map((t) => t.chunkId))];
  let chunks: Awaited<ReturnType<typeof deps.loadChunks>>;
  try {
    chunks = await deps.loadChunks(context.documentId, uniqueChunkIds);
  } catch {
    return {
      success: false,
      error: { code: 'reader_translation_internal_error', httpStatus: 500 },
    };
  }

  const chunkMap = new Map(chunks.map((c) => [c._id.toString(), c]));

  // ── 4. Target validation against loaded chunks
  const targetValidation = validateTargetsAgainstChunks(
    request.targets,
    chunkMap,
    context.documentId
  );
  if (!targetValidation.valid) {
    return {
      success: false,
      error: { code: 'reader_translation_target_invalid', httpStatus: 400 },
    };
  }

  // ── 5. Classify all targets (priority-ordered)
  const sourceLanguage = context.sourceLanguage;
  const targetLocale = request.targetLocale;

  const classifications = request.targets.map((target) => ({
    target,
    result: classifyTarget(
      target,
      chunkMap.get(target.chunkId)!,
      sourceLanguage,
      targetLocale as AppLocale
    ),
  }));

  // ── 6. Build eligible items list for provider input limit check
  const eligibleItems: ProviderTranslationItem[] = [];
  const eligibleIndexes: number[] = [];

  for (let i = 0; i < classifications.length; i++) {
    const { target, result } = classifications[i];
    if (!result.eligible) continue;

    const chunk = chunkMap.get(target.chunkId)!;
    let text: string;

    if (target.targetType === 'table_cell') {
      const cell = chunk.tableData!.cells.find(
        (c) => c.row === target.row && c.column === target.column
      )!;
      text = cell.text;
    } else {
      text = chunk.text;
    }

    eligibleItems.push({ targetId: encodeTargetId(target), text });
    eligibleIndexes.push(i);
  }

  // ── 7. Check canonical provider-input limit (B) — before resolveProvider
  const inputLimitError = checkCanonicalProviderInputLimit(eligibleItems);
  if (inputLimitError) {
    return {
      success: false,
      error: { code: 'reader_translation_limit_exceeded', httpStatus: 413 },
    };
  }

  // ── 8. Assemble non-translated results
  const resultMap = new Map<number, TranslatedTargetItem>();
  for (let i = 0; i < classifications.length; i++) {
    const { result } = classifications[i];
    if (!result.eligible) {
      resultMap.set(i, result.nonTranslated);
    }
  }

  // ── 9. If no eligible targets, return without resolving provider
  if (eligibleItems.length === 0) {
    const targets = request.targets.map((_, i) => resultMap.get(i)!);
    return {
      success: true,
      response: buildResponse(request, context, targets, null, null),
    };
  }

  // ── 10. Resolve provider (only when eligible targets exist)
  let provider: ReturnType<typeof deps.resolveProvider>;
  try {
    provider = deps.resolveProvider();
  } catch (err: any) {
    if (
      err instanceof TranslationProviderUnavailableError ||
      err?.code === 'reader_translation_provider_unavailable'
    ) {
      return {
        success: false,
        error: { code: 'reader_translation_provider_unavailable', httpStatus: 503 },
      };
    }
    return {
      success: false,
      error: { code: 'reader_translation_internal_error', httpStatus: 500 },
    };
  }

  const providerMeta = provider.getMetadata();

  // ── 11. Batch eligible items and translate (bounded concurrency)
  const batches: ProviderTranslationItem[][] = [];
  for (let i = 0; i < eligibleItems.length; i += MT_BATCH_SIZE) {
    batches.push(eligibleItems.slice(i, i + MT_BATCH_SIZE));
  }

  const translationResults = new Map<string, { translated: string } | { failed: string }>();
  let cumulativeOutputBytes = 0; // cumulative across all batches

  for (let batchStart = 0; batchStart < batches.length; batchStart += MAX_CONCURRENCY) {
    // Abort if client disconnected
    if (clientSignal?.aborted) {
      for (const item of eligibleItems) {
        if (!translationResults.has(item.targetId)) {
          translationResults.set(item.targetId, { failed: 'translation_timeout' });
        }
      }
      break;
    }

    // Abort if past deadline
    if (deadline !== undefined && deps.now() > deadline) {
      for (const item of eligibleItems) {
        if (!translationResults.has(item.targetId)) {
          translationResults.set(item.targetId, { failed: 'translation_timeout' });
        }
      }
      break;
    }

    const batchSlice = batches.slice(batchStart, batchStart + MAX_CONCURRENCY);
    const batchAbortController = deps.createAbortController();

    // Forward client disconnect into provider signal
    const clientAbortHandler = () => batchAbortController.abort();
    if (clientSignal) {
      clientSignal.addEventListener('abort', clientAbortHandler, { once: true });
    }

    let timerHandle: ReturnType<typeof setTimeout> | undefined;
    if (deadline !== undefined) {
      const remaining = Math.max(0, deadline - deps.now());
      timerHandle = deps.setTimer(() => batchAbortController.abort(), remaining);
    }

    try {
      await Promise.all(
        batchSlice.map(async (batch) => {
          const batchTargetIds = new Set(batch.map((i) => i.targetId));
          try {
            let batchResponse: ReaderTranslationBatchResponse;
            try {
              batchResponse = await provider.translateBatch(
                {
                  sourceLanguage: sourceLanguage as AppLocale,
                  targetLocale,
                  envelope: { items: batch },
                },
                { signal: batchAbortController.signal }
              );
            } catch (err: any) {
              const isTimeout =
                err?.name === 'AbortError' || err?.code === 'translation_timeout';
              const code = isTimeout
                ? 'translation_timeout'
                : 'translation_provider_failed';
              for (const item of batch) {
                translationResults.set(item.targetId, { failed: code });
              }
              return;
            }

            // Validate provider output (per-batch schema + HTML check)
            const validation = validateProviderOutputObject(
              batchResponse.output,
              batchTargetIds
            );
            if (!validation.valid) {
              for (const item of batch) {
                translationResults.set(item.targetId, { failed: validation.reason });
              }
              return;
            }

            // Cumulative output size guard across all batches
            const batchOutputJson = JSON.stringify(batchResponse.output);
            const batchBytes = Buffer.byteLength(batchOutputJson, 'utf8');
            if (cumulativeOutputBytes + batchBytes > MAX_PROVIDER_OUTPUT_BYTES) {
              for (const item of batch) {
                translationResults.set(item.targetId, {
                  failed: 'translation_output_too_large',
                });
              }
              return;
            }
            cumulativeOutputBytes += batchBytes;

            // Map results, validate protected tokens
            const sourceTextByTargetId = new Map(
              batch.map((i) => [i.targetId, i.text])
            );
            for (const item of validation.output.items) {
              const sourceText = sourceTextByTargetId.get(item.targetId) ?? '';
              const tokenCheck = validateProtectedTokensPreserved(
                sourceText,
                item.translatedText
              );
              if (!tokenCheck.valid) {
                translationResults.set(item.targetId, {
                  failed: 'translation_schema_invalid',
                });
              } else {
                translationResults.set(item.targetId, {
                  translated: item.translatedText,
                });
              }
            }
          } catch {
            for (const item of batch) {
              if (!translationResults.has(item.targetId)) {
                translationResults.set(item.targetId, {
                  failed: 'translation_provider_failed',
                });
              }
            }
          }
        })
      );
    } finally {
      if (timerHandle !== undefined) deps.clearTimer(timerHandle);
      if (clientSignal) {
        clientSignal.removeEventListener('abort', clientAbortHandler);
      }
    }
  }

  // ── 12. Assemble translated/failed results for eligible targets
  for (let idx = 0; idx < eligibleIndexes.length; idx++) {
    const originalIndex = eligibleIndexes[idx];
    const item = eligibleItems[idx];
    const target = classifications[originalIndex].target;
    const result = translationResults.get(item.targetId);

    if (!result) {
      resultMap.set(
        originalIndex,
        makeFailedTarget(target, 'translation_provider_failed')
      );
    } else if ('translated' in result) {
      resultMap.set(originalIndex, makeSuccessTarget(target, result.translated));
    } else {
      resultMap.set(
        originalIndex,
        makeFailedTarget(target, result.failed as FailedTranslationTarget['providerFailureCode'])
      );
    }
  }

  // ── 13. Assemble final response in request order
  const orderedTargets = request.targets.map((_, i) => resultMap.get(i)!);

  return {
    success: true,
    response: buildResponse(
      request,
      context,
      orderedTargets,
      providerMeta.name,
      providerMeta.model
    ),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSuccessTarget(
  target: TranslateReaderRequest['targets'][number],
  translatedText: string
): SuccessfulTranslatedTarget {
  if (target.targetType === 'table_cell') {
    return {
      targetType: 'table_cell',
      chunkId: target.chunkId,
      row: target.row,
      column: target.column,
      contentHash: target.contentHash,
      status: 'translated',
      translatedText,
    };
  }
  return {
    targetType: target.targetType as 'block_text' | 'figure_caption',
    chunkId: target.chunkId,
    contentHash: target.contentHash,
    status: 'translated',
    translatedText,
  };
}

function makeFailedTarget(
  target: TranslateReaderRequest['targets'][number],
  providerFailureCode: FailedTranslationTarget['providerFailureCode']
): FailedTranslationTarget {
  if (target.targetType === 'table_cell') {
    return {
      targetType: 'table_cell',
      chunkId: target.chunkId,
      row: target.row,
      column: target.column,
      contentHash: target.contentHash,
      status: 'provider_failed',
      providerFailureCode,
    };
  }
  return {
    targetType: target.targetType as 'block_text' | 'figure_caption',
    chunkId: target.chunkId,
    contentHash: target.contentHash,
    status: 'provider_failed',
    providerFailureCode,
  };
}

function buildResponse(
  request: TranslateReaderRequest,
  context: { sourceContentHash: string; sourceLanguage: string | null },
  targets: TranslatedTargetItem[],
  engineName: string | null,
  modelName: string | null
): TranslateReaderResponse {
  return {
    sourceContentHash: context.sourceContentHash,
    sourceLanguage: context.sourceLanguage,
    targetLocale: request.targetLocale,
    engineName,
    modelName,
    normalizationVersion: NORMALIZATION_VERSION,
    translationSchemaVersion: TRANSLATION_SCHEMA_VERSION,
    targets,
  };
}
