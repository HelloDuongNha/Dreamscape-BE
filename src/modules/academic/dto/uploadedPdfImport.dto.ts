import type mongoose from 'mongoose';
import type { PdfImportProgressState } from '../services/ingestion/pdf/pdfImportProgress.service';

export interface UploadedPdfImportInput {
  targetType: 'contribution' | 'approved_source';
  targetId: string;
  forceReplace?: boolean;
  userId?: mongoose.Types.ObjectId;
  structuredFirst?: boolean;
}

export interface UploadedPdfImportResult {
  success: boolean;
  cancelled?: boolean;
  targetType: UploadedPdfImportInput['targetType'];
  targetId: string;
  readerCreated: boolean;
  requiresOcr: boolean;
  selectedSource: 'jats' | 'html' | 'pdf_text' | 'docling_pdf' | 'none';
  extractionMethod?: 'jats' | 'html' | 'pdf_text' | 'ocr';
  extractionQuality?: 'good' | 'partial' | 'poor';
  metadataEnriched: boolean;
  detectedIdentifiers?: { doi?: string; isbn?: string; pmcid?: string };
  smartReaderStats?: {
    pageCount: number;
    figureCount: number;
    tableCount: number;
    referenceCount: number;
  };
  timing?: PdfImportProgressState;
  resolvedTitle?: string;
  message: string;
}
