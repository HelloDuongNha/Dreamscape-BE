import mongoose from 'mongoose';
import { importSmartReaderForSource } from './academic/smartReaderImport.service';

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

export async function importFullTextForSource(
  source: any,
  moderatorId: mongoose.Types.ObjectId,
  isReimportOverride?: boolean
): Promise<ImportResult> {
  const isReimport = isReimportOverride !== undefined 
    ? isReimportOverride 
    : (source.readableInApp || source.fullTextStatus === 'imported');

  const res = await importSmartReaderForSource(source, moderatorId, isReimport);

  return {
    success: res.success,
    message: res.message,
    error: res.error,
    report: res.report,
    resolverReport: (res as any).resolverReport,
    candidateAttempts: (res as any).candidateAttempts,
    data: { source }
  };
}
