import { IAcademicSource } from '../models/AcademicSource';
import { ISourceContribution } from '../models/SourceContribution';

export interface ReimportResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface ImportCandidate {
  url: string;
  field: string;
}

interface ReaderReimportFields {
  sourceUrl?: string;
  xmlUrl?: string;
  fullTextUrl?: string;
  htmlUrl?: string;
  openAccessStatus?: string;
  metadata?: Record<string, unknown>;
}

export type ReaderReimportSource =
  (IAcademicSource | ISourceContribution) & ReaderReimportFields;
