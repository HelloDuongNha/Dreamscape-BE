import type { Types } from 'mongoose';
import AcademicSource from '../../../academic/models/AcademicSource';
import {
  setRuleValidationFeedback,
} from '../../../rules_v3/services/evidence/ruleV3ValidationScore.service';
import OracleTurn from '../../models/OracleTurn';
import { OracleContractError } from '../oracle.types';
import { resolveCurrentCitationRule } from './oracleCitationRuleResolver.service';

export async function submitOracleCitationFeedbackRecord(input: {
  userId: Types.ObjectId;
  turnId: Types.ObjectId;
  citationIndex: number;
  expectedSourceId: string;
  ruleId: string;
  answer: 'yes' | 'no' | 'unsure' | null;
}) {
  const turn = await OracleTurn.findOne({
    _id: input.turnId,
    userId: input.userId,
    role: 'assistant',
    status: 'completed',
  });
  if (!turn) throw new OracleContractError('oracle_not_found', 'Oracle turn was not found.');
  const sourceIds = await resolveSourceAliases(input.expectedSourceId);
  const citation = (
    input.expectedSourceId
      ? turn.citations.find((item) => sourceIds.has(item.sourceId))
      : null
  ) || turn.citations.find((item) => item.index === input.citationIndex);
  const ruleLink = citation?.ruleLinks?.find((item) =>
    item.ruleId === input.ruleId || item.ruleCode === input.ruleId);
  if (!citation || citation.sourceType !== 'academic_source' || !ruleLink?.verificationQuestion) {
    throw new OracleContractError(
      'oracle_invalid_request',
      'This citation has no rule-backed verification question.',
    );
  }
  const currentRule = await resolveCurrentCitationRule(ruleLink, [...sourceIds]);
  if (!currentRule) {
    throw new OracleContractError(
      'oracle_invalid_request',
      'The citation no longer has a current argument backed by this exact excerpt.',
    );
  }
  const canonicalRuleId = String(currentRule._id);
  const verificationKey = ruleLink.verificationKey || `${canonicalRuleId}:oracle-citation`;
  const scoreUpdates = await setRuleValidationFeedback({
    userId: input.userId,
    verificationKey,
    origin: 'oracle',
    originId: turn._id as Types.ObjectId,
    questionText: ruleLink.verificationQuestion,
    answer: input.answer,
    directRuleIds: [canonicalRuleId],
    sourceId: citation.sourceId,
    exactQuote: ruleLink.quote,
  });
  const scoreByRuleId = new Map(scoreUpdates.map((item) => [item.ruleId, item]));
  const directScore = scoreByRuleId.get(canonicalRuleId);
  updateStoredCitationScores(turn, {
    requestedRuleId: input.ruleId,
    canonicalRuleId,
    ruleCode: ruleLink.ruleCode,
    verificationKey,
    answer: input.answer,
    scoreByRuleId,
  });
  turn.markModified('citations');
  await turn.save();
  return {
    ruleId: input.ruleId,
    answer: input.answer,
    score: directScore?.score ?? ruleLink.evidenceScore,
    scoreDelta: directScore?.scoreDelta ?? 0,
    voteDelta: directScore?.voteDelta ?? 0,
    scoreUpdates,
  };
}

async function resolveSourceAliases(expectedSourceId: string): Promise<Set<string>> {
  const source = expectedSourceId
    ? await AcademicSource.findOne({
      $or: [{ _id: expectedSourceId }, { sourceContributionId: expectedSourceId }],
    }).select('_id sourceContributionId').lean()
    : null;
  return new Set([
    expectedSourceId,
    source?._id ? String(source._id) : '',
    source?.sourceContributionId ? String(source.sourceContributionId) : '',
  ].filter(Boolean));
}

function updateStoredCitationScores(turn: any, input: {
  requestedRuleId: string;
  canonicalRuleId: string;
  ruleCode: string;
  verificationKey: string;
  answer: 'yes' | 'no' | 'unsure' | null;
  scoreByRuleId: Map<string, any>;
}): void {
  const directScore = input.scoreByRuleId.get(input.canonicalRuleId);
  for (const citation of turn.citations) {
    for (const link of citation.ruleLinks || []) {
      const update = input.scoreByRuleId.get(link.ruleId);
      if (update) link.evidenceScore = update.score;
      const sameRule = link.ruleId === input.requestedRuleId
        || link.ruleId === input.canonicalRuleId
        || link.ruleCode === input.requestedRuleId
        || link.ruleCode === input.ruleCode;
      if (!sameRule || link.verificationKey !== input.verificationKey) continue;
      link.currentUserAnswer = input.answer;
      if (directScore) link.evidenceScore = directScore.score;
    }
  }
}
