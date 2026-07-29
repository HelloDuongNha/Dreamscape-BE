import crypto from 'crypto';
import mongoose from 'mongoose';
import { logger } from '../../../../infrastructure/logger';
import KnowledgeRuleV3 from '../../models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../models/KnowledgeRuleEvidence';
import { removeRuleV3SourceData } from '../lifecycle/ruleV3Lifecycle.service';
import { classifyRuleV3Relationship } from '../evidence/ruleV3Relationship.service';
import {
  backupRuleV3TouchedRule,
  markRuleV3MutationApplying,
  prepareRuleV3MutationJournal,
  registerRuleV3NewRule,
} from '../lifecycle/ruleV3ReplacementJournal.service';
import { scoreRuleV3 } from '../evidence/ruleV3Scoring.service';
import {
  MAX_RULE_V3_REJECTION_DIAGNOSTICS,
  RuleV3MutationContext,
  RuleV3PersistenceResult,
  RuleV3RawExtractionPlan,
  RuleV3RejectionDiagnostic,
} from './ruleV3FullExtraction.types';

interface RuleV3CandidatePersistenceInput {
  runId: string;
  attemptId: string;
  sourceId: string;
  sourceAliases: mongoose.Types.ObjectId[];
  raw: RuleV3RawExtractionPlan;
  mergedCandidates: Map<string, any>;
  replaceExisting: boolean;
  abortSignal: AbortSignal;
  mutation: RuleV3MutationContext;
  rejectedCandidateCount: number;
  rejectionDiagnostics: RuleV3RejectionDiagnostic[];
  onSavingStarted: () => Promise<unknown>;
}

export async function persistRuleV3Candidates(
  input: RuleV3CandidatePersistenceInput,
): Promise<RuleV3PersistenceResult> {
  await prepareMutation(input);
  await input.onSavingStarted();

  const chunkTextById = new Map(
    input.raw.chunks.map((chunk: any) => [String(chunk._id), String(chunk.text || '')]),
  );
  const comparableRules = await KnowledgeRuleV3.find({
    sourceLanguage: input.raw.profile.sourceLanguage,
    status: { $in: ['pending', 'verified'] },
  });
  const touchedExistingRuleBackups = new Set<string>();
  const resultRuleIds: mongoose.Types.ObjectId[] = [];
  let savedCandidateCount = 0;
  let mergedCandidateCount = 0;
  let rejectedCandidateCount = input.rejectedCandidateCount;

  for (const candidate of input.mergedCandidates.values()) {
    if (input.abortSignal.aborted) throw new Error('user_cancelled');

    let newlyCreatedRuleId: mongoose.Types.ObjectId | null = null;
    try {
      const existing = comparableRules.find(rule => rule.dedupKey === candidate.dedupKey)
        || comparableRules.find(rule => classifyRuleV3Relationship(rule, candidate) === 'equivalent');
      await backupExistingRule(input.mutation.journalId, existing, touchedExistingRuleBackups);
      const rule = existing || createPendingRule(input.raw, candidate);
      if (existing) mergeCandidateMetadata(rule, candidate);

      const evidenceWrites = buildEvidenceWrites(input, rule, candidate, chunkTextById);
      if (evidenceWrites.length === 0) throw new Error('candidate_has_no_persistable_evidence');

      if (!existing) {
        if (input.mutation.journalId) {
          await registerRuleV3NewRule(input.mutation.journalId, rule._id);
        }
        await rule.save();
        comparableRules.push(rule);
        newlyCreatedRuleId = rule._id;
      }
      for (const evidenceWrite of evidenceWrites) {
        await KnowledgeRuleEvidenceV3.updateOne(
          evidenceWrite.filter,
          evidenceWrite.update,
          { upsert: true },
        );
      }
      await updateRuleScore(rule);

      if (existing) mergedCandidateCount += 1;
      else savedCandidateCount += 1;
      resultRuleIds.push(rule._id);
    } catch (error: any) {
      await removeIncompleteNewRule(input.runId, newlyCreatedRuleId);
      rejectedCandidateCount += 1;
      appendPersistenceDiagnostic(input.rejectionDiagnostics, candidate);
      logger.warn('Rule V3 candidate rejected during persistence validation.', {
        runId: input.runId,
        dedupKey: candidate.dedupKey,
        errorName: error?.name || 'Error',
        validationPaths: error?.errors ? Object.keys(error.errors) : [],
      });
    }
  }

  return {
    resultRuleIds,
    savedCandidateCount,
    mergedCandidateCount,
    rejectedCandidateCount,
    rejectionDiagnostics: input.rejectionDiagnostics,
  };
}

async function prepareMutation(input: RuleV3CandidatePersistenceInput): Promise<void> {
  if (input.abortSignal.aborted) throw new Error('user_cancelled');
  if (input.mergedCandidates.size === 0) return;

  input.mutation.journalId = await prepareRuleV3MutationJournal({
    runId: input.runId,
    attemptId: input.attemptId,
    sourceId: input.sourceId,
    sourceAliases: input.sourceAliases,
    replaceExisting: input.replaceExisting,
  });
  await markRuleV3MutationApplying(input.mutation.journalId);
  if (input.replaceExisting) await removeRuleV3SourceData(input.sourceId);
}

async function backupExistingRule(
  journalId: string | null,
  existing: any,
  touchedRuleIds: Set<string>,
): Promise<void> {
  if (!existing || touchedRuleIds.has(String(existing._id))) return;
  touchedRuleIds.add(String(existing._id));
  if (journalId) await backupRuleV3TouchedRule(journalId, existing.toObject());
}

function createPendingRule(raw: RuleV3RawExtractionPlan, candidate: any) {
  return new KnowledgeRuleV3({
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
    version: 1,
  });
}

function mergeCandidateMetadata(rule: any, candidate: any): void {
  rule.conditions = [...new Set([...(rule.conditions || []), ...candidate.conditions])];
  rule.limitations = [...new Set([...(rule.limitations || []), ...candidate.limitations])];
  rule.dreamFeatureTags = [...new Set([...(rule.dreamFeatureTags || []), ...candidate.dreamFeatureTags])];
}

function buildEvidenceWrites(
  input: RuleV3CandidatePersistenceInput,
  rule: any,
  candidate: any,
  chunkTextById: Map<string, string>,
) {
  return candidate.evidence.flatMap((evidence: any) => {
    const chunkText = chunkTextById.get(String(evidence.chunkId));
    if (!chunkText) return [];
    const filter = {
      ruleId: rule._id,
      chunkId: new mongoose.Types.ObjectId(evidence.chunkId),
      chunkContentHash: sha256(chunkText),
      startOffset: evidence.startOffset,
      endOffset: evidence.endOffset,
      stance: evidence.stance,
    };
    const update = {
      $setOnInsert: {
        sourceId: new mongoose.Types.ObjectId(input.sourceId),
        extractionRunId: new mongoose.Types.ObjectId(input.runId),
        extractionAttemptId: input.attemptId,
        exactQuote: evidence.exactQuote,
        quoteHash: sha256(evidence.exactQuote),
        exactness: 'canonical_exact',
        verificationScore: 1,
        researchType: input.raw.profile.documentType,
        researchTypeConfidence: input.raw.profile.typeConfidence,
        sourceQuality: input.raw.approved?.sourceQuality,
      },
    };
    const validation = new KnowledgeRuleEvidenceV3({ ...filter, ...update.$setOnInsert }).validateSync();
    if (validation) throw validation;
    return [{ filter, update }];
  });
}

async function updateRuleScore(rule: any): Promise<void> {
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
}

async function removeIncompleteNewRule(
  runId: string,
  ruleId: mongoose.Types.ObjectId | null,
): Promise<void> {
  if (!ruleId) return;
  await KnowledgeRuleEvidenceV3.deleteMany({
    ruleId,
    extractionRunId: new mongoose.Types.ObjectId(runId),
  }).catch(() => undefined);
  await KnowledgeRuleV3.deleteOne({ _id: ruleId }).catch(() => undefined);
}

function appendPersistenceDiagnostic(
  diagnostics: RuleV3RejectionDiagnostic[],
  candidate: any,
): void {
  if (diagnostics.length >= MAX_RULE_V3_REJECTION_DIAGNOSTICS) return;
  diagnostics.push({
    batchId: 'persistence',
    reasonCode: 'candidate_persistence_invalid',
    safeMessage: 'Lập luận vượt qua kiểm chứng nhưng không đáp ứng hợp đồng lưu trữ.',
    proposedStatement: candidate.statement?.slice(0, 300),
  });
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
