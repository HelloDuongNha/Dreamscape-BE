import mongoose from 'mongoose';
import { logger } from '../../../../infrastructure/logger';
import { linkOracleEvidenceGapCandidatesForRules } from '../../../oracle/services/oracleEvidenceGap.service';
import AcademicRuleExtractionRunV3 from '../../models/AcademicRuleExtractionRun';
import KnowledgeRuleV3 from '../../models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../models/KnowledgeRuleEvidence';
import { autoMergePendingRuleV3Groups } from '../moderation/ruleV3Merge.service';
import {
  commitRuleV3MutationJournal,
  rollbackRuleV3MutationJournal,
} from '../lifecycle/ruleV3ReplacementJournal.service';
import {
  RuleV3MutationContext,
  RuleV3PersistenceResult,
  RuleV3RawExtractionPlan,
} from './ruleV3FullExtraction.types';

interface RuleV3CompletionInput {
  runId: string;
  attemptId: string;
  raw: RuleV3RawExtractionPlan;
  sourceAliases: mongoose.Types.ObjectId[];
  verifiedCandidateCount: number;
  persistence: RuleV3PersistenceResult;
  mutation: RuleV3MutationContext;
  abortSignal: AbortSignal;
  updateRun: (update: Record<string, unknown>) => Promise<unknown>;
}

export async function completeRuleV3Extraction(input: RuleV3CompletionInput): Promise<void> {
  const allCandidatesRejected = input.verifiedCandidateCount > 0
    && input.persistence.resultRuleIds.length === 0;
  const incompleteMutation = input.verifiedCandidateCount > 0
    && input.persistence.resultRuleIds.length !== input.verifiedCandidateCount;
  const mutationFailed = allCandidatesRejected || incompleteMutation;

  if (mutationFailed && input.mutation.journalId) {
    await rollbackRuleV3MutationJournal(input.mutation.journalId);
    input.mutation.rolledBack = true;
  }

  let finalRuleIds = mutationFailed
    ? []
    : deduplicateRuleIds(input.persistence.resultRuleIds);
  const evidenceChunkIds = await loadEvidenceChunkIds(finalRuleIds, input.sourceAliases);
  if (input.abortSignal.aborted) throw new Error('user_cancelled');
  if (!mutationFailed && input.mutation.journalId) {
    await commitRuleV3MutationJournal(input.mutation.journalId);
  }

  let mergedCandidateCount = input.persistence.mergedCandidateCount;
  if (!mutationFailed && finalRuleIds.length > 0) {
    await input.updateRun({ currentStage: 'merging_candidates' });
    const automaticMerge = await autoMergePendingRuleV3Groups(finalRuleIds);
    finalRuleIds = automaticMerge.activeRuleIds;
    mergedCandidateCount += automaticMerge.retiredRuleCount;
    if (automaticMerge.failures.length > 0) {
      logger.warn('Some Rule V3 candidates could not be merged automatically.', {
        runId: input.runId,
        failures: automaticMerge.failures,
      });
    }
  }

  await input.updateRun({
    status: mutationFailed ? 'failed' : 'success',
    currentStage: mutationFailed ? 'failed' : 'completed',
    processedBatches: input.raw.evidencePlan.batches.length,
    verifiedCandidateCount: input.verifiedCandidateCount,
    savedCandidateCount: mutationFailed ? 0 : input.persistence.savedCandidateCount,
    mergedCandidateCount: mutationFailed ? 0 : mergedCandidateCount,
    rejectedCandidateCount: input.persistence.rejectedCandidateCount,
    rejectionDiagnostics: input.persistence.rejectionDiagnostics,
    evidenceChunkCount: evidenceChunkIds.length,
    resultRuleIds: finalRuleIds,
    sanitizedErrorCode: mutationFailed
      ? (incompleteMutation ? 'candidate_persistence_incomplete' : 'all_verified_candidates_rejected')
      : undefined,
    finishedAt: new Date(),
  });
  await linkExtractedRulesToEvidenceGaps(input.runId, finalRuleIds);
}

export async function failRuleV3Extraction(input: {
  runId: string;
  attemptId: string;
  mutation: RuleV3MutationContext;
  abortSignal: AbortSignal;
  error: any;
}): Promise<void> {
  let rollbackFailed = false;
  if (input.mutation.journalId && !input.mutation.rolledBack) {
    try {
      await rollbackRuleV3MutationJournal(input.mutation.journalId);
      input.mutation.rolledBack = true;
    } catch (restoreError: any) {
      rollbackFailed = true;
      logger.error('Rule V3 mutation rollback failed.', restoreError, {
        runId: input.runId,
        attemptId: input.attemptId,
      });
    }
  }

  const cancellationRequested = input.abortSignal.aborted
    || input.error?.message === 'user_cancelled'
    || input.error?.name === 'AbortError';
  const cancelled = cancellationRequested && !rollbackFailed;
  const safeCodes = new Set([
    'provider_unavailable',
    'provider_timeout',
    'provider_schema_invalid',
    'input_too_large',
  ]);
  await AcademicRuleExtractionRunV3.updateOne(
    { _id: input.runId, attemptId: input.attemptId, status: 'pending' },
    {
      $set: {
        status: cancelled ? 'cancelled' : 'failed',
        currentStage: cancelled ? 'cancelled' : 'failed',
        sanitizedErrorCode: rollbackFailed
          ? 'rollback_failed'
          : cancelled
            ? 'user_cancelled'
            : safeCodes.has(input.error?.message)
              ? input.error.message
              : 'extraction_failed',
        finishedAt: new Date(),
      },
    },
  );
  if (!cancelled) {
    logger.error('Rule V3 full extraction failed.', input.error, { runId: input.runId });
  }
}

function deduplicateRuleIds(ruleIds: mongoose.Types.ObjectId[]): mongoose.Types.ObjectId[] {
  return [...new Set(ruleIds.map(String))].map(ruleId => new mongoose.Types.ObjectId(ruleId));
}

async function loadEvidenceChunkIds(
  ruleIds: mongoose.Types.ObjectId[],
  sourceAliases: mongoose.Types.ObjectId[],
) {
  return ruleIds.length > 0
    ? KnowledgeRuleEvidenceV3.distinct('chunkId', {
      ruleId: { $in: ruleIds },
      sourceId: { $in: sourceAliases },
    })
    : [];
}

async function linkExtractedRulesToEvidenceGaps(
  runId: string,
  ruleIds: mongoose.Types.ObjectId[],
): Promise<void> {
  if (ruleIds.length === 0) return;
  const rules = await KnowledgeRuleV3.find({ _id: { $in: ruleIds } })
    .select(
      '_id ruleCode statement subject outcome conditions dreamFeatureTags '
      + 'status evidenceScore supportingSourceCount compositeComponents',
    )
    .lean();
  await linkOracleEvidenceGapCandidatesForRules(rules).catch((error) => {
    logger.warn('Could not link newly extracted Rule V3 candidates to Oracle evidence gaps.', {
      runId,
      errorName: error instanceof Error ? error.name : 'Error',
    });
  });
}
