import { DocumentExtractionPlan, ExtractionStrategy, SectionRole } from './documentResearchProfile.types';

export interface EvidenceChunkInput {
  chunkId: string;
  sectionId: string;
  chunkOrder: number;
  text: string;
  pageStart?: number;
  pageEnd?: number;
}

export interface PlannedEvidenceChunk extends EvidenceChunkInput {
  sectionRole: SectionRole;
  strategy: ExtractionStrategy;
  contentHash: string;
}

export interface EvidenceBatch {
  batchId: string;
  strategy: ExtractionStrategy;
  sourceLanguage: string;
  chunks: PlannedEvidenceChunk[];
  characterCount: number;
  pageStart?: number;
  pageEnd?: number;
  oversizedSingleChunk: boolean;
}

export interface EvidenceBatchPlan {
  documentId: string;
  sourceLanguage: string;
  researchType: DocumentExtractionPlan['documentType'];
  batches: EvidenceBatch[];
  diagnostics: {
    inputChunkCount: number;
    targetChunkCount: number;
    skippedChunkCount: number;
    missingSectionChunkCount: number;
    duplicateChunkCount: number;
    oversizedChunkCount: number;
    batchCount: number;
  };
}

export interface EvidenceBatchPlannerOptions {
  maxCharactersPerBatch?: number;
  maxChunksPerBatch?: number;
}
