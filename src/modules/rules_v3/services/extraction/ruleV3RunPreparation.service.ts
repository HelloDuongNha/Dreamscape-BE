import crypto from 'crypto';
import mongoose from 'mongoose';
import { calculateSourceContentHash } from '../../../academic/services/reader/canonicalReaderIdentity.service';
import AcademicRuleExtractionRunV3 from '../../models/AcademicRuleExtractionRun';
import KnowledgeRuleV3 from '../../models/KnowledgeRule';
import { resolveRuleV3SourceAliases } from '../lifecycle/ruleV3Lifecycle.service';
import type { RuleV3GenerationProvider } from '../providers/ruleV3GenerationProvider.types';
import { buildRuleV3PlanPreviewRaw } from '../planning/ruleV3PlanPreview.service';
import { RULE_V3_SCORING_VERSION } from '../evidence/ruleV3Scoring.service';
import {
  MAX_RULE_V3_REJECTION_DIAGNOSTICS,
  RuleV3RawExtractionPlan,
} from './ruleV3FullExtraction.types';

const ENGINE_VERSION = 'rule-v3-full-4';
const PROMPT_VERSION = 'rule-v3-evidence-ref-2';
const MAX_ATTEMPT_HISTORY = 10;

interface RuleV3RunPreparationInput {
  inputId: string;
  provider: RuleV3GenerationProvider;
  replaceExisting: boolean;
  isAttemptActive: (runId: string, attemptId: string) => boolean;
}

export type RuleV3RunPreparationResult =
  | {
    kind: 'reused';
    runId: string;
    status: 'pending' | 'success';
  }
  | {
    kind: 'started';
    runId: string;
    attemptId: string;
    sourceId: string;
    sourceAliases: mongoose.Types.ObjectId[];
    raw: RuleV3RawExtractionPlan;
  };

export async function prepareRuleV3ExtractionRun(
  input: RuleV3RunPreparationInput,
): Promise<RuleV3RunPreparationResult> {
  const raw = await buildRuleV3PlanPreviewRaw(input.inputId);
  const sourceId = String(raw.approved?._id || raw.contribution?._id || input.inputId);
  const fingerprint = buildRunFingerprint(sourceId, raw, input.provider);
  const previousRun = await AcademicRuleExtractionRunV3.findOne(fingerprint).lean();
  const sourceAliases = await resolveRuleV3SourceAliases(sourceId);

  const reusable = await findReusableRun(previousRun, input.replaceExisting, input.isAttemptActive);
  if (reusable) return reusable;

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
        attemptHistory: buildAttemptHistory(previousRun, input.replaceExisting),
        rejectionDiagnostics: [],
        resultRuleIds: [],
        startedAt: new Date(),
        sanitizedErrorCode: undefined,
        finishedAt: undefined,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return {
    kind: 'started',
    runId: String(run._id),
    attemptId,
    sourceId,
    sourceAliases,
    raw,
  };
}

function buildRunFingerprint(
  sourceId: string,
  raw: RuleV3RawExtractionPlan,
  provider: RuleV3GenerationProvider,
) {
  return {
    academicSourceId: new mongoose.Types.ObjectId(sourceId),
    sourceContentHash: calculateSourceContentHash(raw.chunks),
    extractionEngineVersion: ENGINE_VERSION,
    generationModel: `${provider.name}:${provider.modelName}`,
    promptVersion: PROMPT_VERSION,
    scoringFormulaVersion: RULE_V3_SCORING_VERSION,
  };
}

async function findReusableRun(
  previousRun: any,
  replaceExisting: boolean,
  isAttemptActive: RuleV3RunPreparationInput['isAttemptActive'],
): Promise<Extract<RuleV3RunPreparationResult, { kind: 'reused' }> | null> {
  if (previousRun?.status === 'pending') {
    const runId = String(previousRun._id);
    const attemptId = String(previousRun.attemptId || '');
    if (attemptId && isAttemptActive(runId, attemptId)) {
      return { kind: 'reused', runId, status: 'pending' };
    }
    return null;
  }
  if (replaceExisting || previousRun?.status !== 'success') return null;

  const resultIds = previousRun.resultRuleIds || [];
  const honestEmptyResult = previousRun.verifiedCandidateCount === 0 && resultIds.length === 0;
  const persistedResultCount = resultIds.length > 0
    ? await KnowledgeRuleV3.countDocuments({ _id: { $in: resultIds } })
    : 0;
  const completeResult = resultIds.length > 0 && persistedResultCount === resultIds.length;
  return honestEmptyResult || completeResult
    ? { kind: 'reused', runId: String(previousRun._id), status: 'success' }
    : null;
}

function buildAttemptHistory(previousRun: any, replaceExisting: boolean): any[] {
  const previousSnapshot = replaceExisting ? toAttemptSnapshot(previousRun) : null;
  return [
    ...((previousRun?.attemptHistory || []) as any[]),
    ...(previousSnapshot ? [previousSnapshot] : []),
  ].slice(-MAX_ATTEMPT_HISTORY);
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
    rejectionDiagnostics: (run.rejectionDiagnostics || [])
      .slice(0, MAX_RULE_V3_REJECTION_DIAGNOSTICS),
  };
}
