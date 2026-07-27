import {
  FailedTranslationTarget,
  NORMALIZATION_VERSION,
  SuccessfulTranslatedTarget,
  TRANSLATION_SCHEMA_VERSION,
  TranslateReaderRequest,
  TranslateReaderResponse,
  TranslatedTargetItem,
} from './readerTranslation.types';

export function makeSuccessfulTranslation(
  target: TranslateReaderRequest['targets'][number],
  translatedText: string,
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
    targetType: target.targetType,
    chunkId: target.chunkId,
    contentHash: target.contentHash,
    status: 'translated',
    translatedText,
  };
}

export function makeFailedTranslation(
  target: TranslateReaderRequest['targets'][number],
  providerFailureCode: FailedTranslationTarget['providerFailureCode'],
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
    targetType: target.targetType,
    chunkId: target.chunkId,
    contentHash: target.contentHash,
    status: 'provider_failed',
    providerFailureCode,
  };
}

export function buildTranslationResponse(
  request: TranslateReaderRequest,
  context: { sourceContentHash: string; sourceLanguage: string | null },
  targets: TranslatedTargetItem[],
  engineName: string | null,
  modelName: string | null,
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
