import crypto from 'crypto';
import { logger } from '../../../../infrastructure/logger';
import { classifyRuleV3Relationship } from '../evidence/ruleV3Relationship.service';
import { extractRuleV3Candidates } from './ruleV3Extractor.service';
import type { RuleV3GenerationProvider } from '../providers/ruleV3GenerationProvider.types';
import {
  MAX_RULE_V3_REJECTION_DIAGNOSTICS,
  RuleV3BatchExtractionResult,
  RuleV3BatchProgress,
  RuleV3RawExtractionPlan,
} from './ruleV3FullExtraction.types';

interface RuleV3BatchExtractionInput {
  runId: string;
  raw: RuleV3RawExtractionPlan;
  provider: RuleV3GenerationProvider;
  abortSignal: AbortSignal;
  onProgress: (progress: RuleV3BatchProgress) => Promise<unknown>;
}

export async function extractRuleV3Batches(
  input: RuleV3BatchExtractionInput,
): Promise<RuleV3BatchExtractionResult> {
  const workUnitByBatch = indexWorkUnitsByBatch(input.raw);
  const mergedCandidates = new Map<string, any>();
  const rejectionDiagnostics = [] as RuleV3BatchExtractionResult['rejectionDiagnostics'];
  let rawCandidateCount = 0;
  let rejectedCandidateCount = 0;
  let processedBatches = 0;

  for (const batch of input.raw.evidencePlan.batches) {
    if (input.abortSignal.aborted) throw new Error('user_cancelled');
    const unit = workUnitByBatch.get(batch.batchId);
    if (!unit) continue;

    const result = await extractOneBatch(input, batch, unit).catch(async (error: any) => {
      if (error?.message !== 'provider_schema_invalid') throw error;
      rejectedCandidateCount += 1;
      appendRejectionDiagnostic(rejectionDiagnostics, {
        batchId: batch.batchId,
        reasonCode: 'provider_schema_invalid',
        safeMessage: 'Mô hình trả về lập luận không đúng cấu trúc bắt buộc.',
      });
      processedBatches += 1;
      logger.warn('Rule V3 batch rejected because provider output violated the schema.', {
        runId: input.runId,
        batchId: batch.batchId,
      });
      await input.onProgress({
        processedBatches,
        rawCandidateCount,
        verifiedCandidateCount: mergedCandidates.size,
        rejectedCandidateCount,
        rejectionDiagnostics,
      });
      return null;
    });
    if (!result) continue;

    rawCandidateCount += result.diagnostics.rawCandidateCount;
    rejectedCandidateCount += result.diagnostics.rejectedCandidateCount;
    for (const rejected of result.rejectedCandidates) {
      appendRejectionDiagnostic(rejectionDiagnostics, {
        batchId: batch.batchId,
        reasonCode: rejected.reasonCode,
        safeMessage: rejected.safeMessage,
        proposedStatement: rejected.proposedStatement?.slice(0, 300),
      });
    }
    for (const candidate of result.citationVerifiedCandidates) {
      mergeCandidate(mergedCandidates, candidate);
    }

    processedBatches += 1;
    await input.onProgress({
      processedBatches,
      rawCandidateCount,
      verifiedCandidateCount: mergedCandidates.size,
      rejectedCandidateCount,
      rejectionDiagnostics,
    });
  }

  return {
    mergedCandidates,
    rawCandidateCount,
    rejectedCandidateCount,
    rejectionDiagnostics,
  };
}

function indexWorkUnitsByBatch(raw: RuleV3RawExtractionPlan): Map<string, any> {
  const workUnitByBatch = new Map<string, any>();
  for (const unit of raw.hierarchicalPlan.workUnits) {
    for (const batchId of unit.batchIds) workUnitByBatch.set(batchId, unit);
  }
  return workUnitByBatch;
}

async function extractOneBatch(input: RuleV3BatchExtractionInput, batch: any, unit: any) {
  const oneBatchUnit = { ...unit, batchIds: [batch.batchId], batchCount: 1 };
  return extractRuleV3Candidates(
    input.raw.profile,
    input.raw.extractionPlan,
    input.raw.evidencePlan,
    { ...input.raw.hierarchicalPlan, workUnits: [oneBatchUnit] },
    {
      documentId: String(input.raw.document._id),
      parserEngine: input.raw.document.parserEngine || 'unknown',
      documentUpdatedAt: input.raw.document.updatedAt
        ? new Date(input.raw.document.updatedAt).toISOString()
        : null,
      sectionCount: input.raw.sections.length,
      readerChunkCount: input.raw.chunks.length,
    },
    unit.workUnitId,
    input.provider,
    input.abortSignal,
  );
}

function mergeCandidate(mergedCandidates: Map<string, any>, candidate: any): void {
  const dedupKey = buildCandidateDedupKey(candidate);
  const existing = mergedCandidates.get(dedupKey)
    || [...mergedCandidates.values()].find(item =>
      classifyRuleV3Relationship(item, candidate) === 'equivalent');
  if (!existing) {
    mergedCandidates.set(dedupKey, {
      ...candidate,
      dedupKey,
      evidence: [...candidate.evidence],
    });
    return;
  }

  for (const evidence of candidate.evidence) {
    const span = `${evidence.chunkId}:${evidence.startOffset}:${evidence.endOffset}:${evidence.stance}`;
    const alreadyIncluded = existing.evidence.some((item: any) =>
      `${item.chunkId}:${item.startOffset}:${item.endOffset}:${item.stance}` === span);
    if (!alreadyIncluded) existing.evidence.push(evidence);
  }
  existing.dreamFeatureTags = [...new Set([...existing.dreamFeatureTags, ...candidate.dreamFeatureTags])];
  existing.conditions = [...new Set([...existing.conditions, ...candidate.conditions])];
  existing.limitations = [...new Set([...existing.limitations, ...candidate.limitations])];
}

function buildCandidateDedupKey(candidate: {
  claimType: string;
  effectPolarity: string;
  evidenceInterpretation: string;
  subject: string;
  outcome: string;
  conditions: string[];
}): string {
  const normalize = (value: string) =>
    value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const conditions = [...new Set(candidate.conditions.map(normalize))].sort();
  return crypto.createHash('sha256').update([
    candidate.claimType,
    candidate.effectPolarity,
    candidate.evidenceInterpretation,
    normalize(candidate.subject),
    normalize(candidate.outcome),
    conditions.join('|'),
  ].join('\n'), 'utf8').digest('hex');
}

function appendRejectionDiagnostic(
  diagnostics: RuleV3BatchExtractionResult['rejectionDiagnostics'],
  diagnostic: RuleV3BatchExtractionResult['rejectionDiagnostics'][number],
): void {
  if (diagnostics.length < MAX_RULE_V3_REJECTION_DIAGNOSTICS) diagnostics.push(diagnostic);
}
