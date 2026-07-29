import mongoose from 'mongoose';
import { ExtractedDocument } from '../services/types/extractedDocument.types';
import { SourceImportResolverResult } from './sourceImport.dto';

export type PdfMetadataTargetType = 'contribution' | 'approved_source';
export type PreferredPdfMetadataSource = 'jats' | 'html' | 'pdf_text';

export type ResolvedPdfMetadata = SourceImportResolverResult & {
  language?: string;
  copyrightStatus?: 'public_domain' | 'copyrighted_with_open_access' | 'paywalled';
};

export interface EnrichPdfMetadataInput {
  targetType: PdfMetadataTargetType;
  targetId: string;
  userId?: mongoose.Types.ObjectId;
  extractedDocument: ExtractedDocument;
}

export interface MetadataEnrichmentResult {
  success: boolean;
  message: string;
  identifiers: {
    doi?: string;
    isbn?: string;
    pmcid?: string;
  };
  preferredSource: PreferredPdfMetadataSource;
  metadataEnriched: boolean;
  conflictDetected: boolean;
  warnings: string[];
}
