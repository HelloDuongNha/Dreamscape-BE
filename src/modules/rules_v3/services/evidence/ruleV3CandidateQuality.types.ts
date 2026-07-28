import type {
  RuleV3ClaimType,
  RuleV3EffectPolarity,
  RuleV3EvidenceInterpretation
} from '../providers/ruleV3GenerationProvider.types';

export type RuleV3QualityReasonCode =
  | 'document_navigation'
  | 'research_recommendation'
  | 'claim_type_evidence_mismatch'
  | 'evidence_does_not_entail_claim'
  | 'generic_subject_or_outcome'
  | 'case_specific_narrative'
  | 'historical_or_biographical_fact'
  | 'generic_relation_wording'
  | 'not_applicable_to_dream_analysis'
  | 'fixed_symbol_dictionary'
  | 'unfalsifiable_prediction'
  | 'identity_stereotype'
  | 'book_claim_lacks_generalizable_mechanism'
  | 'non_operational_theory';

export type RuleV3SemanticSupportLevel = 'direct' | 'partial' | 'none';
export type RuleV3ApplicationReadiness = 'direct' | 'conditional' | 'background' | 'not_usable';

export interface RuleV3QualityCandidate {
  statement: string;
  claimType: RuleV3ClaimType | string;
  effectPolarity: RuleV3EffectPolarity | string;
  evidenceInterpretation: RuleV3EvidenceInterpretation | string;
  subject: string;
  outcome: string;
  conditions?: string[];
  limitations?: string[];
  dreamFeatureTags?: string[];
}

export interface RuleV3QualityEvidence {
  exactQuote?: string;
  stance: 'supports' | 'refutes' | 'limits';
  chunkId?: unknown;
  startOffset?: number;
  endOffset?: number;
}

export interface RuleV3SemanticSupport {
  level: RuleV3SemanticSupportLevel;
  score: number;
  reason: string;
}

export interface RuleV3CandidateQualityResult {
  accepted: boolean;
  reasonCodes: RuleV3QualityReasonCode[];
  semanticSupportLevel: RuleV3SemanticSupportLevel;
  semanticSupportScore: number;
  semanticSupportReason: string;
  applicationReadiness: RuleV3ApplicationReadiness;
  normalizedEffectPolarity: RuleV3EffectPolarity | string;
  normalizedEvidenceInterpretation: RuleV3EvidenceInterpretation | string;
  summary: string;
}
