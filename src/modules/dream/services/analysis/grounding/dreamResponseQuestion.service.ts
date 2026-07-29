import { canGenerateContextQuestion } from '../../../../rules_v3/services/retrieval/ruleV3DreamApplication.service';
import {
  attachRuleQuestionContext,
  removeInternalAnalysisVocabulary,
} from './dreamGroundingText.service';
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
      if (linkedRules.length === 0 || !linkedRules.some(canGenerateContextQuestion)) return [];

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

  return { hypotheses, ruleMap, sourceByRule };
}

// Keeps distinct rule/excerpt questions while removing true duplicates.
export function deduplicateDreamQuestionsBySource(questions: any[]): any[] {
  const kept: any[] = [];
  const usedKeys = new Set<string>();

  for (const question of questions || []) {
    const key = String(
      question?.verificationKey
      || `${question?.ruleId || ''}:${question?.followUpQuestion || ''}`,
    ).trim();
    if (!key || usedKeys.has(key)) continue;
    usedKeys.add(key);
    kept.push(question);
  }
  return kept;
}
