import type { OracleCitation } from '../oracle.types';
import { getCurrentRuleValidationAnswers } from '../../../rules_v3/services/evidence/ruleV3ValidationScore.service';
import {
  buildOracleCitationVerificationQuestion,
  localizeOracleRuleStatement,
  localizeOracleVerificationQuestion,
  ORACLE_CITATION_QUESTION_VERSION,
} from '../presentation/oracleRulePresentation.service';
import type { OracleAcademicRecords } from './oracleGroundingRetrieval.service';
import { compactGroundingText } from './oracleGroundingText.service';

export async function buildAcademicCitations(
  userId: string,
  records: OracleAcademicRecords,
): Promise<{
  citations: OracleCitation[];
  verificationQuestions: any[];
}> {
  const rulesById = new Map(
    records.rules.map((rule: any) => [String(rule.ruleId || rule._id), rule]),
  );
  const evidenceBySource = groupEvidenceBySource(records.evidenceLinks);
  const citationGroups = [...evidenceBySource.entries()].slice(0, 4);
  const allVerificationQuestions = buildAcademicVerificationQuestions(
    citationGroups,
    rulesById,
  );
  const currentAnswers = await getCurrentRuleValidationAnswers(
    userId,
    allVerificationQuestions.map((question) => question.verificationKey),
  );
  const answeredKeys = new Set(currentAnswers.keys());
  const verificationQuestions = allVerificationQuestions
    .filter((question) => !answeredKeys.has(String(question.verificationKey || '')));
  const questionBySourceId = new Map(
    allVerificationQuestions.map((question) => [question.sourceId, question]),
  );
  const citations: OracleCitation[] = [];

  for (const [sourceId, group] of citationGroups) {
    citations.push(buildAcademicCitation({
      index: citations.length + 1,
      sourceId,
      source: group.source,
      evidence: group.evidence,
      rulesById,
      question: questionBySourceId.get(sourceId),
      currentAnswers,
    }));
  }
  return { citations, verificationQuestions };
}

function groupEvidenceBySource(evidenceLinks: any[]): Map<string, {
  source: any;
  evidence: any[];
}> {
  const groups = new Map<string, { source: any; evidence: any[] }>();
  for (const evidence of evidenceLinks) {
    const source = evidence.chunkId?.sourceId;
    const sourceId = String(source?._id || '');
    if (!sourceId) continue;
    const group = groups.get(sourceId) || { source, evidence: [] };
    group.evidence.push(evidence);
    groups.set(sourceId, group);
  }
  return groups;
}

// Chooses the strongest retrieved rule so each academic source has one clear question.
function buildAcademicVerificationQuestions(
  groups: Array<[string, { source: any; evidence: any[] }]>,
  rulesById: Map<string, any>,
) {
  return groups.flatMap(([sourceId, group]) => {
    const evidence = [...group.evidence]
      .sort((left, right) => Number(
        rulesById.get(String(right.ruleId))?.retrievalScore || 0,
      ) - Number(
        rulesById.get(String(left.ruleId))?.retrievalScore || 0,
      ))
      .find((item) => rulesById.has(String(item.ruleId)));
    if (!evidence) return [];

    const rule = rulesById.get(String(evidence.ruleId));
    const ruleId = String(rule.ruleId || rule._id);
    const evidenceId = String(evidence.chunkId?._id || evidence.chunkId || '');
    const localizedQuestion = buildOracleCitationVerificationQuestion(rule);
    return [{
      sourceId,
      ruleId,
      ruleIds: [ruleId],
      verificationKey: `${ruleId}:${evidenceId}:oracle-citation-${ORACLE_CITATION_QUESTION_VERSION}`,
      followUpQuestion: localizedQuestion.vi,
      localizedFollowUpQuestion: localizedQuestion,
    }];
  });
}

function buildAcademicCitation(input: {
  index: number;
  sourceId: string;
  source: any;
  evidence: any[];
  rulesById: Map<string, any>;
  question?: any;
  currentAnswers: Map<string, any>;
}): OracleCitation {
  const supportingClaims = [...new Set(input.evidence
    .map((evidence) => String(input.rulesById
      .get(String(evidence.ruleId))?.ruleStatement || '').trim())
    .filter(Boolean))];
  const relations = [...new Set(input.evidence
    .map((evidence) => {
      const rule = input.rulesById.get(String(evidence.ruleId));
      return rule?.factor && rule?.outcome ? `${rule.factor} -> ${rule.outcome}` : '';
    })
    .filter(Boolean))];
  const exactQuotes = [...new Set(input.evidence
    .map((evidence) => compactGroundingText(evidence.quote, 700))
    .filter(Boolean))]
    .slice(0, 3);
  return {
    index: input.index,
    sourceType: 'academic_source',
    sourceId: input.sourceId,
    title: compactGroundingText(input.source?.title || 'Academic source', 500),
    ...(Number(input.source?.year) ? { year: Number(input.source.year) } : {}),
    excerpt: compactGroundingText(exactQuotes.join(' … '), 1000),
    detail: compactGroundingText([
      supportingClaims.length
        ? `Supported claims (${supportingClaims.length}): ${supportingClaims.join(' | ')}`
        : '',
      relations.length ? `Relations: ${relations.join(' | ')}` : '',
      Array.isArray(input.source?.authors) ? input.source.authors.join(', ') : '',
      input.source?.year,
      input.source?.doi ? `DOI ${input.source.doi}` : '',
    ].filter(Boolean).join(' · '), 500),
    ruleLinks: buildRuleLinks(input),
  };
}

function buildRuleLinks(input: Parameters<typeof buildAcademicCitation>[0]) {
  return [...new Map(input.evidence.map((evidence) => {
    const rule = input.rulesById.get(String(evidence.ruleId));
    if (!rule) return ['', null];
    const ruleId = String(rule.ruleId || rule._id);
    const question = input.question?.ruleId === ruleId ? input.question : undefined;
    return [ruleId, {
      ruleId,
      ruleCode: String(rule.ruleCode || ''),
      statement: String(rule.ruleStatement || ''),
      localizedStatement: localizeOracleRuleStatement(rule),
      quote: compactGroundingText(evidence.quote, 1200),
      evidenceScore: Number(rule.evidenceScore || 0),
      supportingSourceCount: Number(rule.supportingSourceCount || 0),
      ...(question ? {
        verificationKey: String(question.verificationKey || ''),
        verificationQuestion: String(question.followUpQuestion || ''),
        localizedVerificationQuestion: localizeOracleVerificationQuestion(
          rule,
          question.followUpQuestion,
        ),
      } : {}),
      currentUserAnswer: question?.verificationKey
        ? input.currentAnswers.get(String(question.verificationKey)) || null
        : null,
    }];
  }).filter((entry) => entry[0] && entry[1]) as Array<[string, any]>).values()];
}
