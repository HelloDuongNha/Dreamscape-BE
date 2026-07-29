import { type ClientSession, Types } from 'mongoose';
import Dream from '../../../dream/models/Dream';
import RuleValidationFeedback from '../../../rules_v3/models/RuleValidationFeedback';
import OracleEvidenceGap from '../../models/OracleEvidenceGap';
import OracleTurn from '../../models/OracleTurn';
import {
  captureDreamEvidenceGaps,
  captureOracleEvidenceGaps,
} from '../evidence/oracleEvidenceCapture.service';
import { collectDreamEvidenceRecord } from '../../../../shared/evidence/dreamEvidenceRecord';
import { invalidateOracleCitationMarker } from '../../../../shared/evidence/evidenceClaim';
import {
  invalidateDreamAnalysis,
  invalidateDreamCitations,
  invalidateDreamRecordCitationState,
} from '../../../dream/services/analysis/evidence/dreamCitationSourceInvalidation.service';
import {
  prepareOracleSourceInvalidation,
  type OracleSourceInvalidationPlan,
} from './oracleSourceInvalidationPlan.service';
import {
  emitDreamCitationStatesChanged,
} from '../../../dream/services/analysis/evidence/dreamCitationNotification.service';
import {
  emitOracleCitationStatesChanged,
} from '../evidence/oracleEvidenceTurnNotification.service';

export { prepareOracleSourceInvalidation };
export type { OracleSourceInvalidationPlan };
export { invalidateDreamAnalysis, invalidateDreamRecordCitationState };

// Reverts every Oracle and Dream reference in one database transaction.
export async function applyOracleSourceInvalidation(
  plan: OracleSourceInvalidationPlan,
  session?: ClientSession,
): Promise<Types.ObjectId[]> {
  const writeOptions = session ? { session } : {};
  const affectedTurnIds = await invalidateOracleTurns(plan, session);
  await invalidateDreamCitations(plan, session);
  await removeInvalidFeedback(plan, writeOptions);
  await reopenEvidenceGaps(plan, session, writeOptions);
  return affectedTurnIds;
}

// Rebuilds Evidence Needed records after the source transaction commits.
export async function rematchInvalidatedOracleTurns(
  turnIds: Types.ObjectId[],
  dreamIds: Types.ObjectId[] = [],
): Promise<void> {
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
  for (const dreamId of dreamIds) {
    const dream = await Dream.findById(dreamId)
      .select('userId ai_result aiAnalysis edit_history.ai_result')
      .lean();
    if (!dream) continue;
    const evidenceRecord = collectDreamEvidenceRecord(dream);
    await captureDreamEvidenceGaps({
      userId: dream.userId as Types.ObjectId,
      dreamId: dream._id as Types.ObjectId,
      answer: evidenceRecord.answer,
      claimBindings: evidenceRecord.claimBindings,
    });
  }
  await emitOracleCitationStatesChanged(turnIds);
  await emitDreamCitationStatesChanged(dreamIds);
}

async function invalidateOracleTurns(
  plan: OracleSourceInvalidationPlan,
  session?: ClientSession,
): Promise<Types.ObjectId[]> {
  const affectedTurnIds: Types.ObjectId[] = [];
  for (const turnId of plan.turnIds) {
    const turn = await OracleTurn.findById(turnId).session(session || null);
    if (!turn) continue;
    const invalidIndexes = turn.citations
      .filter((citation) => plan.sourceIds.includes(String(citation.sourceId)))
      .map((citation) => citation.index);
    if (!invalidIndexes.length) continue;
    turn.contentBlocks = turn.contentBlocks.map((block) => {
      const invalidatedText = invalidIndexes.reduce(
        (value, index) => invalidateOracleCitationMarker(value, index),
        block.text,
      );
      const text = compactOracleCitationMarkers(
        invalidatedText,
        turn.citations.filter(
          (citation) => !plan.sourceIds.includes(String(citation.sourceId)),
        ),
      );
      return text === block.text ? block : { ...block, text };
    });
    turn.citations = compactOracleCitations(turn.citations.filter(
      (citation) => !plan.sourceIds.includes(String(citation.sourceId)),
    ));
    turn.markModified('contentBlocks');
    turn.markModified('citations');
    await turn.save(session ? { session } : {});
    affectedTurnIds.push(turn._id as Types.ObjectId);
  }
  return affectedTurnIds;
}

function compactOracleCitations<T extends { index: number }>(citations: T[]): T[] {
  return [...citations]
    .sort((left, right) => left.index - right.index)
    .map((citation, index) => {
      citation.index = index + 1;
      return citation;
    });
}

function compactOracleCitationMarkers(
  text: string,
  citations: Array<{ index: number }>,
): string {
  const indexes = new Map(
    [...citations]
      .sort((left, right) => left.index - right.index)
      .map((citation, index) => [citation.index, index + 1]),
  );
  return text.replace(/\[(\d+)\]/gu, (marker, rawIndex: string) => {
    const nextIndex = indexes.get(Number(rawIndex));
    return nextIndex ? `[${nextIndex}]` : marker;
  });
}

async function removeInvalidFeedback(
  plan: OracleSourceInvalidationPlan,
  writeOptions: { session?: ClientSession },
): Promise<void> {
  if (!plan.quoteHashes.length) return;
  await RuleValidationFeedback.deleteMany({
    evidenceQuoteHashes: { $in: plan.quoteHashes },
  }, writeOptions);
}

async function reopenEvidenceGaps(
  plan: OracleSourceInvalidationPlan,
  session: ClientSession | undefined,
  writeOptions: { session?: ClientSession },
): Promise<void> {
  if (!plan.ruleIds.length) return;
  const gaps = await OracleEvidenceGap.find({
    $or: [
      { resolvedRuleIds: { $in: plan.ruleIds } },
      { candidateRuleIds: { $in: plan.ruleIds } },
    ],
  }).session(session || null);
  for (const gap of gaps) {
    gap.resolvedRuleIds = gap.resolvedRuleIds.filter(
      (ruleId) => !plan.ruleIds.includes(String(ruleId)),
    );
    gap.candidateRuleIds = gap.candidateRuleIds.filter(
      (ruleId) => !plan.ruleIds.includes(String(ruleId)),
    );
    gap.status = gap.resolvedRuleIds.length
      ? 'resolved'
      : gap.candidateRuleIds.length
        ? 'candidate_found'
        : 'unresolved';
    if (!gap.resolvedRuleIds.length) {
      gap.resolvedAt = undefined;
      gap.resolutionCitationIndex = undefined;
    }
    gap.markModified('resolvedRuleIds');
    gap.markModified('candidateRuleIds');
    await gap.save(writeOptions);
  }
}
