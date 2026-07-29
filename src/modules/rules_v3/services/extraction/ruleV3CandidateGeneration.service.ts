import type { DocumentResearchProfile } from '../planning/documentResearchProfile.types';
import type { EvidenceBatchPlan, EvidenceBatch } from '../planning/evidenceBatchPlanner.types';
import type { HierarchicalEvidencePlan } from '../planning/hierarchicalEvidencePlanner.types';
import {
  buildRuleV3EvidenceAnchors,
  type RuleV3EvidenceAnchor,
} from '../evidence/ruleV3EvidenceAnchor.service';
import type {
  ProviderCandidate,
  RuleV3GenerationProvider,
  RuleV3ProviderInput,
} from '../providers/ruleV3GenerationProvider.types';
import type { GeneratedRuleV3Candidates } from './ruleV3CandidateExtraction.types';

interface RuleV3CandidateGenerationInput {
  profile: DocumentResearchProfile;
  evidenceBatchPlan: EvidenceBatchPlan;
  hierarchicalPlan: HierarchicalEvidencePlan;
  workUnitId: string;
  provider: RuleV3GenerationProvider;
  abortSignal?: AbortSignal;
}

export async function generateRuleV3Candidates(
  input: RuleV3CandidateGenerationInput,
): Promise<GeneratedRuleV3Candidates> {
  const workUnit = input.hierarchicalPlan.workUnits.find(
    unit => unit.workUnitId === input.workUnitId,
  );
  if (!workUnit) throw new Error('work_unit_not_found');

  const targetBatches = selectTargetBatches(
    workUnit,
    input.evidenceBatchPlan,
  );
  assertPromptSize(targetBatches);

  const rawCandidates: ProviderCandidate[] = [];
  const evidenceAnchorMap = new Map<string, RuleV3EvidenceAnchor>();
  const chunkTextMap = new Map<string, string>();
  let totalRawCount = 0;

  for (const batch of targetBatches) {
    if (input.abortSignal?.aborted) throw new Error('provider_timeout');
    const providerInput = buildProviderInput(input.profile, workUnit, batch, evidenceAnchorMap);
    for (const chunk of batch.chunks) chunkTextMap.set(chunk.chunkId, chunk.text);
    const generated = await input.provider.generateCandidates(providerInput, input.abortSignal);
    if (generated.length > 3) throw new Error('provider_schema_invalid');
    totalRawCount += generated.length;
    if (totalRawCount > 6) throw new Error('provider_schema_invalid');
    rawCandidates.push(...generated);
  }

  return {
    workUnit,
    targetBatches,
    rawCandidates,
    evidenceAnchorMap,
    chunkTextMap,
  };
}

function selectTargetBatches(workUnit: any, plan: EvidenceBatchPlan): EvidenceBatch[] {
  const batchIds = workUnit.batchIds.slice(0, 2);
  if (batchIds.length === 0) throw new Error('work_unit_not_found');

  const workUnitChunkIds = new Set(workUnit.targetChunkIds);
  return batchIds.map((batchId: string) => {
    const batch = plan.batches.find(item => item.batchId === batchId);
    if (!batch) throw new Error('work_unit_not_found');
    const containsForeignChunk = batch.chunks.some(
      chunk => !workUnitChunkIds.has(chunk.chunkId),
    );
    if (containsForeignChunk) throw new Error('work_unit_not_found');
    return batch;
  });
}

function assertPromptSize(batches: EvidenceBatch[]): void {
  const totalCharacters = batches.reduce(
    (batchTotal, batch) => batchTotal
      + batch.chunks.reduce((chunkTotal, chunk) => chunkTotal + chunk.text.length, 0),
    0,
  );
  if (totalCharacters > 50000) throw new Error('input_too_large');
}

function buildProviderInput(
  profile: DocumentResearchProfile,
  workUnit: any,
  batch: EvidenceBatch,
  evidenceAnchorMap: Map<string, RuleV3EvidenceAnchor>,
): RuleV3ProviderInput {
  const firstChunk = batch.chunks[0];
  const sectionId = firstChunk?.sectionId || null;
  const sectionProfile = profile.sectionProfiles?.find(
    item => item.sectionId === sectionId,
  );
  const batchChunks = batch.chunks.map(chunk => ({
    chunkId: chunk.chunkId,
    text: chunk.text,
  }));
  const evidenceAnchors = buildRuleV3EvidenceAnchors(batchChunks);
  for (const anchor of evidenceAnchors) evidenceAnchorMap.set(anchor.evidenceId, anchor);

  return {
    batchId: batch.batchId,
    sectionId,
    sectionLabel: sectionProfile ? sectionProfile.heading : workUnit.label,
    workUnitId: workUnit.workUnitId,
    workUnitLabel: workUnit.label,
    strategy: workUnit.strategy,
    sourceLanguage: profile.sourceLanguage,
    chunks: batchChunks,
    evidenceAnchors: evidenceAnchors.map(anchor => ({
      evidenceId: anchor.evidenceId,
      chunkId: anchor.chunkId,
      exactQuote: anchor.exactQuote,
    })),
  };
}
