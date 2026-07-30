import {
  attachRuleQuestionContext,
  removeInternalAnalysisVocabulary,
} from './dreamGroundingText.service';
import {
  buildOracleCitationVerificationQuestion,
  localizeOracleRuleStatement,
  ORACLE_CITATION_QUESTION_VERSION,
} from '../../../../oracle/services/presentation/oracleRulePresentation.service';
interface ResponseQuestionContext {
  hypotheses: any[];
  ruleMap: Map<string, any>;
  sourceByRule: Map<string, any[]>;
}

// Connects each displayed question to its approved rule, source and score.
export function buildResponseQuestionContext(
  analysis: any,
  appliedRules: any[],
  evidenceLinks: any[],
): ResponseQuestionContext {
  const ruleMap = new Map<string, any>(
    appliedRules.map((rule: any) => [String(rule?.ruleId || rule?._id || ''), rule]),
  );
  const sourceByRule = new Map<string, any[]>(
    (Array.isArray(analysis.scientific_context_notes) ? analysis.scientific_context_notes : [])
      .filter((note: any) => String(note?.ruleId || '').trim() && Array.isArray(note?.sources))
      .map((note: any) => [String(note.ruleId).trim(), note.sources]),
  );

  for (const link of evidenceLinks) {
    const ruleId = String(link?.ruleId || '').trim();
    const sourceId = String(link?.sourceId || '').trim();
    if (!ruleId || !sourceId) continue;
    const existing = sourceByRule.get(ruleId) || [];
    if (existing.some(source => String(source?.sourceId || '') === sourceId)) continue;
    sourceByRule.set(ruleId, [...existing, {
      sourceId,
      title: String(link?.sourceTitle || 'Tài liệu học thuật'),
      authors: [],
      ...(link?.sourceYear ? { year: Number(link.sourceYear) } : {}),
      ...(link?.doi ? { doi: String(link.doi) } : {}),
      chunkIds: (link?.chunkIds || []).map((id: unknown) => String(id)),
    }]);
  }

  const storedHypotheses = Array.isArray(analysis.real_life_hypotheses)
    ? analysis.real_life_hypotheses
    : [];
  const hypotheses = deduplicateDreamQuestionsBySource(attachRuleQuestionContext(
    storedHypotheses.flatMap((item: any) => {
      const linkedRuleIds = [...new Set<string>(
        (item?.ruleIds || [item?.ruleId])
          .map((id: unknown) => String(id || '').trim())
          .filter(Boolean),
      )];
      const linkedRules = linkedRuleIds
        .map(ruleId => ruleMap.get(ruleId))
        .filter(Boolean) as any[];
      if (linkedRules.length === 0) return [];

      const sources = [...new Map([
        ...(item?.sources || []),
        ...linkedRuleIds.flatMap(ruleId => sourceByRule.get(ruleId) || []),
      ].map((source: any) => [
        String(source?.sourceId || source?.doi || source?.title || ''),
        source,
      ])).values()];
      if (sources.length === 0) return [];

      return [{
        ...item,
        ruleId: linkedRuleIds[0],
        ruleIds: linkedRuleIds,
        sources,
      }];
    }),
    appliedRules,
  ).map((item: any) => {
    const linkedRuleIds = [...new Set<string>(
      (item?.ruleIds || [item?.ruleId])
        .map((id: unknown) => String(id || '').trim())
        .filter(Boolean),
    )];
    const linkedRule = linkedRuleIds.map(id => ruleMap.get(id)).find(Boolean) as any;
    const evidenceLink = evidenceLinks.find((link: any) =>
      linkedRuleIds.includes(String(link?.ruleId || '').trim()));

    return {
      ...item,
      hypothesis: removeInternalAnalysisVocabulary(item.hypothesis),
      followUpQuestion: removeInternalAnalysisVocabulary(item.followUpQuestion),
      reasonForAsking: removeInternalAnalysisVocabulary(item.reasonForAsking),
      ifYesMeaning: removeInternalAnalysisVocabulary(item.ifYesMeaning),
      ifNoMeaning: removeInternalAnalysisVocabulary(item.ifNoMeaning),
      ...(evidenceLink?.sourceId ? { validationSourceId: String(evidenceLink.sourceId) } : {}),
      ...(evidenceLink?.chunkPreview
        ? { validationExactQuote: String(evidenceLink.chunkPreview).replace(/\.\.\.$/u, '').trim() }
        : {}),
      ...(Number.isFinite(Number(linkedRule?.evidenceScore))
        ? { ruleScore: Number(linkedRule.evidenceScore) }
        : {}),
    };
  }));

  return {
    hypotheses: appendMissingSourceQuestions(hypotheses, analysis, ruleMap, sourceByRule, evidenceLinks),
    ruleMap,
    sourceByRule,
  };
}

// Backfills old analyses that already have a citation but were saved before the
// canonical Dream/Oracle question contract was applied.
function appendMissingSourceQuestions(
  hypotheses: any[],
  analysis: any,
  ruleMap: Map<string, any>,
  sourceByRule: Map<string, any[]>,
  evidenceLinks: any[],
): any[] {
  const next = [...hypotheses];
  const usedQuestionKeys = new Set(
    next.map(dreamQuestionIdentity).filter(Boolean),
  );
  for (const link of evidenceLinks || []) {
    if (next.length >= 4) break;
    const ruleId = String(link?.ruleId || '').trim();
    const sourceId = String(link?.sourceId || '').trim();
    const rule = ruleMap.get(ruleId);
    if (!rule || !sourceId) continue;
    const source = (sourceByRule.get(ruleId) || []).find(
      item => String(item?.sourceId || '') === sourceId,
    );
    if (!source) continue;
    const evidenceId = String(link?.evidenceId || link?.chunkIds?.[0] || '').trim();
    const verificationKey = `${ruleId}:${evidenceId}`
      + `:dream-citation-${ORACLE_CITATION_QUESTION_VERSION}`;
    if (usedQuestionKeys.has(`rule:${ruleId}`)) continue;
    const question = buildOracleCitationVerificationQuestion(rule);
    const statement = localizeOracleRuleStatement(rule);
    next.push({
      ruleId,
      ruleIds: [ruleId],
      hypothesis: statement.vi,
      localizedHypothesis: statement,
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
      answerSemantics: { yes: 'supports', no: 'weakens', unsure: 'unresolved' },
      needsUserConfirmation: true,
      questionBasis: 'academic_rule',
      verificationKey,
      validationSourceId: sourceId,
      validationExactQuote: String(link?.chunkPreview || ''),
      sources: [{
        ...source,
        chunkIds: (source.chunkIds || link?.chunkIds || []).map((id: unknown) => String(id)),
      }],
      ...(Number.isFinite(Number(rule?.evidenceScore))
        ? { ruleScore: Number(rule.evidenceScore) }
        : {}),
      userFeedback: null,
    });
    usedQuestionKeys.add(`rule:${ruleId}`);
  }
  return deduplicateDreamQuestionsBySource(next);
}

// Keeps one case question per rule and folds duplicate excerpt records into it.
export function deduplicateDreamQuestionsBySource(questions: any[]): any[] {
  const kept = new Map<string, any>();
  for (const question of questions || []) {
    const key = dreamQuestionIdentity(question);
    if (!key) continue;
    const existing = kept.get(key);
    if (!existing) {
      kept.set(key, question);
      continue;
    }
    kept.set(key, mergeDuplicateQuestion(existing, question));
  }
  return [...kept.values()];
}

// Builds the logical identity independently from the evidence excerpt version.
function dreamQuestionIdentity(question: any): string {
  const ruleIds = [...new Set([
    question?.ruleId,
    ...(Array.isArray(question?.ruleIds) ? question.ruleIds : []),
  ].map(value => String(value || '').trim()).filter(Boolean))].sort();
  if (ruleIds.length) return `rule:${ruleIds.join('|')}`;
  const dimension = String(question?.questionDimension || '').trim();
  if (dimension) return `dimension:${dimension}`;
  const verificationKey = String(question?.verificationKey || '').trim();
  if (verificationKey) return `verification:${verificationKey}`;
  const text = String(question?.followUpQuestion || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('vi');
  return text ? `question:${text}` : '';
}

// Preserves the answered record and merges supporting source metadata from its duplicate.
function mergeDuplicateQuestion(left: any, right: any): any {
  const preferred = left?.userFeedback == null && right?.userFeedback != null ? right : left;
  const other = preferred === left ? right : left;
  const sources = new Map<string, any>();
  for (const source of [...(preferred?.sources || []), ...(other?.sources || [])]) {
    const key = String(source?.sourceId || source?.doi || source?.title || '').trim();
    if (!key) continue;
    const current = sources.get(key);
    sources.set(key, {
      ...(current || {}),
      ...source,
      chunkIds: [...new Set([
        ...(current?.chunkIds || []),
        ...(source?.chunkIds || []),
      ].map(String).filter(Boolean))],
    });
  }
  return {
    ...other,
    ...preferred,
    ruleIds: [...new Set([
      preferred?.ruleId,
      ...(preferred?.ruleIds || []),
      other?.ruleId,
      ...(other?.ruleIds || []),
    ].map(value => String(value || '').trim()).filter(Boolean))],
    evidenceFromDream: [...new Set([
      ...(preferred?.evidenceFromDream || []),
      ...(other?.evidenceFromDream || []),
    ].map(String).filter(Boolean))],
    sources: [...sources.values()],
  };
}
