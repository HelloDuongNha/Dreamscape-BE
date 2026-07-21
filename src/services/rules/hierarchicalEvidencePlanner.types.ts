import { DocumentResearchType, ExtractionStrategy } from './documentResearchProfile.types';

export interface EvidenceWorkUnit {
  workUnitId: string;
  ordinal: number;
  label: string;
  strategy: ExtractionStrategy;
  sectionIds: string[];
  targetChunkIds: string[];
  chunkCount: number;
  characterCount: number;
  batchIds: string[];
  batchCount: number;
}

export interface HierarchicalEvidencePlan {
  documentId: string;
  researchType: DocumentResearchType;
  sourceLanguage: string;
  organizationMode: 'article_sections' | 'book_chapters';
  workUnits: EvidenceWorkUnit[];
  diagnostics: {
    workUnitCount: number;
    targetSectionCount: number;
    targetChunkCount: number;
    assignedChunkCount: number;
    unassignedChunkCount: number;
    duplicateAssignmentCount: number;
    technicalBatchCount: number;
  };
}
