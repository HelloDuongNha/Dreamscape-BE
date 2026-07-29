import type { Request, Response } from 'express';
import { getTranslationDeadlineMs } from '../../../config/translationConfig';
import { parseApprovedSourceId } from '../dto/approvedSource.dto';
import { translateReaderTargets } from '../services/reader/canonicalReaderTranslation.service';
import { resolveApprovedSourceContext, loadTranslationChunks } from '../services/reader/readerTranslationContext.service';
import { resolveTranslationProvider } from '../services/reader/readerTranslationProvider.registry';
import type { TranslationServiceDeps } from '../services/reader/readerTranslation.types';
import {
  checkHttpBodyLimit,
  validateRequestShape,
} from '../services/reader/readerTranslationValidator.service';

function translationErrorMessage(code: string): string {
  if (code === 'reader_translation_identity_stale') {
    return 'The source content has changed. Please refresh and retry.';
  }
  if (code === 'reader_translation_provider_unavailable') {
    return 'Translation provider is not available.';
  }
  if (code === 'reader_translation_limit_exceeded') return 'Request exceeds size limit.';
  if (code === 'reader_translation_forbidden') return 'Access denied.';
  if (code === 'reader_translation_document_unavailable') return 'Source not found.';
  return 'Invalid translation request.';
}

export async function getApprovedSourceTranslation(req: Request, res: Response): Promise<void> {
  try {
    const id = parseApprovedSourceId(req.params.id);
    if (!id) {
      res.status(404).json({
        success: false,
        code: 'reader_translation_document_unavailable',
        message: 'Source not found.',
      });
      return;
    }

    const bodyLimitError = checkHttpBodyLimit(req.rawBodyLength ?? 0);
    if (bodyLimitError) {
      res.status(413).json({
        success: false,
        code: bodyLimitError.code,
        message: 'Request too large.',
      });
      return;
    }

    const parseResult = validateRequestShape(req.body);
    if (!parseResult.valid) {
      res.status(parseResult.error.httpStatus).json({
        success: false,
        code: parseResult.error.code,
        message: 'Invalid translation request.',
      });
      return;
    }

    const clientAbort = new AbortController();
    const onRequestAborted = () => clientAbort.abort();
    const onResponseClosed = () => {
      if (!res.writableEnded) clientAbort.abort();
    };
    req.on('aborted', onRequestAborted);
    res.on('close', onResponseClosed);

    const dependencies: TranslationServiceDeps = {
      resolveCanonicalContext: resolveApprovedSourceContext,
      loadChunks: loadTranslationChunks,
      resolveProvider: resolveTranslationProvider,
      now: () => Date.now(),
      deadlineMs: getTranslationDeadlineMs(),
      createAbortController: () => new AbortController(),
      setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
      clearTimer: handle => clearTimeout(handle),
    };

    let result;
    try {
      result = await translateReaderTargets({
        routeId: id,
        path: 'approved',
        request: parseResult.request,
        clientSignal: clientAbort.signal,
      }, dependencies);
    } finally {
      req.removeListener('aborted', onRequestAborted);
      res.removeListener('close', onResponseClosed);
    }

    if (!result.success) {
      res.status(result.error.httpStatus).json({
        success: false,
        code: result.error.code,
        message: translationErrorMessage(result.error.code),
      });
      return;
    }

    res.status(200).json({ success: true, data: result.response });
  } catch {
    res.status(500).json({
      success: false,
      code: 'reader_translation_internal_error',
      message: 'An internal error occurred.',
    });
  }
}
