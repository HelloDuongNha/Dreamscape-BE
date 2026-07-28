import type {
  DocumentExtractionPlan,
  DocumentResearchProfile,
} from '../planning/documentResearchProfile.types';
import type { EvidenceBatchPlan } from '../planning/evidenceBatchPlanner.types';
import type { HierarchicalEvidencePlan } from '../planning/hierarchicalEvidencePlanner.types';
import type { RuleV3GenerationProvider } from '../providers/ruleV3GenerationProvider.types';
import { deduplicateRuleV3Candidates } from './ruleV3CandidateDeduplication.service';
import type { ExtractionDryRunResult } from './ruleV3CandidateExtraction.types';
import { generateRuleV3Candidates } from './ruleV3CandidateGeneration.service';
import { verifyRuleV3Candidates } from './ruleV3CandidateVerification.service';

export async function extractRuleV3Candidates(
  profile: DocumentResearchProfile,
  _extractionPlan: DocumentExtractionPlan,
  evidenceBatchPlan: EvidenceBatchPlan,
  hierarchicalPlan: HierarchicalEvidencePlan,
  readerInput: {
    documentId: string;
    parserEngine: string;
    documentUpdatedAt: string | null;
    sectionCount: number;
    readerChunkCount: number;
  },
  workUnitId: string,
  provider: RuleV3GenerationProvider,
  abortSignal?: AbortSignal,
): Promise<ExtractionDryRunResult> {
  const startedAt = Date.now();
  const generated = await generateRuleV3Candidates({
    profile,
    evidenceBatchPlan,
    hierarchicalPlan,
    workUnitId,
    provider,
    abortSignal,
  });
  const verified = verifyRuleV3Candidates(profile, generated);
  const deduplicated = deduplicateRuleV3Candidates(
    profile.sourceLanguage,
    verified.candidates,
  );

  return {
    readerInput: {
      documentId: readerInput.documentId,
      parserEngine: readerInput.parserEngine,
      documentUpdatedAt: readerInput.documentUpdatedAt,
      sectionCount: readerInput.sectionCount,
      readerChunkCount: readerInput.readerChunkCount,
    },
    workUnit: {
      workUnitId: generated.workUnit.workUnitId,
      label: generated.workUnit.label,
      strategy: generated.workUnit.strategy,
      totalBatchCount: generated.workUnit.batchCount,
      processedBatchCount: generated.targetBatches.length,
      partialPreview: generated.workUnit.batchCount > 2,
    },
    provider: {
      provider: provider.name,
      model: provider.modelName,
      durationMs: Date.now() - startedAt,
    },
    citationVerifiedCandidates: deduplicated.candidates,
    rejectedCandidates: verified.rejectedCandidates,
    diagnostics: {
      rawCandidateCount: generated.rawCandidates.length,
      citationVerifiedCandidateCount: deduplicated.candidates.length,
      rejectedCandidateCount: verified.rejectedCandidates.length,
      mergedDuplicateCount: deduplicated.mergedDuplicateCount,
      verifiedCitationCount: verified.verifiedCitationCount,
      invalidCitationCount: verified.invalidCitationCount,
    },
    safety: {
      previewOnly: true,
      databaseWrites: 0,
    },
  };
}
