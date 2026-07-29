import type { EvidenceBatch } from '../planning/evidenceBatchPlanner.types';
import type {
  ProviderCandidate,
  RuleV3CandidateRejectionCode,
  RuleV3ClaimType,
  RuleV3EffectPolarity,
  RuleV3EvidenceInterpretation,
} from '../providers/ruleV3GenerationProvider.types';
import type { RuleV3EvidenceAnchor } from '../evidence/ruleV3EvidenceAnchor.service';

export interface CitationVerifiedCandidate {
  statement: string;
  claimType: RuleV3ClaimType;
  effectPolarity: RuleV3EffectPolarity;
  evidenceInterpretation: RuleV3EvidenceInterpretation;
  subject: string;
  outcome: string;
  conditions: string[];
  limitations: string[];
  dreamFeatureTags: string[];
  citationVerification: 'passed';
  semanticVerification: 'passed';
  warnings: Array<'language_uncertain'>;
  evidence: Array<{
    chunkId: string;
    exactQuote: string;
    startOffset: number;
    endOffset: number;
    stance: 'supports' | 'refutes' | 'limits';
    chunkContentHash: string;
  }>;
}

export interface RejectedCandidate {
  proposedStatement?: string;
  reasonCode: RuleV3CandidateRejectionCode;
  safeMessage: string;
}

export interface GeneratedRuleV3Candidates {
  workUnit: any;
  targetBatches: EvidenceBatch[];
  rawCandidates: ProviderCandidate[];
  evidenceAnchorMap: Map<string, RuleV3EvidenceAnchor>;
  chunkTextMap: Map<string, string>;
}

export interface VerifiedRuleV3Candidates {
  candidates: CitationVerifiedCandidate[];
  rejectedCandidates: RejectedCandidate[];
  verifiedCitationCount: number;
  invalidCitationCount: number;
}

export interface DeduplicatedRuleV3Candidates {
  candidates: Array<Omit<CitationVerifiedCandidate, 'evidence'> & {
    evidence: Array<Omit<CitationVerifiedCandidate['evidence'][number], 'chunkContentHash'>>;
  }>;
  mergedDuplicateCount: number;
}

export interface ExtractionDryRunResult {
  readerInput: {
    documentId: string;
    parserEngine: string;
    documentUpdatedAt: string | null;
    sectionCount: number;
    readerChunkCount: number;
  };
  workUnit: {
    workUnitId: string;
    label: string;
    strategy: string;
    totalBatchCount: number;
    processedBatchCount: number;
    partialPreview: boolean;
  };
  provider: {
    provider: 'ollama' | 'gemini';
    model: string;
    durationMs: number;
  };
  citationVerifiedCandidates: DeduplicatedRuleV3Candidates['candidates'];
  rejectedCandidates: RejectedCandidate[];
  diagnostics: {
    rawCandidateCount: number;
    citationVerifiedCandidateCount: number;
    rejectedCandidateCount: number;
    mergedDuplicateCount: number;
    verifiedCitationCount: number;
    invalidCitationCount: number;
  };
  safety: {
    previewOnly: boolean;
    databaseWrites: number;
  };
}
