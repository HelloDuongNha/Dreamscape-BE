import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { getTranslationDeadlineMs } from '../../../config/translationConfig';
import { translateReaderTargets } from '../services/reader/canonicalReaderTranslation.service';
import type { TranslationServiceDeps } from '../services/reader/readerTranslation.types';
import {
  loadTranslationChunks,
  resolvePreviewContributionContext,
} from '../services/reader/readerTranslationContext.service';
import { resolveTranslationProvider } from '../services/reader/readerTranslationProvider.registry';
import {
  checkHttpBodyLimit,
  validateRequestShape,
} from '../services/reader/readerTranslationValidator.service';

function translationErrorMessage(code: string): string {
  if (code === 'reader_translation_identity_stale') return 'The source content has changed. Please refresh and retry.';
  if (code === 'reader_translation_provider_unavailable') return 'Translation provider is not available.';
  if (code === 'reader_translation_limit_exceeded') return 'Request exceeds size limit.';
  if (code === 'reader_translation_document_unavailable') return 'Document not found.';
  return 'Invalid translation request.';
}

export async function getSourcePreviewTranslation(req: Request, res: Response): Promise<void> {
  const sourceId = req.params.id as string;
  if (!sourceId || !mongoose.Types.ObjectId.isValid(sourceId)) {
    res.status(404).json({ success: false, code: 'reader_translation_document_unavailable', message: 'Source not found.' });
    return;
  }

  const bodyLimitError = checkHttpBodyLimit(req.rawBodyLength ?? 0);
  if (bodyLimitError) {
    res.status(413).json({ success: false, code: bodyLimitError.code, message: 'Request too large.' });
    return;
  }
  const parsed = validateRequestShape(req.body);
  if (!parsed.valid) {
    res.status(parsed.error.httpStatus).json({ success: false, code: parsed.error.code, message: 'Invalid translation request.' });
    return;
  }

  const clientAbort = new AbortController();
  const onRequestAborted = () => clientAbort.abort();
  const onResponseClosed = () => {
    if (!res.writableEnded) clientAbort.abort();
  };
  req.on('aborted', onRequestAborted);
  res.on('close', onResponseClosed);

  try {
    const deps: TranslationServiceDeps = {
      resolveCanonicalContext: resolvePreviewContributionContext,
      loadChunks: loadTranslationChunks,
      resolveProvider: resolveTranslationProvider,
      now: () => Date.now(),
      deadlineMs: getTranslationDeadlineMs(),
      createAbortController: () => new AbortController(),
      setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
      clearTimer: timer => clearTimeout(timer),
    };
    const result = await translateReaderTargets(
      { routeId: sourceId, path: 'preview', request: parsed.request, clientSignal: clientAbort.signal },
      deps,
    );
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
  } finally {
    req.removeListener('aborted', onRequestAborted);
    res.removeListener('close', onResponseClosed);
  }
}
