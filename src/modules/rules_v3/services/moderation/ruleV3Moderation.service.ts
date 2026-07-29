import mongoose from 'mongoose';
import AcademicSource from '../../../academic/models/AcademicSource';
import KnowledgeRuleV3 from '../../models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../models/KnowledgeRuleEvidence';
import {
  approveRuleV3Record,
  reconcileApprovedRuleEvidenceGaps,
} from './ruleV3Approval.service';

export type RuleV3ModerationFailure = {
  ruleId: string;
  reason: string;
};

export type RuleV3BulkModerationResult = {
  processed: number;
  failures: RuleV3ModerationFailure[];
  warnings: RuleV3ModerationFailure[];
};

/**
 * Approves one pending rule, then reconciles its evidence gaps. The approval
 * service remains the owner of quality gates, scoring and embedding creation.
 */
export async function approveRuleV3CandidateById(ruleId: string): Promise<{
  evidenceReconciliation: 'completed' | 'failed';
}> {
  const existing = await KnowledgeRuleV3.findById(ruleId);
  if (!existing) throw new Error('rule_not_found');

  await approveRuleV3Record(existing);
  const approved = await KnowledgeRuleV3.findById(existing._id);
  if (!approved) throw new Error('rule_not_found');

  try {
    await reconcileApprovedRuleEvidenceGaps(approved);
    return { evidenceReconciliation: 'completed' };
  } catch {
    return { evidenceReconciliation: 'failed' };
  }
}

/** Applies one explicitly confirmed bulk action without changing its semantics. */
export async function applyRuleV3BulkAction(input: {
  action: 'approve_pending' | 'reject_pending' | 'restore_rejected' | 'delete_rejected';
  sourceId?: string;
}): Promise<RuleV3BulkModerationResult> {
  const status: 'pending' | 'rejected' = input.action.includes('pending')
    ? 'pending'
    : 'rejected';
  const ids = await loadBulkRuleIds(status, input.sourceId);
  const failures: RuleV3ModerationFailure[] = [];
  const warnings: RuleV3ModerationFailure[] = [];
  let processed = input.action === 'approve_pending' ? 0 : ids.length;

  if (input.action === 'reject_pending') {
    await KnowledgeRuleV3.updateMany(
      { _id: { $in: ids } },
      { status: 'rejected', $unset: { embedding: 1, embeddingModel: 1 } },
    );
  }
  if (input.action === 'restore_rejected') {
    await KnowledgeRuleV3.updateMany({ _id: { $in: ids } }, { status: 'pending' });
  }
  if (input.action === 'delete_rejected') {
    await KnowledgeRuleEvidenceV3.deleteMany({ ruleId: { $in: ids } });
    await KnowledgeRuleV3.deleteMany({ _id: { $in: ids }, status: 'rejected' });
  }

  if (input.action === 'approve_pending') {
    const rules = await KnowledgeRuleV3.find({ _id: { $in: ids }, status: 'pending' });
    for (const rule of rules) {
      try {
        await approveRuleV3Record(rule);
        const approved = await KnowledgeRuleV3.findById(rule._id);
        processed += 1;
        if (!approved) continue;
        try {
          await reconcileApprovedRuleEvidenceGaps(approved);
        } catch {
          warnings.push({
            ruleId: String(rule._id),
            reason: 'evidence_reconciliation_failed',
          });
        }
      } catch (error: any) {
        failures.push({
          ruleId: String(rule._id),
          reason: String(error?.message || 'approval_failed'),
        });
      }
    }
  }

  return { processed, failures, warnings };
}

export async function rejectRuleV3CandidateById(ruleId: string): Promise<void> {
  const rule = await KnowledgeRuleV3.findByIdAndUpdate(
    ruleId,
    { status: 'rejected' },
    { new: true },
  );
  if (!rule) throw new Error('rule_not_found');
}

async function loadBulkRuleIds(
  status: 'pending' | 'rejected',
  sourceId?: string,
): Promise<mongoose.Types.ObjectId[]> {
  if (!sourceId) {
    return (await KnowledgeRuleV3.find({ status }).select('_id').lean())
      .map(item => item._id);
  }
  if (!mongoose.Types.ObjectId.isValid(sourceId)) throw new Error('invalid_source_id');

  const requestedId = new mongoose.Types.ObjectId(sourceId);
  const aliases = [requestedId];
  const [approved, contribution] = await Promise.all([
    AcademicSource.findById(requestedId).select('sourceContributionId').lean(),
    AcademicSource.findOne({ sourceContributionId: requestedId }).select('_id').lean(),
  ]);
  if (approved?.sourceContributionId) aliases.push(approved.sourceContributionId);
  if (contribution?._id) aliases.push(contribution._id);
  const ownedRuleIds = await KnowledgeRuleEvidenceV3.distinct('ruleId', {
    sourceId: { $in: aliases },
  });
  return (
    await KnowledgeRuleV3.find({ _id: { $in: ownedRuleIds }, status }).select('_id').lean()
  ).map(item => item._id);
}
