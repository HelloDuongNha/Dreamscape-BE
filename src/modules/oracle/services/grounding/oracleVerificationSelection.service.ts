import type { OracleCitation } from '../oracle.types';
import {
  resolveEvidenceQuestionRuleIds,
} from '../../../../shared/evidence/evidenceQuestion';
import type { OracleGrounding } from './oracleGrounding.service';

export function selectGroundedVerificationQuestions(
  questions: any[],
  citations: OracleCitation[],
): OracleGrounding['verificationQuestions'] {
  const citationIndexByRuleId = new Map<string, number>();
  const citationIndexBySourceId = new Map<string, number>();
  for (const citation of citations) {
    citationIndexBySourceId.set(String(citation.sourceId), citation.index);
    for (const ruleLink of citation.ruleLinks || []) {
      citationIndexByRuleId.set(ruleLink.ruleId, citation.index);
    }
  }
  return questions
    .map((question) => {
      const ruleIds = resolveEvidenceQuestionRuleIds(question);
      const citationIndex = citationIndexBySourceId.get(String(question.sourceId || ''))
        || ruleIds
          .map((ruleId) => citationIndexByRuleId.get(ruleId))
          .find((index): index is number => Boolean(index));
      if (!citationIndex) return null;
      return {
        ruleIds,
        verificationKey: String(question.verificationKey || ''),
        question: String(question.followUpQuestion || ''),
        localizedQuestion: question.localizedFollowUpQuestion,
        citationIndex,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item?.question))
    .slice(0, 5);
}
