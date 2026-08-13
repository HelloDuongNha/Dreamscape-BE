import mongoose from 'mongoose';
import AcademicRuleExtractionRunV3 from '../../models/AcademicRuleExtractionRun';
import KnowledgeRuleV3 from '../../models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../models/KnowledgeRuleEvidence';
import RuleV3ReplacementBackupItem from '../../models/RuleV3ReplacementBackupItem';
import RuleV3ReplacementJournal from '../../models/RuleV3ReplacementJournal';
import { logger } from '../../../../infrastructure/logger';
import { scoreRuleV3Aggregate } from '../evidence/ruleV3Scoring.service';
import { applyStoredValidationAdjustment } from '../evidence/ruleV3ValidationScore.service';

const ACTIVE_STATES = ['preparing', 'prepared', 'applying', 'rolling_back'] as const;

function objectId(value: string | mongoose.Types.ObjectId): mongoose.Types.ObjectId {
  return value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(value);
}

export async function prepareRuleV3MutationJournal(input: {
  runId: string;
  attemptId: string;
  sourceId: string;
  sourceAliases: mongoose.Types.ObjectId[];
  replaceExisting: boolean;
}): Promise<string> {
  const journal = await RuleV3ReplacementJournal.create({
    runId: objectId(input.runId),
    attemptId: input.attemptId,
    sourceId: objectId(input.sourceId),
    sourceAliases: input.sourceAliases,
    sourceLockKey: input.sourceAliases.map(String).sort().join(':'),
    replaceExisting: input.replaceExisting,
    state: 'preparing',
  });

  if (input.replaceExisting) {
    const evidence = await KnowledgeRuleEvidenceV3.find({
      sourceId: { $in: input.sourceAliases },
    }).lean();
    const ruleIds = [...new Set(evidence.map(item => String(item.ruleId)))].map(objectId);
    const rules = ruleIds.length
      ? await KnowledgeRuleV3.find({
        $or: [
          { _id: { $in: ruleIds } },
          { 'compositeComponents.sourceRuleId': { $in: ruleIds } },
        ],
      }).lean()
      : [];
    const items = [
      ...rules.map(rule => ({
        journalId: journal._id,
        entityType: 'source_rule' as const,
        entityId: String(rule._id),
        payload: rule,
      })),
      ...evidence.map(item => ({
        journalId: journal._id,
        entityType: 'evidence' as const,
        entityId: String(item._id),
        payload: item,
      })),
    ];
    if (items.length) await RuleV3ReplacementBackupItem.insertMany(items, { ordered: true });
    const [ruleBackupCount, evidenceBackupCount] = await Promise.all([
      RuleV3ReplacementBackupItem.countDocuments({ journalId: journal._id, entityType: 'source_rule' }),
      RuleV3ReplacementBackupItem.countDocuments({ journalId: journal._id, entityType: 'evidence' }),
    ]);
    if (ruleBackupCount !== rules.length || evidenceBackupCount !== evidence.length) {
      throw new Error('replacement_backup_incomplete');
    }
    journal.expectedRuleBackupCount = rules.length;
    journal.expectedEvidenceBackupCount = evidence.length;
  }

  journal.state = 'prepared';
  await journal.save();
  return String(journal._id);
}

export async function markRuleV3MutationApplying(journalId: string): Promise<void> {
  await RuleV3ReplacementJournal.updateOne(
    { _id: journalId, state: 'prepared' },
    { $set: { state: 'applying' } },
  );
}

export async function backupRuleV3TouchedRule(journalId: string, rule: any): Promise<void> {
  const id = String(rule._id);
  const sourceBackupExists = await RuleV3ReplacementBackupItem.exists({
    journalId,
    entityType: 'source_rule',
    entityId: id,
  });
  if (sourceBackupExists) return;
  await RuleV3ReplacementBackupItem.updateOne(
    { journalId, entityType: 'touched_rule', entityId: id },
    { $setOnInsert: { payload: rule } },
    { upsert: true },
  );
}

export async function registerRuleV3NewRule(journalId: string, ruleId: mongoose.Types.ObjectId): Promise<void> {
  await RuleV3ReplacementJournal.updateOne(
    { _id: journalId },
    { $addToSet: { newRuleIds: ruleId } },
  );
}

async function rescoreRules(ruleIds: mongoose.Types.ObjectId[]): Promise<void> {
  const rules = await KnowledgeRuleV3.find({
    $or: [
      { _id: { $in: ruleIds } },
      { 'compositeComponents.sourceRuleId': { $in: ruleIds } },
    ],
  });
  for (const rule of rules) {
    const evidenceOwnerIds = [
      rule._id,
      ...(rule.compositeComponents || []).map(component => component.sourceRuleId),
    ];
    const evidence = await KnowledgeRuleEvidenceV3.find({
      ruleId: { $in: evidenceOwnerIds },
    }).lean();
    if (!rule || evidence.length === 0) continue;
    const sourceScore = scoreRuleV3Aggregate(rule, evidence).score;
    const score = applyStoredValidationAdjustment(sourceScore, rule);
    rule.sourceEvidenceScore = sourceScore.evidenceScore;
    rule.evidenceScore = score.evidenceScore;
    rule.certaintyTier = score.evidenceScore >= 85
      ? 'strong'
      : score.evidenceScore >= 65
        ? 'moderate'
        : score.evidenceScore >= 45
          ? 'limited'
          : 'weak';
    rule.supportingSourceCount = score.supportingSourceCount;
    rule.contradictingSourceCount = score.contradictingSourceCount;
    await rule.save();
  }
}

export async function rollbackRuleV3MutationJournal(
  journalIdOrAttemptId: string,
  options: { markRunCancelled?: boolean } = {},
): Promise<void> {
  const journal = mongoose.Types.ObjectId.isValid(journalIdOrAttemptId)
    ? await RuleV3ReplacementJournal.findById(journalIdOrAttemptId)
    : await RuleV3ReplacementJournal.findOne({ attemptId: journalIdOrAttemptId });
  if (!journal || journal.state === 'rolled_back' || journal.state === 'committed') return;

  if (journal.state === 'preparing' || journal.state === 'prepared') {
    const cleanupAfter = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await RuleV3ReplacementBackupItem.updateMany(
      { journalId: journal._id },
      { $set: { cleanupAfter } },
    );
    journal.state = 'rolled_back';
    journal.finishedAt = new Date();
    journal.cleanupAfter = cleanupAfter;
    journal.sourceLockKey = undefined;
    await journal.save();
    await RuleV3ReplacementBackupItem.deleteMany({ journalId: journal._id });
    if (options.markRunCancelled) {
      await AcademicRuleExtractionRunV3.updateOne(
        { _id: journal.runId, attemptId: journal.attemptId },
        {
          $set: {
            status: 'cancelled',
            currentStage: 'cancelled',
            sanitizedErrorCode: 'user_cancelled',
            finishedAt: new Date(),
          },
        },
      );
    }
    return;
  }

  journal.state = 'rolling_back';
  await journal.save();
  const items = await RuleV3ReplacementBackupItem.find({ journalId: journal._id }).lean();
  const sourceRules = items.filter(item => item.entityType === 'source_rule');
  const touchedRules = items.filter(item => item.entityType === 'touched_rule');
  const evidence = items.filter(item => item.entityType === 'evidence');

  await KnowledgeRuleEvidenceV3.deleteMany({ extractionAttemptId: journal.attemptId });
  if (journal.replaceExisting) {
    await KnowledgeRuleEvidenceV3.deleteMany({ sourceId: { $in: journal.sourceAliases } });
  }
  if (journal.newRuleIds.length) {
    await KnowledgeRuleEvidenceV3.deleteMany({ ruleId: { $in: journal.newRuleIds } });
    await KnowledgeRuleV3.deleteMany({ _id: { $in: journal.newRuleIds } });
  }

  const sourceRuleIds = new Set(sourceRules.map(item => item.entityId));
  for (const item of touchedRules) {
    if (!sourceRuleIds.has(item.entityId)) {
      await KnowledgeRuleV3.replaceOne({ _id: objectId(item.entityId) }, item.payload, { upsert: true });
    }
  }
  for (const item of sourceRules) {
    await KnowledgeRuleV3.replaceOne({ _id: objectId(item.entityId) }, item.payload, { upsert: true });
  }
  if (evidence.length) {
    await KnowledgeRuleEvidenceV3.insertMany(evidence.map(item => item.payload), { ordered: true });
  }
  await rescoreRules(
    [...new Set([...sourceRules, ...touchedRules].map(item => item.entityId))].map(objectId),
  );

  const cleanupAfter = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await RuleV3ReplacementBackupItem.updateMany(
    { journalId: journal._id },
    { $set: { cleanupAfter } },
  );
  journal.state = 'rolled_back';
  journal.finishedAt = new Date();
  journal.cleanupAfter = cleanupAfter;
  journal.sourceLockKey = undefined;
  await journal.save();
  await RuleV3ReplacementBackupItem.deleteMany({ journalId: journal._id });
  if (options.markRunCancelled) {
    await AcademicRuleExtractionRunV3.updateOne(
      { _id: journal.runId, attemptId: journal.attemptId },
      {
        $set: {
          status: 'cancelled',
          currentStage: 'cancelled',
          sanitizedErrorCode: 'user_cancelled',
          finishedAt: new Date(),
        },
      },
    );
  }
}

export async function commitRuleV3MutationJournal(journalId: string): Promise<void> {
  const journal = await RuleV3ReplacementJournal.findById(journalId);
  if (!journal || journal.state === 'committed') return;
  const cleanupAfter = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await RuleV3ReplacementBackupItem.updateMany(
    { journalId: journal._id },
    { $set: { cleanupAfter } },
  );
  journal.state = 'committed';
  journal.finishedAt = new Date();
  journal.cleanupAfter = cleanupAfter;
  journal.sourceLockKey = undefined;
  await journal.save();
  await RuleV3ReplacementBackupItem.deleteMany({ journalId: journal._id });
}

export async function isRuleV3MutationCommitted(attemptId: string): Promise<boolean> {
  return Boolean(await RuleV3ReplacementJournal.exists({ attemptId, state: 'committed' }));
}

export async function recoverIncompleteRuleV3Replacements(): Promise<void> {
  const journals = await RuleV3ReplacementJournal.find({
    state: { $in: ACTIVE_STATES },
  }).sort({ startedAt: 1 });
  for (const journal of journals) {
    try {
      const run = await AcademicRuleExtractionRunV3.findOne({
        _id: journal.runId,
        attemptId: journal.attemptId,
      }).select('status');
      if (run?.status === 'success') {
        await commitRuleV3MutationJournal(String(journal._id));
        continue;
      }
      await rollbackRuleV3MutationJournal(String(journal._id));
      await AcademicRuleExtractionRunV3.updateOne(
        { _id: journal.runId, attemptId: journal.attemptId, status: 'pending' },
        {
          $set: {
            status: 'failed',
            currentStage: 'failed',
            sanitizedErrorCode: 'interrupted_replacement_recovered',
            finishedAt: new Date(),
          },
        },
      );
    } catch (error) {
      logger.error('Could not recover an interrupted Rule V3 mutation.', error, {
        journalId: String(journal._id),
        attemptId: journal.attemptId,
      });
    }
  }
  await AcademicRuleExtractionRunV3.updateMany(
    { status: 'pending' },
    {
      $set: {
        status: 'failed',
        currentStage: 'failed',
        sanitizedErrorCode: 'interrupted_extraction_recovered',
        finishedAt: new Date(),
      },
    },
  );
}
