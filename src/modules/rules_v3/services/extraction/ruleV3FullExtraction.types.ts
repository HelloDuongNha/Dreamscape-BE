import { buildRuleV3PlanPreviewRaw } from '../planning/ruleV3PlanPreview.service';
import mongoose from 'mongoose';

export const MAX_RULE_V3_REJECTION_DIAGNOSTICS = 50;

export type RuleV3RawExtractionPlan = Awaited<ReturnType<typeof buildRuleV3PlanPreviewRaw>>;

export interface RuleV3RejectionDiagnostic {
  batchId: string;
  reasonCode: string;
  safeMessage: string;
  proposedStatement?: string;
}

export interface RuleV3BatchExtractionResult {
  mergedCandidates: Map<string, any>;
  rawCandidateCount: number;
  rejectedCandidateCount: number;
  rejectionDiagnostics: RuleV3RejectionDiagnostic[];
}

export interface RuleV3BatchProgress {
  processedBatches: number;
  rawCandidateCount: number;
  verifiedCandidateCount: number;
  rejectedCandidateCount: number;
  rejectionDiagnostics: RuleV3RejectionDiagnostic[];
}

export interface RuleV3MutationContext {
  journalId: string | null;
  rolledBack: boolean;
}

export interface RuleV3PersistenceResult {
  resultRuleIds: mongoose.Types.ObjectId[];
  savedCandidateCount: number;
  mergedCandidateCount: number;
  rejectedCandidateCount: number;
  rejectionDiagnostics: RuleV3RejectionDiagnostic[];
}
