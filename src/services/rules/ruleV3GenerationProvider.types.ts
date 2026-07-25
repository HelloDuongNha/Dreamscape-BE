import type { ExtractionStrategy } from './documentResearchProfile.types';

export type RuleV3ClaimType =
  | 'association'
  | 'prediction'
  | 'intervention_effect'
  | 'moderation'
  | 'mediation'
  | 'qualitative_theme'
  | 'theoretical_proposition'
  | 'review_synthesis'
  | 'null_finding';

export type RuleV3EffectPolarity =
  | 'positive'
  | 'negative'
  | 'mixed'
  | 'neutral'
  | 'unknown';

export type RuleV3EvidenceInterpretation =
  | 'causal'
  | 'associational'
  | 'predictive'
  | 'descriptive'
  | 'interpretive'
  | 'not_applicable';

export type ProviderCandidateEvidence =
  | {
      /** Production contract: choose an immutable evidence span supplied by the backend. */
      evidenceId: string;
      stance: 'supports' | 'refutes' | 'limits';
    }
  | {
      /** Compatibility path used by deterministic legacy tests; providers do not receive this schema. */
      chunkId: string;
      proposedQuote: string;
      stance: 'supports' | 'refutes' | 'limits';
    };

export interface ProviderCandidate {
  statement: string;
  claimType: RuleV3ClaimType;
  effectPolarity: RuleV3EffectPolarity;
  evidenceInterpretation: RuleV3EvidenceInterpretation;
  subject: string;
  outcome: string;
  conditions: string[];
  limitations: string[];
  dreamFeatureTags: string[];
  evidence: ProviderCandidateEvidence[];
}

export interface RuleV3ProviderChunk {
  chunkId: string;
  text: string;
}

export interface RuleV3ProviderInput {
  batchId: string;
  sectionId: string | null;
  sectionLabel: string | null;
  workUnitId: string;
  workUnitLabel: string;
  strategy: ExtractionStrategy;
  sourceLanguage: string;
  chunks: RuleV3ProviderChunk[];
  evidenceAnchors?: Array<{
    evidenceId: string;
    chunkId: string;
    exactQuote: string;
  }>;
}

export interface RuleV3GenerationProvider {
  name: 'ollama' | 'gemini';
  modelName: string;
  generateCandidates(
    input: RuleV3ProviderInput,
    abortSignal?: AbortSignal
  ): Promise<ProviderCandidate[]>;
}

// Discriminated union run-level error codes
export type RuleV3RunLevelErrorCode =
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'provider_schema_invalid'
  | 'input_too_large'
  | 'dry_run_already_active'
  | 'work_unit_not_found'
  | 'plan_unavailable'
  | 'invalid_provider';

// Candidate level rejection reason codes
export type RuleV3CandidateRejectionCode =
  | 'language_mismatch'
  | 'citation_missing'
  | 'citation_ambiguous'
  | 'evidence_reference_invalid'
  | 'chunk_outside_work_unit'
  | 'invalid_causal_elevation'
  | 'candidate_schema_invalid'
  | 'no_verified_evidence'
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
