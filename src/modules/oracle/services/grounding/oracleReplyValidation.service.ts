import type { Types } from 'mongoose';
import {
  setRuleValidationFeedback,
} from '../../../rules_v3/services/evidence/ruleV3ValidationScore.service';
import OracleTurn from '../../models/OracleTurn';
import { resolveCurrentCitationRule } from './oracleCitationRuleResolver.service';

export async function applyOracleReplyValidation(
  userId: Types.ObjectId,
  parentTurnId: Types.ObjectId | undefined,
  content: string,
): Promise<void> {
  const answer = parseOracleValidationReply(content);
  if (!answer || !parentTurnId) return;
  const parent = await OracleTurn.findOne({
    _id: parentTurnId,
    userId,
    role: 'assistant',
    status: 'completed',
  });
  if (!parent) return;
  const selected = findLatestVerificationQuestion(parent);
  if (!selected?.link.verificationKey || !selected.link.verificationQuestion) return;
  const currentRule = await resolveCurrentCitationRule(
    selected.link,
    [selected.citation.sourceId],
  );
  if (!currentRule) return;
  const currentRuleId = String(currentRule._id);
  const updates = await setRuleValidationFeedback({
    userId,
    verificationKey: selected.link.verificationKey,
    origin: 'oracle',
    originId: parent._id as Types.ObjectId,
    questionText: selected.link.verificationQuestion,
    answer,
    directRuleIds: [currentRuleId],
    sourceId: selected.citation.sourceId,
    exactQuote: selected.link.quote,
  });
  applyValidationScores(parent, selected.link.verificationKey, answer, currentRuleId, updates);
  parent.markModified('citations');
  await parent.save();
}

function parseOracleValidationReply(content: string): 'yes' | 'no' | 'unsure' | null {
  const normalized = content.normalize('NFKC').trim().toLocaleLowerCase('vi');
  const explicitYes = /^(?:có|yes)\s*[.!?]*$/iu.test(normalized)
    || /^(?:có|yes)\s*[,;:—-]/iu.test(normalized)
    || /^có\s+(?:tôi|mình|đúng|điều|chính xác|chắc chắn)\b/iu.test(normalized)
    || /^yes\s+(?:i|that|this|it)\b/iu.test(normalized);
  if (explicitYes) return 'yes';
  const explicitNo = /^(?:không|no)\s*[.!?]*$/iu.test(normalized)
    || /^(?:không|no)\s*[,;:—-]/iu.test(normalized)
    || /^không\s+(?:tôi|mình|đúng|điều|chính xác)\b/iu.test(normalized)
    || /^no\s+(?:i|that|this|it)\b/iu.test(normalized);
  if (explicitNo) return 'no';
  if (/^(?:tôi\s+)?(?:chưa\s+chắc|không\s+chắc|not\s+sure|i'?m\s+not\s+sure)\b/iu.test(normalized)) {
    return 'unsure';
  }
  return null;
}

function findLatestVerificationQuestion(parent: any) {
  const answerText = parent.contentBlocks.map((block: any) => block.text).join('\n');
  return parent.citations.flatMap((citation: any) =>
    (citation.ruleLinks || [])
      .filter((link: any) => link.verificationQuestion && link.verificationKey)
      .map((link: any) => ({
        citation,
        link,
        position: answerText.lastIndexOf(link.verificationQuestion || ''),
      })))
    .filter((item: any) => item.position >= 0)
    .sort((left: any, right: any) => right.position - left.position)[0];
}

function applyValidationScores(
  parent: any,
  verificationKey: string,
  answer: 'yes' | 'no' | 'unsure',
  currentRuleId: string,
  updates: Array<{ ruleId: string; score: number }>,
): void {
  const scoreByRuleId = new Map(updates.map((item) => [item.ruleId, item.score]));
  const directScore = scoreByRuleId.get(currentRuleId);
  for (const citation of parent.citations) {
    for (const link of citation.ruleLinks || []) {
      link.evidenceScore = scoreByRuleId.get(link.ruleId) ?? link.evidenceScore;
      if (link.verificationKey !== verificationKey) continue;
      link.currentUserAnswer = answer;
      if (directScore != null) link.evidenceScore = directScore;
    }
  }
}
