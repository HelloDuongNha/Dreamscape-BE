import {
  TranslateReaderRequest,
  TranslateReaderResponse,
  TranslatedTargetItem,
  FailedTranslationTarget,
  TranslationServiceDeps,
  TranslationServiceCallParams,
  CanonicalResolutionError,
  AppLocale,
  MT_BATCH_SIZE,
  ProviderTranslationItem,
} from './readerTranslation.types';
import { classifyTarget } from './readerTranslationClassifier.service';
import {
  validateTargetsAgainstChunks,
  checkCanonicalProviderInputLimit,
} from './readerTranslationValidator.service';
import { TranslationProviderUnavailableError } from './readerTranslationProvider.registry';
import { executeTranslationBatches } from './readerTranslationExecution.service';
import {
  buildTranslationResponse,
  makeFailedTranslation,
  makeSuccessfulTranslation,
} from './readerTranslationResponse.service';

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
      response: buildTranslationResponse(request, context, targets, null, null),
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

  const translationResults = await executeTranslationBatches({
    batches,
    eligibleItems,
    provider,
    sourceLanguage: sourceLanguage as AppLocale,
    targetLocale,
    clientSignal,
    deadline,
    deps,
  });

  // ── 12. Assemble translated/failed results for eligible targets
  for (let idx = 0; idx < eligibleIndexes.length; idx++) {
    const originalIndex = eligibleIndexes[idx];
    const item = eligibleItems[idx];
    const target = classifications[originalIndex].target;
    const result = translationResults.get(item.targetId);

    if (!result) {
      resultMap.set(
        originalIndex,
        makeFailedTranslation(target, 'translation_provider_failed')
      );
    } else if ('translated' in result) {
      resultMap.set(originalIndex, makeSuccessfulTranslation(target, result.translated));
    } else {
      resultMap.set(
        originalIndex,
        makeFailedTranslation(target, result.failed as FailedTranslationTarget['providerFailureCode'])
      );
    }
  }

  // ── 13. Assemble final response in request order
  const orderedTargets = request.targets.map((_, i) => resultMap.get(i)!);

  return {
    success: true,
    response: buildTranslationResponse(
      request,
      context,
      orderedTargets,
      providerMeta.name,
      providerMeta.model
    ),
  };
}

function encodeTargetId(target: TranslateReaderRequest['targets'][number]): string {
  if (target.targetType === 'table_cell') {
    return `${target.chunkId}:${target.row}:${target.column}`;
  }
  return target.chunkId;
}
