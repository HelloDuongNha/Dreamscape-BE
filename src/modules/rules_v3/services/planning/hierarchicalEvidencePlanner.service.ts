import { buildEvidenceWorkUnits } from './hierarchicalEvidenceAssembly.service';
import { buildEvidenceCandidateGroups } from './hierarchicalEvidenceGrouping.service';
import type { DocumentResearchProfile, DocumentExtractionPlan } from './documentResearchProfile.types';
import type { EvidenceBatchPlan } from './evidenceBatchPlanner.types';
import type { HierarchicalEvidencePlan } from './hierarchicalEvidencePlanner.types';

// Plans deterministic evidence work units and reports their final coverage.
export function planHierarchicalEvidence(
  profile: DocumentResearchProfile,
  extractionPlan: DocumentExtractionPlan,
  evidenceBatchPlan: EvidenceBatchPlan
): HierarchicalEvidencePlan {
  const { organizationMode, candidateGroups } = buildEvidenceCandidateGroups(
    profile,
    extractionPlan,
  );
  const workUnits = buildEvidenceWorkUnits(
    extractionPlan.documentId,
    candidateGroups,
    evidenceBatchPlan,
  );
  const targetSectionCount = extractionPlan.sectionDecisions.filter(d => d.usage === 'target').length;
  const targetChunkCount = evidenceBatchPlan.diagnostics.targetChunkCount;
  const assignedChunkCount = workUnits.reduce((sum, wu) => sum + wu.chunkCount, 0);
  const unassignedChunkCount = targetChunkCount - assignedChunkCount;

  return {
    documentId: extractionPlan.documentId,
    researchType: extractionPlan.documentType,
    sourceLanguage: extractionPlan.sourceLanguage,
    organizationMode,
    workUnits,
    diagnostics: {
      workUnitCount: workUnits.length,
      targetSectionCount,
      targetChunkCount,
      assignedChunkCount,
      unassignedChunkCount,
      duplicateAssignmentCount: 0,
      technicalBatchCount: evidenceBatchPlan.batches.length,
    },
  };
}
