import { Types } from 'mongoose';
import OracleTurn from '../models/OracleTurn';
import OracleEvidenceGap from '../models/OracleEvidenceGap';
import RuleValidationFeedback from '../../rules_v3/models/RuleValidationFeedback';
import KnowledgeRuleEvidenceV3 from '../../rules_v3/models/KnowledgeRuleEvidence';
import {
  captureOracleEvidenceGaps,
  invalidateOracleCitationMarker,
} from './oracleEvidenceGap.service';

export interface OracleSourceInvalidationPlan {
  sourceIds: string[];
  turnIds: Types.ObjectId[];
  ruleIds: string[];
  quoteHashes: string[];
}

// Collects references before academic evidence is removed.
export async function prepareOracleSourceInvalidation(
  sourceIds: string[],
): Promise<OracleSourceInvalidationPlan> {
  const normalizedSourceIds = [...new Set(sourceIds.map(String).filter(Boolean))];
  const objectSourceIds = normalizedSourceIds
    .filter(Types.ObjectId.isValid)
    .map((sourceId) => new Types.ObjectId(sourceId));
  const [evidence, turns] = await Promise.all([
    KnowledgeRuleEvidenceV3.find({ sourceId: { $in: objectSourceIds } })
      .select('ruleId quoteHash')
      .lean(),
    OracleTurn.find({ 'citations.sourceId': { $in: normalizedSourceIds } })
      .select('_id')
      .lean(),
  ]);
  return {
    sourceIds: normalizedSourceIds,
    turnIds: turns.map((turn) => turn._id as Types.ObjectId),
    ruleIds: [...new Set(evidence.map((item) => String(item.ruleId)))],
    quoteHashes: [...new Set(evidence.map((item) => String(item.quoteHash)).filter(Boolean))],
  };
}

// Reverts Oracle citations and case feedback in the same database transaction.
export async function applyOracleSourceInvalidation(
  plan: OracleSourceInvalidationPlan,
  session?: any,
): Promise<Types.ObjectId[]> {
  const writeOptions = session ? { session } : {};
  const affectedTurnIds: Types.ObjectId[] = [];
  for (const turnId of plan.turnIds) {
    const turn = await OracleTurn.findById(turnId).session(session || null);
    if (!turn) continue;
    const invalidIndexes = turn.citations
      .filter((citation) => plan.sourceIds.includes(String(citation.sourceId)))
      .map((citation) => citation.index);
    if (!invalidIndexes.length) continue;
    turn.contentBlocks = turn.contentBlocks.map((block) => {
      let text = block.text;
      for (const index of invalidIndexes) {
        text = invalidateOracleCitationMarker(text, index);
      }
      return text === block.text ? block : { ...block, text };
    });
    turn.citations = turn.citations.filter(
      (citation) => !plan.sourceIds.includes(String(citation.sourceId)),
    );
    turn.markModified('contentBlocks');
    turn.markModified('citations');
    await turn.save(writeOptions);
    affectedTurnIds.push(turn._id as Types.ObjectId);
  }

  if (plan.quoteHashes.length) {
    await RuleValidationFeedback.deleteMany({
      evidenceQuoteHashes: { $in: plan.quoteHashes },
    }, writeOptions);
  }

  if (plan.ruleIds.length) {
    const gaps = await OracleEvidenceGap.find({
      resolvedRuleIds: { $in: plan.ruleIds },
    }).session(session || null);
    for (const gap of gaps) {
      gap.resolvedRuleIds = gap.resolvedRuleIds.filter(
        (ruleId) => !plan.ruleIds.includes(String(ruleId)),
      );
      gap.status = 'unresolved';
      gap.resolvedAt = undefined;
      gap.resolutionCitationIndex = undefined;
      gap.markModified('resolvedRuleIds');
      await gap.save(writeOptions);
    }
  }
  return affectedTurnIds;
}

// Re-runs unresolved claims after the source transaction has committed.
export async function rematchInvalidatedOracleTurns(turnIds: Types.ObjectId[]): Promise<void> {
  for (const turnId of turnIds) {
    const turn = await OracleTurn.findById(turnId).select('userId threadId contentBlocks').lean();
    if (!turn) continue;
    await captureOracleEvidenceGaps({
      userId: turn.userId as Types.ObjectId,
      threadId: turn.threadId as Types.ObjectId,
      turnId: turn._id as Types.ObjectId,
      answer: turn.contentBlocks.map((block) => block.text).join('\n'),
    });
  }
}
