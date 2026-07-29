import { sameEvidenceSource } from '../../../../shared/evidence/citationClaim';
import {
  buildOracleCitationVerificationQuestion,
  localizeOracleRuleStatement,
  ORACLE_CITATION_QUESTION_VERSION,
} from '../presentation/oracleRulePresentation.service';
import type { EvidenceGapRuleInput } from './oracleEvidenceRuleSupport.service';

type RuleSupport = {
  source: any;
  evidence: {
    _id: unknown;
    chunkId: unknown;
    exactQuote?: string;
  };
};

// Adds one localized case question for each academic source.
export function appendDreamVerificationQuestion(
  analysis: any,
  rule: EvidenceGapRuleInput,
  support: RuleSupport,
  sourceId: string,
  evidenceFromDream: string[] = [],
): void {
  const hypotheses = Array.isArray(analysis.real_life_hypotheses)
    ? analysis.real_life_hypotheses
    : [];
  const source = support.source as any;
  const sourceIdentity = {
    sourceId,
    doi: String(source.doi || source.metadata?.doi || ''),
  };
  if (hasQuestionForSource(hypotheses, sourceIdentity)) return;

  const verificationKey = `${String(rule._id)}:${String(support.evidence._id)}`
    + `:dream-citation-${ORACLE_CITATION_QUESTION_VERSION}`;
  if (hypotheses.some((item: any) =>
    String(item.verificationKey || '') === verificationKey)) {
    return;
  }

  const question = buildOracleCitationVerificationQuestion(rule);
  const statement = localizeOracleRuleStatement(rule);
  hypotheses.push({
    ruleId: String(rule._id),
    ruleIds: [String(rule._id)],
    hypothesis: statement.vi || String(rule.statement || ''),
    localizedHypothesis: statement,
    evidenceFromDream: [...new Set(evidenceFromDream.map(String).filter(Boolean))],
    confidence: Math.min(1, Math.max(0, Number(rule.evidenceScore || 0) / 100)),
    followUpQuestion: question.vi,
    localizedFollowUpQuestion: question,
    reasonForAsking: 'Câu hỏi này kiểm tra điều kiện thực tế của lập luận trong trường hợp của bạn.',
    localizedReasonForAsking: {
      vi: 'Câu hỏi này kiểm tra điều kiện thực tế của lập luận trong trường hợp của bạn.',
      en: 'This question checks whether the argument’s real-life condition applies to your case.',
    },
    ifYesMeaning: 'Câu trả lời Có làm lập luận phù hợp hơn với trường hợp này.',
    localizedIfYesMeaning: {
      vi: 'Câu trả lời Có làm lập luận phù hợp hơn với trường hợp này.',
      en: 'A Yes answer makes the argument more applicable to this case.',
    },
    ifNoMeaning: 'Câu trả lời Không làm lập luận kém phù hợp hơn với trường hợp này.',
    localizedIfNoMeaning: {
      vi: 'Câu trả lời Không làm lập luận kém phù hợp hơn với trường hợp này.',
      en: 'A No answer makes the argument less applicable to this case.',
    },
    answerSemantics: {
      yes: 'supports',
      no: 'weakens',
      unsure: 'unresolved',
    },
    needsUserConfirmation: true,
    questionBasis: 'academic_rule',
    verificationKey,
    validationSourceId: sourceId,
    validationExactQuote: String(support.evidence.exactQuote || ''),
    sources: [{
      sourceId,
      title: String(source.title || source.metadata?.title || 'Academic source'),
      authors: source.authors || source.metadata?.authors || [],
      year: source.year || source.metadata?.year,
      journal: source.journal || source.publisher,
      doi: source.doi || source.metadata?.doi,
      chunkIds: [String(support.evidence.chunkId)],
    }],
    userFeedback: null,
  });
  analysis.real_life_hypotheses = hypotheses;
}

function hasQuestionForSource(hypotheses: any[], source: any): boolean {
  return hypotheses.some((hypothesis: any) =>
    (hypothesis.sources || []).some((itemSource: any) =>
      sameEvidenceSource(itemSource, source))
    || sameEvidenceSource({
      sourceId: String(hypothesis.validationSourceId || ''),
    }, source));
}
