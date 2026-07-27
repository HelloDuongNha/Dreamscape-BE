import { Types } from 'mongoose';
import { IAcademicDocument } from '../models/AcademicDocument';
import { IAcademicSource } from '../models/AcademicSource';
import { ISourceContribution } from '../models/SourceContribution';

export interface ContributionServiceResult {
  status: number;
  body: Record<string, unknown>;
}

export type DuplicateCondition = Record<string, unknown>;

export type ApprovalContribution = ISourceContribution & {
  journal?: string;
  publisher?: string;
  openAccessStatus?: string;
  oaStatus?: string;
  fullTextSourceType?: IAcademicSource['fullTextSourceType'];
  fullTextUrl?: string;
  verificationStatus?: IAcademicSource['verificationStatus'];
  sourceQuality?: IAcademicSource['sourceQuality'];
  xmlUrl?: string;
  landingPageUrl?: string;
};

export interface SourceMetadata {
  title?: string;
  authors?: string[];
  journal?: string;
  publisher?: string;
  year?: number;
  doi?: string;
  url?: string;
  pdfUrl?: string;
  htmlUrl?: string;
  xmlUrl?: string;
  landingPageUrl?: string;
  openAccessStatus: string;
  oaStatus: string;
  allowedUse: string;
  license: string;
}

export interface PreparedContribution {
  metadata: SourceMetadata;
  uploadedPdf: boolean;
  previewDocument: IAcademicDocument | null;
}

export interface ApprovalRequest {
  contribution: ApprovalContribution;
  reviewerId: Types.ObjectId;
  title: string;
  reviewNote: string;
  reviewNoteProvided: boolean;
  previousStatus: string;
}

export type PreparedApprovalContext = PreparedContribution & {
  contribution: ApprovalContribution;
};

export interface ApprovalOutcome {
  message: string;
  warning: boolean;
  code?: string;
  details?: unknown;
  fullText?: unknown;
}
