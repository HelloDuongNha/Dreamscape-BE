export interface CanonicalReaderIdentity {
  documentId: string;
  sourceLanguage: string | null;
  sourceContentHash: string;
  parserEngine: string | null;
  parserVersion: string | null;
  updatedAt: string | null;
}

export interface CanonicalReaderBlockIdentity {
  chunkId: string;
  sectionId: string;
  chunkIndex: number;
  contentHash: string;
}

export interface CanonicalReaderSectionIdentity {
  sectionId: string;
  sectionOrder: number | null;
  heading: string | null;
  sectionType: string | null;
}

export interface ApiResponseSection {
  sectionIndex: number;
  sectionType: string;
  text: string;
  html: string | null;
  marker: string | null;
  pageStart: number;
  pageEnd: number;
  blockIdentity: CanonicalReaderBlockIdentity;
  sectionIdentity: CanonicalReaderSectionIdentity | null;
}
