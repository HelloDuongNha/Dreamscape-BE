import crypto from 'crypto';
import mongoose from 'mongoose';
import AcademicRuleExtractionRunV3 from '../../models/rulesV3/AcademicRuleExtractionRun';
import KnowledgeRuleV3 from '../../models/rulesV3/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../models/rulesV3/KnowledgeRuleEvidence';
import OracleEvidenceGap from '../../models/OracleEvidenceGap';
import { buildRuleV3PlanPreviewRaw } from './ruleV3PlanPreview.service';
import { extractRuleV3Candidates } from './ruleV3Extractor.service';
import { calculateSourceContentHash } from '../academic/reader/canonicalReaderIdentity.service';
import type { RuleV3GenerationProvider } from './ruleV3GenerationProvider.types';
import { logger } from '../infrastructure/logger';
import { RULE_V3_SCORING_VERSION, scoreRuleV3 } from './ruleV3Scoring.service';
import { classifyRuleV3Relationship } from './ruleV3Relationship.service';
import { removeRuleV3SourceData, resolveRuleV3SourceAliases } from './ruleV3Lifecycle.service';
import {
  linkOracleEvidenceGapCandidatesForRules,
  localizeOracleEvidenceClaim,
} from '../oracle/oracleEvidenceGap.service';
import {
  backupRuleV3TouchedRule,
  commitRuleV3MutationJournal,
  isRuleV3MutationCommitted,
  markRuleV3MutationApplying,
  prepareRuleV3MutationJournal,
  registerRuleV3NewRule,
  rollbackRuleV3MutationJournal,
} from './ruleV3ReplacementJournal.service';

const ENGINE_VERSION = 'rule-v3-full-3';
const PROMPT_VERSION = 'rule-v3-evidence-ref-2';
const SCORING_VERSION = RULE_V3_SCORING_VERSION;
const activeRuns = new Map<string, { task: Promise<void>; controller: AbortController }>();
const MAX_ATTEMPT_HISTORY = 10;
const MAX_REJECTION_DIAGNOSTICS = 50;

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function candidateDedupKey(candidate: {
  claimType: string;
  effectPolarity: string;
  evidenceInterpretation: string;
  subject: string;
  outcome: string;
  conditions: string[];
}): string {
  const conditions = [...new Set(candidate.conditions.map(normalize))].sort();
  return sha256([
    candidate.claimType,
    candidate.effectPolarity,
    candidate.evidenceInterpretation,
    normalize(candidate.subject),
    normalize(candidate.outcome),
    conditions.join('|')
  ].join('\n'));
}

export interface RuleV3FullRunStartResult {
  runId: string;
  reused: boolean;
  status: 'pending' | 'success';
}

export interface RuleV3FullRunOptions {
  replaceExisting?: boolean;
}

function toAttemptSnapshot(run: any) {
  if (!run?.startedAt || !['success', 'failed', 'cancelled'].includes(run.status)) return null;
  const finishedAt = run.finishedAt ? new Date(run.finishedAt) : undefined;
  const startedAt = new Date(run.startedAt);
  return {
    status: run.status,
    startedAt,
    finishedAt,
    durationMs: finishedAt ? Math.max(0, finishedAt.getTime() - startedAt.getTime()) : undefined,
    generationModel: run.generationModel,
    targetChunkCount: Number.isFinite(run.targetChunkCount) ? run.targetChunkCount : undefined,
    evidenceChunkCount: Number.isFinite(run.evidenceChunkCount) ? run.evidenceChunkCount : undefined,
    totalBatches: run.totalBatches || 0,
    processedBatches: run.processedBatches || 0,
    rawCandidateCount: run.rawCandidateCount || 0,
    verifiedCandidateCount: run.verifiedCandidateCount || 0,
    savedCandidateCount: run.savedCandidateCount || 0,
    mergedCandidateCount: run.mergedCandidateCount || 0,
    rejectedCandidateCount: run.rejectedCandidateCount || 0,
    sanitizedErrorCode: run.sanitizedErrorCode,
    rejectionDiagnostics: (run.rejectionDiagnostics || []).slice(0, MAX_REJECTION_DIAGNOSTICS)
  };
}

async function updateAttemptRun(runId: string, attemptId: string, update: Record<string, unknown>) {
  const run = await AcademicRuleExtractionRunV3.findOneAndUpdate(
    { _id: runId, attemptId, status: 'pending' },
    update,
    { new: true },
  );
  if (!run) throw new Error('attempt_superseded');
  return run;
}

export async function startRuleV3FullExtraction(
  inputId: string,
  provider: RuleV3GenerationProvider,
  options: RuleV3FullRunOptions = {}
): Promise<RuleV3FullRunStartResult> {
  const raw = await buildRuleV3PlanPreviewRaw(inputId);
  const sourceId = String(raw.approved?._id || raw.contribution?._id || inputId);
  const sourceContentHash = calculateSourceContentHash(raw.chunks);
  const fingerprint = {
    academicSourceId: new mongoose.Types.ObjectId(sourceId),
    sourceContentHash,
    extractionEngineVersion: ENGINE_VERSION,
    generationModel: `${provider.name}:${provider.modelName}`,
    promptVersion: PROMPT_VERSION,
    scoringFormulaVersion: SCORING_VERSION
  };

  let previousRun = await AcademicRuleExtractionRunV3.findOne(fingerprint).lean();
  const sourceAliases = await resolveRuleV3SourceAliases(sourceId);
  if (previousRun?.status === 'pending') {
    const previousAttemptId = String(previousRun.attemptId || '');
    if (!previousAttemptId || activeRuns.has(`${String(previousRun._id)}:${previousAttemptId}`)) {
      return { runId: String(previousRun._id), reused: true, status: 'pending' };
    }
    // A pending run without a local controller may belong to another API
    // instance. Do not steal or roll it back from a request handler.
    return { runId: String(previousRun._id), reused: true, status: 'pending' };
  }
  const completed = options.replaceExisting || previousRun?.status !== 'success' ? null : previousRun;
  if (completed) {
    const resultIds = completed.resultRuleIds || [];
    const isHonestEmptyResult = completed.verifiedCandidateCount === 0 && resultIds.length === 0;
    const persistedResultCount = resultIds.length > 0
      ? await KnowledgeRuleV3.countDocuments({ _id: { $in: resultIds } })
      : 0;
    if (isHonestEmptyResult || (resultIds.length > 0 && persistedResultCount === resultIds.length)) {
      return { runId: String(completed._id), reused: true, status: 'success' };
    }
  }

  const previousSnapshot = options.replaceExisting ? toAttemptSnapshot(previousRun) : null;
  const attemptHistory = [
    ...((previousRun?.attemptHistory || []) as any[]),
    ...(previousSnapshot ? [previousSnapshot] : [])
  ].slice(-MAX_ATTEMPT_HISTORY);

  const attemptId = crypto.randomUUID();
  const run = await AcademicRuleExtractionRunV3.findOneAndUpdate(
    fingerprint,
    {
      $set: {
        attemptId,
        status: 'pending',
        currentStage: 'initializing',
        totalBatches: raw.evidencePlan.batches.length,
        processedBatches: 0,
        rawCandidateCount: 0,
        verifiedCandidateCount: 0,
        savedCandidateCount: 0,
        mergedCandidateCount: 0,
        rejectedCandidateCount: 0,
        targetChunkCount: raw.evidencePlan.diagnostics.targetChunkCount,
        evidenceChunkCount: 0,
        attemptHistory,
        rejectionDiagnostics: [],
        resultRuleIds: [],
        startedAt: new Date(),
        sanitizedErrorCode: undefined,
        finishedAt: undefined
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const runId = String(run._id);
  const activeKey = `${runId}:${attemptId}`;
  if (!activeRuns.has(activeKey)) {
    const controller = new AbortController();
    const task = executeRuleV3FullExtraction(
      runId,
      attemptId,
      sourceId,
      sourceAliases,
      raw,
      provider,
      options.replaceExisting === true,
      controller.signal,
    ).finally(() => activeRuns.delete(activeKey));
    activeRuns.set(activeKey, { task, controller });
  }
  return { runId, reused: false, status: 'pending' };
}

async function executeRuleV3FullExtraction(
  runId: string,
  attemptId: string,
  sourceId: string,
  sourceAliases: mongoose.Types.ObjectId[],
  raw: Awaited<ReturnType<typeof buildRuleV3PlanPreviewRaw>>,
  provider: RuleV3GenerationProvider,
  replaceExisting: boolean,
  abortSignal: AbortSignal,
): Promise<void> {
  let mutationJournalId: string | null = null;
  let mutationRolledBack = false;
  const newlyCreatedRuleIds: mongoose.Types.ObjectId[] = [];
  const touchedExistingRuleBackups = new Map<string, any>();
  try {
    await updateAttemptRun(runId, attemptId, {
      currentStage: 'extracting_candidates',
      processedBatches: 0,
      rawCandidateCount: 0,
      verifiedCandidateCount: 0,
      savedCandidateCount: 0,
      mergedCandidateCount: 0,
      rejectedCandidateCount: 0
    });

    const workUnitByBatch = new Map<string, any>();
    for (const unit of raw.hierarchicalPlan.workUnits) {
      for (const batchId of unit.batchIds) workUnitByBatch.set(batchId, unit);
    }

    const chunkTextById = new Map(raw.chunks.map((chunk: any) => [String(chunk._id), String(chunk.text || '')]));
    const merged = new Map<string, any>();
    let rawCount = 0;
    let rejectedCount = 0;
    let processed = 0;
    const rejectionDiagnostics: Array<{
      batchId: string;
      reasonCode: string;
      safeMessage: string;
      proposedStatement?: string;
    }> = [];

    for (const batch of raw.evidencePlan.batches) {
      if (abortSignal.aborted) throw new Error('user_cancelled');
      const unit = workUnitByBatch.get(batch.batchId);
      if (!unit) continue;
      const oneBatchUnit = { ...unit, batchIds: [batch.batchId], batchCount: 1 };
      const oneBatchHierarchy = { ...raw.hierarchicalPlan, workUnits: [oneBatchUnit] };
      let result;
      try {
        result = await extractRuleV3Candidates(
          raw.profile,
          raw.extractionPlan,
          raw.evidencePlan,
          oneBatchHierarchy,
          {
            documentId: String(raw.document._id),
            parserEngine: raw.document.parserEngine || 'unknown',
            documentUpdatedAt: raw.document.updatedAt ? new Date(raw.document.updatedAt).toISOString() : null,
            sectionCount: raw.sections.length,
            readerChunkCount: raw.chunks.length
          },
          unit.workUnitId,
          provider,
          abortSignal,
        );
      } catch (error: any) {
        if (error?.message !== 'provider_schema_invalid') throw error;
        rejectedCount += 1;
        if (rejectionDiagnostics.length < MAX_REJECTION_DIAGNOSTICS) {
          rejectionDiagnostics.push({
            batchId: batch.batchId,
            reasonCode: 'provider_schema_invalid',
            safeMessage: 'Mô hình trả về lập luận không đúng cấu trúc bắt buộc.'
          });
        }
        processed += 1;
        logger.warn('Rule V3 batch rejected because provider output violated the schema.', {
          runId,
          batchId: batch.batchId
        });
        await updateAttemptRun(runId, attemptId, {
          processedBatches: processed,
          rejectedCandidateCount: rejectedCount,
          rejectionDiagnostics
        });
        continue;
      }

      rawCount += result.diagnostics.rawCandidateCount;
      rejectedCount += result.diagnostics.rejectedCandidateCount;
      for (const rejected of result.rejectedCandidates) {
        if (rejectionDiagnostics.length >= MAX_REJECTION_DIAGNOSTICS) break;
        rejectionDiagnostics.push({
          batchId: batch.batchId,
          reasonCode: rejected.reasonCode,
          safeMessage: rejected.safeMessage,
          proposedStatement: rejected.proposedStatement?.slice(0, 300)
        });
      }
      for (const candidate of result.citationVerifiedCandidates) {
        const key = candidateDedupKey(candidate);
        const existing = merged.get(key) || [...merged.values()].find(item =>
          classifyRuleV3Relationship(item, candidate) === 'equivalent'
        );
        if (!existing) {
          merged.set(key, { ...candidate, dedupKey: key, evidence: [...candidate.evidence] });
          continue;
        }
        for (const evidence of candidate.evidence) {
          const span = `${evidence.chunkId}:${evidence.startOffset}:${evidence.endOffset}:${evidence.stance}`;
          if (!existing.evidence.some((item: any) => `${item.chunkId}:${item.startOffset}:${item.endOffset}:${item.stance}` === span)) {
            existing.evidence.push(evidence);
          }
        }
        existing.dreamFeatureTags = [...new Set([...existing.dreamFeatureTags, ...candidate.dreamFeatureTags])];
        existing.conditions = [...new Set([...existing.conditions, ...candidate.conditions])];
        existing.limitations = [...new Set([...existing.limitations, ...candidate.limitations])];
      }

      processed += 1;
      await updateAttemptRun(runId, attemptId, {
        processedBatches: processed,
        rawCandidateCount: rawCount,
        verifiedCandidateCount: merged.size,
        rejectedCandidateCount: rejectedCount,
        rejectionDiagnostics
      });
    }

    if (abortSignal.aborted) throw new Error('user_cancelled');
    if (merged.size > 0) {
      mutationJournalId = await prepareRuleV3MutationJournal({
        runId,
        attemptId,
        sourceId,
        sourceAliases,
        replaceExisting,
      });
      await markRuleV3MutationApplying(mutationJournalId);
      if (replaceExisting) await removeRuleV3SourceData(sourceId);
    }
    await updateAttemptRun(runId, attemptId, { currentStage: 'saving_candidates' });
    const resultRuleIds: mongoose.Types.ObjectId[] = [];
    let savedCount = 0;
    let mergedCount = 0;
    const comparableRules = await KnowledgeRuleV3.find({
      sourceLanguage: raw.profile.sourceLanguage,
      status: { $in: ['pending', 'verified'] }
    });

    for (const candidate of merged.values()) {
      if (abortSignal.aborted) throw new Error('user_cancelled');
      let newlyCreatedRuleId: mongoose.Types.ObjectId | null = null;
      try {
        const existing = comparableRules.find(rule => rule.dedupKey === candidate.dedupKey)
          || comparableRules.find(rule => classifyRuleV3Relationship(rule, candidate) === 'equivalent');
        if (existing && !touchedExistingRuleBackups.has(String(existing._id))) {
          touchedExistingRuleBackups.set(String(existing._id), existing.toObject());
          if (mutationJournalId) {
            await backupRuleV3TouchedRule(mutationJournalId, existing.toObject());
          }
        }
        const rule = existing || new KnowledgeRuleV3({
          status: 'pending',
          sourceLanguage: raw.profile.sourceLanguage,
          statement: candidate.statement,
          claimType: candidate.claimType,
          effectPolarity: candidate.effectPolarity,
          evidenceInterpretation: candidate.evidenceInterpretation,
          subject: candidate.subject,
          outcome: candidate.outcome,
          conditions: candidate.conditions,
          limitations: candidate.limitations,
          dreamFeatureTags: candidate.dreamFeatureTags,
          classifications: [],
          dedupKey: candidate.dedupKey,
          evidenceScore: 0,
          certaintyTier: 'weak',
          supportingSourceCount: 0,
          contradictingSourceCount: 0,
          version: 1
        });
        if (existing) {
          rule.conditions = [...new Set([...(rule.conditions || []), ...candidate.conditions])];
          rule.limitations = [...new Set([...(rule.limitations || []), ...candidate.limitations])];
          rule.dreamFeatureTags = [...new Set([...(rule.dreamFeatureTags || []), ...candidate.dreamFeatureTags])];
        }
        const evidenceWrites: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
        for (const evidence of candidate.evidence) {
          const chunkText = chunkTextById.get(String(evidence.chunkId));
          if (!chunkText) continue;
          const chunkContentHash = sha256(chunkText);
          const quoteHash = sha256(evidence.exactQuote);
          const filter = {
              ruleId: rule._id,
              chunkId: new mongoose.Types.ObjectId(evidence.chunkId),
              chunkContentHash,
              startOffset: evidence.startOffset,
              endOffset: evidence.endOffset,
              stance: evidence.stance
          };
          const update = {
              $setOnInsert: {
                sourceId: new mongoose.Types.ObjectId(sourceId),
                extractionRunId: new mongoose.Types.ObjectId(runId),
                extractionAttemptId: attemptId,
                exactQuote: evidence.exactQuote,
                quoteHash,
                exactness: 'canonical_exact',
                verificationScore: 1,
                researchType: raw.profile.documentType,
                researchTypeConfidence: raw.profile.typeConfidence,
                sourceQuality: raw.approved?.sourceQuality
              }
          };
          const validation = new KnowledgeRuleEvidenceV3({ ...filter, ...update.$setOnInsert }).validateSync();
          if (validation) throw validation;
          evidenceWrites.push({ filter, update });
        }
        if (evidenceWrites.length === 0) throw new Error('candidate_has_no_persistable_evidence');

        if (!existing) {
          if (mutationJournalId) await registerRuleV3NewRule(mutationJournalId, rule._id);
          await rule.save();
          comparableRules.push(rule);
          newlyCreatedRuleId = rule._id;
          newlyCreatedRuleIds.push(rule._id);
        }
        for (const evidenceWrite of evidenceWrites) {
          await KnowledgeRuleEvidenceV3.updateOne(evidenceWrite.filter, evidenceWrite.update, { upsert: true });
        }
        const persistedEvidence = await KnowledgeRuleEvidenceV3.find({ ruleId: rule._id }).lean();
        const score = scoreRuleV3(rule, persistedEvidence);
        rule.sourceEvidenceScore = score.evidenceScore;
        rule.evidenceScore = Math.max(
          0,
          Math.min(100, score.evidenceScore + (Number(rule.userValidationAdjustment) || 0)),
        );
        rule.certaintyTier = rule.evidenceScore >= 85
          ? 'strong'
          : rule.evidenceScore >= 65
            ? 'moderate'
            : rule.evidenceScore >= 45
              ? 'limited'
              : 'weak';
        rule.supportingSourceCount = score.supportingSourceCount;
        rule.contradictingSourceCount = score.contradictingSourceCount;
        await rule.save();
        if (existing) mergedCount += 1;
        else savedCount += 1;
        resultRuleIds.push(rule._id);
      } catch (error: any) {
        if (newlyCreatedRuleId) {
          await KnowledgeRuleEvidenceV3.deleteMany({
            ruleId: newlyCreatedRuleId,
            extractionRunId: new mongoose.Types.ObjectId(runId)
          }).catch(() => undefined);
          await KnowledgeRuleV3.deleteOne({ _id: newlyCreatedRuleId }).catch(() => undefined);
        }
        rejectedCount += 1;
        if (rejectionDiagnostics.length < MAX_REJECTION_DIAGNOSTICS) {
          rejectionDiagnostics.push({
            batchId: 'persistence',
            reasonCode: 'candidate_persistence_invalid',
            safeMessage: 'Lập luận vượt qua kiểm chứng nhưng không đáp ứng hợp đồng lưu trữ.',
            proposedStatement: candidate.statement?.slice(0, 300)
          });
        }
        logger.warn('Rule V3 candidate rejected during persistence validation.', {
          runId,
          dedupKey: candidate.dedupKey,
          errorName: error?.name || 'Error',
          validationPaths: error?.errors ? Object.keys(error.errors) : []
        });
      }
    }

    const allVerifiedCandidatesRejected = merged.size > 0 && resultRuleIds.length === 0;
    const incompleteMutation = merged.size > 0 && resultRuleIds.length !== merged.size;
    if ((allVerifiedCandidatesRejected || incompleteMutation) && mutationJournalId) {
      await rollbackRuleV3MutationJournal(mutationJournalId);
      mutationRolledBack = true;
    }
    const mutationFailed = allVerifiedCandidatesRejected || incompleteMutation;
    const finalRuleIds = mutationFailed ? [] : resultRuleIds;
    const evidenceChunkIds = finalRuleIds.length > 0
      ? await KnowledgeRuleEvidenceV3.distinct('chunkId', {
        ruleId: { $in: finalRuleIds },
        sourceId: { $in: sourceAliases }
      })
      : [];
    if (abortSignal.aborted) throw new Error('user_cancelled');
    if (!mutationFailed && mutationJournalId) {
      await commitRuleV3MutationJournal(mutationJournalId);
    }
    await updateAttemptRun(runId, attemptId, {
      status: mutationFailed ? 'failed' : 'success',
      currentStage: mutationFailed ? 'failed' : 'completed',
      processedBatches: raw.evidencePlan.batches.length,
      verifiedCandidateCount: merged.size,
      savedCandidateCount: mutationFailed ? 0 : savedCount,
      mergedCandidateCount: mutationFailed ? 0 : mergedCount,
      rejectedCandidateCount: rejectedCount,
      rejectionDiagnostics,
      evidenceChunkCount: evidenceChunkIds.length,
      resultRuleIds: finalRuleIds,
      sanitizedErrorCode: mutationFailed
        ? (incompleteMutation ? 'candidate_persistence_incomplete' : 'all_verified_candidates_rejected')
      : undefined,
      finishedAt: new Date()
    });
    if (finalRuleIds.length > 0) {
      const extractedRules = await KnowledgeRuleV3.find({ _id: { $in: finalRuleIds } })
        .select('_id statement subject outcome status evidenceScore supportingSourceCount')
        .lean();
      await linkOracleEvidenceGapCandidatesForRules(extractedRules).catch((error) => {
        logger.warn('Could not link newly extracted Rule V3 candidates to Oracle evidence gaps.', {
          runId,
          errorName: error instanceof Error ? error.name : 'Error',
        });
      });
    }
  } catch (error: any) {
    let rollbackFailed = false;
    if (mutationJournalId && !mutationRolledBack) {
      try {
        await rollbackRuleV3MutationJournal(mutationJournalId);
        mutationRolledBack = true;
      } catch (restoreError: any) {
        rollbackFailed = true;
        logger.error('Rule V3 mutation rollback failed.', restoreError, { runId, attemptId });
      }
    }
    const cancellationRequested = abortSignal.aborted || error?.message === 'user_cancelled' || error?.name === 'AbortError';
    const cancelled = cancellationRequested && !rollbackFailed;
    const safeCodes = new Set(['provider_unavailable', 'provider_timeout', 'provider_schema_invalid', 'input_too_large']);
    await AcademicRuleExtractionRunV3.updateOne(
      { _id: runId, attemptId, status: 'pending' },
      {
        $set: {
          status: cancelled ? 'cancelled' : 'failed',
          currentStage: cancelled ? 'cancelled' : 'failed',
          sanitizedErrorCode: rollbackFailed
            ? 'rollback_failed'
            : cancelled
              ? 'user_cancelled'
              : safeCodes.has(error?.message)
                ? error.message
                : 'extraction_failed',
          finishedAt: new Date()
        }
      },
    );
    if (!cancelled) logger.error('Rule V3 full extraction failed.', error, { runId });
  }
}

export async function cancelRuleV3FullExtraction(runId: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(runId)) return false;
  const run = await AcademicRuleExtractionRunV3.findById(runId).select('status attemptId');
  if (!run || run.status !== 'pending') return false;
  const attemptId = String(run.attemptId || '');
  const active = activeRuns.get(`${runId}:${attemptId}`);
  active?.controller.abort();
  if (active) {
    await active.task;
  } else if (attemptId) {
    await rollbackRuleV3MutationJournal(attemptId, { markRunCancelled: true });
  }
  if (attemptId && await isRuleV3MutationCommitted(attemptId)) return false;
  let finalRun = await AcademicRuleExtractionRunV3.findOne({ _id: runId, attemptId }).select('status');
  if (finalRun?.status === 'success') return false;
  await AcademicRuleExtractionRunV3.updateOne(
    { _id: runId, attemptId, status: 'pending' },
    {
      $set: {
        status: 'cancelled',
        currentStage: 'cancelled',
        sanitizedErrorCode: 'user_cancelled',
        finishedAt: new Date(),
      },
    },
  );
  finalRun = await AcademicRuleExtractionRunV3.findOne({ _id: runId, attemptId }).select('status');
  return finalRun?.status === 'cancelled';
}

export async function getRuleV3FullRun(runId: string) {
  if (!mongoose.Types.ObjectId.isValid(runId)) return null;
  return AcademicRuleExtractionRunV3.findById(runId).lean();
}

export async function getRuleV3SourceSummary(inputId: string) {
  if (!mongoose.Types.ObjectId.isValid(inputId)) throw new Error('invalid_source_id');
  const sourceAliases = await resolveRuleV3SourceAliases(inputId);
  const ruleIds = await KnowledgeRuleEvidenceV3.distinct('ruleId', { sourceId: { $in: sourceAliases } });
  const statusRows = ruleIds.length > 0
    ? await KnowledgeRuleV3.aggregate<{ _id: string; count: number }>([
      { $match: { _id: { $in: ruleIds } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ])
    : [];
  const counts = { pending: 0, verified: 0, rejected: 0, retired: 0 };
  for (const row of statusRows) {
    if (row._id in counts) counts[row._id as keyof typeof counts] = row.count;
  }
  const evidenceGapRows = ruleIds.length > 0
    ? await OracleEvidenceGap.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          $or: [
            { candidateRuleIds: { $in: ruleIds } },
            { resolvedRuleIds: { $in: ruleIds } },
          ],
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
    : [];
  const evidenceGapMatches = { candidateFound: 0, resolved: 0 };
  for (const row of evidenceGapRows) {
    if (row._id === 'candidate_found') evidenceGapMatches.candidateFound = row.count;
    if (row._id === 'resolved') evidenceGapMatches.resolved = row.count;
  }
  const sourceRuleIdSet = new Set(ruleIds.map(ruleId => String(ruleId)));
  const evidenceGapDocuments = ruleIds.length > 0
    ? await OracleEvidenceGap.find({
      $or: [
        { candidateRuleIds: { $in: ruleIds } },
        { resolvedRuleIds: { $in: ruleIds } },
      ],
    })
      .select('claim status occurrenceCount candidateRuleIds resolvedRuleIds updatedAt')
      .sort({ status: 1, updatedAt: -1 })
      .limit(100)
      .lean()
    : [];
  const matchedRuleIds = [...new Set(evidenceGapDocuments.flatMap(gap => [
    ...(gap.candidateRuleIds || []),
    ...(gap.resolvedRuleIds || []),
  ].map(ruleId => String(ruleId)).filter(ruleId => sourceRuleIdSet.has(ruleId))))];
  const matchedRules = matchedRuleIds.length > 0
    ? await KnowledgeRuleV3.find({ _id: { $in: matchedRuleIds } })
      .select('ruleCode statement status evidenceScore')
      .lean()
    : [];
  const matchedRuleById = new Map(matchedRules.map(rule => [String(rule._id), rule]));
  const evidenceGapDetails = evidenceGapDocuments.map(gap => {
    const resolvedIds = new Set((gap.resolvedRuleIds || []).map(ruleId => String(ruleId)));
    const relevantRuleIds = [...new Set([
      ...(gap.candidateRuleIds || []),
      ...(gap.resolvedRuleIds || []),
    ].map(ruleId => String(ruleId)).filter(ruleId => sourceRuleIdSet.has(ruleId)))];
    return {
      gapId: String(gap._id),
      claim: gap.claim,
      localizedClaim: localizeOracleEvidenceClaim(String(gap.claim || '')),
      status: gap.status,
      occurrenceCount: gap.occurrenceCount || 1,
      rules: relevantRuleIds.flatMap(ruleId => {
        const rule = matchedRuleById.get(ruleId);
        return rule ? [{
          ruleId,
          ruleCode: rule.ruleCode,
          statement: rule.statement,
          status: rule.status,
          evidenceScore: rule.evidenceScore,
          resolutionRole: resolvedIds.has(ruleId) ? 'resolved' : 'candidate',
        }] : [];
      }),
    };
  }).filter(item => item.rules.length > 0);

  const runDocuments = await AcademicRuleExtractionRunV3.find({ academicSourceId: { $in: sourceAliases } })
    .sort({ startedAt: -1 })
    .limit(10)
    .lean();
  const latestRun = runDocuments[0] || null;
  const evidenceChunkIds = latestRun
    ? await KnowledgeRuleEvidenceV3.distinct('chunkId', {
      extractionRunId: latestRun._id,
      sourceId: { $in: sourceAliases }
    })
    : [];
  const durationMs = latestRun?.finishedAt && latestRun?.startedAt
    ? Math.max(0, new Date(latestRun.finishedAt).getTime() - new Date(latestRun.startedAt).getTime())
    : null;

  const runHistory = runDocuments.flatMap(run => {
    const current = [{
      runId: String(run._id),
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt || null,
      durationMs: run.finishedAt && run.startedAt
        ? Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())
        : null,
      generationModel: run.generationModel,
      targetChunkCount: Number.isFinite(run.targetChunkCount) ? run.targetChunkCount : null,
      evidenceChunkCount: Number.isFinite(run.evidenceChunkCount)
        ? run.evidenceChunkCount
        : (String(run._id) === String(latestRun?._id) ? evidenceChunkIds.length : null),
      totalBatches: run.totalBatches,
      processedBatches: run.processedBatches,
      rawCandidateCount: run.rawCandidateCount,
      verifiedCandidateCount: run.verifiedCandidateCount,
      savedCandidateCount: run.savedCandidateCount,
      mergedCandidateCount: run.mergedCandidateCount,
      rejectedCandidateCount: run.rejectedCandidateCount,
      sanitizedErrorCode: run.sanitizedErrorCode || null,
      rejectionDiagnostics: run.rejectionDiagnostics || []
    }];
    const archived = (run.attemptHistory || []).map((attempt: any, index: number) => ({
      runId: `${String(run._id)}:history:${index}`,
      status: attempt.status,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt || null,
      durationMs: Number.isFinite(attempt.durationMs) ? attempt.durationMs : null,
      generationModel: attempt.generationModel,
      targetChunkCount: Number.isFinite(attempt.targetChunkCount) ? attempt.targetChunkCount : null,
      evidenceChunkCount: Number.isFinite(attempt.evidenceChunkCount) ? attempt.evidenceChunkCount : null,
      totalBatches: attempt.totalBatches,
      processedBatches: attempt.processedBatches,
      rawCandidateCount: attempt.rawCandidateCount,
      verifiedCandidateCount: attempt.verifiedCandidateCount,
      savedCandidateCount: attempt.savedCandidateCount,
      mergedCandidateCount: attempt.mergedCandidateCount,
      rejectedCandidateCount: attempt.rejectedCandidateCount,
      sanitizedErrorCode: attempt.sanitizedErrorCode || null,
      rejectionDiagnostics: attempt.rejectionDiagnostics || []
    }));
    return [...current, ...archived];
  }).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, 10);

  return {
    counts,
    evidenceGapMatches,
    evidenceGapDetails,
    totalRuleCount: counts.pending + counts.verified + counts.rejected + counts.retired,
    runHistory,
    latestRun: latestRun ? {
      runId: String(latestRun._id),
      status: latestRun.status,
      startedAt: latestRun.startedAt,
      finishedAt: latestRun.finishedAt || null,
      durationMs,
      generationModel: latestRun.generationModel,
      targetChunkCount: Number.isFinite(latestRun.targetChunkCount) ? latestRun.targetChunkCount : null,
      evidenceChunkCount: Number.isFinite(latestRun.evidenceChunkCount) ? latestRun.evidenceChunkCount : evidenceChunkIds.length,
      totalBatches: latestRun.totalBatches,
      processedBatches: latestRun.processedBatches,
      rawCandidateCount: latestRun.rawCandidateCount,
      verifiedCandidateCount: latestRun.verifiedCandidateCount,
      savedCandidateCount: latestRun.savedCandidateCount,
      mergedCandidateCount: latestRun.mergedCandidateCount,
      rejectedCandidateCount: latestRun.rejectedCandidateCount,
      sanitizedErrorCode: latestRun.sanitizedErrorCode || null,
      rejectionDiagnostics: latestRun.rejectionDiagnostics || []
    } : null
  };
}
