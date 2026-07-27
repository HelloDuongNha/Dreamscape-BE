import mongoose from 'mongoose';
import { importSmartReaderForSource } from '../ingestion/structured/smartReaderImport.service';
import { recordReaderBuildFailure } from '../reader/history/readerBuildHistory.service';

export interface ImportResult {
  success: boolean;
  warning?: boolean;
  code?: string;
  message?: string;
  data?: any;
  error?: string;
  details?: any;
  report?: any;
  resolverReport?: any;
  candidateAttempts?: any[];
}

export interface ReaderImportOptions {
  replacementRunId?: string;
  abortSignal?: AbortSignal;
  sourcePolicy?: 'any' | 'structured_only';
  buildStartedAt?: number;
}

export async function importFullTextForSource(
  source: any,
  moderatorId: mongoose.Types.ObjectId,
  isReimportOverride?: boolean,
  options?: ReaderImportOptions,
): Promise<ImportResult> {
  const isReimport = isReimportOverride !== undefined 
    ? isReimportOverride 
    : (source.readableInApp || source.fullTextStatus === 'imported');

  try {
    const res = await importSmartReaderForSource(source, moderatorId, isReimport, options);
    if (!res.success) {
      await recordReaderBuildFailure({
        sourceId: source._id,
        isContribution: source?.constructor?.modelName === 'SourceContribution',
        engine: 'structured_resolver',
        sourceType: 'doi_html_xml',
        failureCode: res.error || 'STRUCTURED_IMPORT_FAILED',
        failureMessage: res.message,
        timing: { startedAt: options?.buildStartedAt },
      }).catch(() => {});
    }

    return {
      success: res.success,
      message: res.message,
      error: res.error,
      report: res.report,
      resolverReport: (res as any).resolverReport,
      candidateAttempts: (res as any).candidateAttempts,
      data: { source }
    };
  } catch (error: any) {
    await recordReaderBuildFailure({
      sourceId: source._id,
      isContribution: source?.constructor?.modelName === 'SourceContribution',
      engine: 'structured_resolver',
      sourceType: 'doi_html_xml',
      failureCode: error?.code || 'STRUCTURED_IMPORT_FAILED',
      failureMessage: error?.message || 'Không thể nhập bản đọc từ nguồn có cấu trúc.',
      timing: { startedAt: options?.buildStartedAt },
    }).catch(() => {});
    throw error;
  }
}
