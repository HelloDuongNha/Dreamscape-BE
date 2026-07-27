import {
  canExplainPsychology,
  canGenerateContextQuestion,
} from '../../../../rules_v3/services/ruleV3DreamApplication.service';
import { sanitizePracticalReflections } from '../assembly/practicalReflection.service';
import {
  buildGroundedMotifExplanation,
  containsGroundedPhrase,
  deriveDreamEmotionTone,
  exactExcerptExists,
  normalizeGroundingText,
  removeInternalAnalysisVocabulary,
  sanitizeUnsupportedDreamClaims,
} from './dreamGroundingText.service';
import type { DreamEmotionToneKey } from './dreamGroundingText.service';
import { polishGeneratedDreamProse } from './dreamFeedbackRevision.service';
import {
  buildCaseGroundedSynthesis,
  buildFeedbackAppliedAnalysis,
  buildFeedbackConclusion,
  applyFeedbackToThreads,
  ensureInterpretiveThreadCoverage,
} from './dreamCaseAssessment.service';
import {
  buildDreamCaseConclusion,
} from './dreamCaseConclusion.service';
import {
  buildScientificInsightTitle,
  buildVerifiedScientificNote,
  deduplicateScientificNotes,
} from './scientificNote.service';
import {
  buildContextualMotifNotes,
  deduplicateOverlappingMotifNotes,
  mergeContextualMotifNotes,
} from './contextualMotif.service';
import { buildResponseQuestionContext } from './dreamResponseQuestion.service';

function applyFeedbackToSymbolicNotes(notes: any[], _hypotheses: any[]): any[] {
  return notes || [];
}
export function enrichScientificNotesForResponse(
  analysis: any,
  retrievedContext: any,
  narrative: string,
): any {
  if (!analysis) return analysis;
  const appliedRules = retrievedContext?.componentD?.appliedRules || [];
  const usedDictionarySymbols = retrievedContext?.componentA?.usedSymbols || [];
  const personalSymbolPatterns = retrievedContext?.componentC?.personalSymbolPatterns || [];
  const observedSymbolPatterns = retrievedContext?.componentC?.observedSymbolPatterns || [];
  const similarDreams = retrievedContext?.componentC?.similarDreams || [];
  const evidenceLinks = retrievedContext?.componentD?.evidenceLinks || [];
  const {
    hypotheses: responseHypotheses,
    ruleMap,
    sourceByRule,
  } = buildResponseQuestionContext(analysis, appliedRules, evidenceLinks);
  const fallbackEmotion = deriveDreamEmotionTone(narrative);
  const emotion = {
    key: (analysis?.emotional_tone_key || fallbackEmotion.key) as DreamEmotionToneKey,
    label: String(analysis?.emotional_tone || fallbackEmotion.label),
  };
  const feedbackConclusion = buildFeedbackConclusion(analysis.feedback_revision || []);
  const responseThreads = applyFeedbackToThreads(ensureInterpretiveThreadCoverage(
    narrative,
    Array.isArray(analysis.interpretive_threads) ? analysis.interpretive_threads : [],
  ), responseHypotheses).map((thread: any) => ({
    ...thread,
    title: removeInternalAnalysisVocabulary(thread.title),
    reasoning: removeInternalAnalysisVocabulary(thread.reasoning),
    alternativeExplanation: removeInternalAnalysisVocabulary(thread.alternativeExplanation),
  }));
  const publicAnalysis = { ...analysis };
  delete publicAnalysis.dreamValenceScore;
  delete publicAnalysis.score_breakdown;
  const baseResponseSymbolicNotes = deduplicateOverlappingMotifNotes(mergeContextualMotifNotes(
    Array.isArray(analysis.symbolic_notes)
      ? analysis.symbolic_notes.filter((note: any) =>
        note?.origin !== 'contextual_observation'
        || exactExcerptExists(note?.dreamEvidence, narrative))
      : [],
    buildContextualMotifNotes(narrative, appliedRules),
  ).map((note: any) => {
    const noteKey = normalizeGroundingText(note?.symbol);
    const dictionaryMatch = usedDictionarySymbols.find((item: any) => {
      if (!Array.isArray(item?.retrievalMethods) || !item.retrievalMethods.includes('exact_match')) return false;
      const alias = normalizeGroundingText(item?.matchedTextVariant || item?.canonicalSymbol || item?.symbol);
      if (!alias || !(containsGroundedPhrase(noteKey, [alias]) || containsGroundedPhrase(alias, [noteKey]))) return false;
      return true;
    });
    const personalPattern = personalSymbolPatterns.find((item: any) => {
      const patternKey = normalizeGroundingText(item?.symbol);
      return patternKey && (containsGroundedPhrase(noteKey, [patternKey]) || containsGroundedPhrase(patternKey, [noteKey]));
    });
    const observedPattern = observedSymbolPatterns.find((item: any) =>
      (item?.matchedLabels || []).some((label: unknown) => {
        const labelKey = normalizeGroundingText(label);
        return labelKey && (containsGroundedPhrase(noteKey, [labelKey]) || containsGroundedPhrase(labelKey, [noteKey]));
      }));
    const similarOccurrences = similarDreams.filter((item: any) => {
      const excerpt = normalizeGroundingText(item?.excerpt);
      return noteKey && excerpt && containsGroundedPhrase(excerpt, [noteKey]);
    });
    const confirmedContextCount = similarOccurrences.filter((item: any) =>
      (item?.confirmedContext || []).some((entry: any) => entry?.answer === 'yes')).length;
    return {
      ...note,
      origin: dictionaryMatch ? 'dictionary' : 'contextual_observation',
      knowledgeStatus: dictionaryMatch ? 'dictionary' : 'observed',
      ...(dictionaryMatch ? { dictionarySymbol: String(dictionaryMatch?.canonicalSymbol || dictionaryMatch?.symbol || '') } : {}),
      meaning: removeInternalAnalysisVocabulary(buildGroundedMotifExplanation(note, appliedRules)),
      contextualTone: note?.contextualTone || 'neutral',
      motifStats: {
        previousPersonalDreamCount: Math.max(0, Number(personalPattern?.occurrences) || 0),
        similarDreamCount: similarOccurrences.length,
        sameSequenceCount: 0,
        confirmedContextCount,
        observedPersonalDreamCount: Math.max(0, Number(observedPattern?.personalDreamCount) || 0),
        observedPublicDreamCount: Math.max(0, Number(observedPattern?.publicDreamCount) || 0),
        observedToneCounts: observedPattern?.toneCounts || undefined,
      },
    };
  }));
  const responseSymbolicNotes = applyFeedbackToSymbolicNotes(baseResponseSymbolicNotes, responseHypotheses);
  const baseScientificNotes = deduplicateScientificNotes([...(Array.isArray(analysis.scientific_context_notes)
    ? analysis.scientific_context_notes
    : []).flatMap((note: any) => {
    if (note?.ruleCode && note?.ruleStatement && Array.isArray(note?.evidenceQuotes) && note.evidenceQuotes.length > 0) {
      const linkedRule: any = ruleMap.get(String(note?.ruleId || '').trim());
      return linkedRule && (canExplainPsychology(linkedRule) || canGenerateContextQuestion(linkedRule)) ? [{
        ...note,
        note: removeInternalAnalysisVocabulary(note.note),
        boundary: removeInternalAnalysisVocabulary(note.boundary),
      }] : [];
    }
    const ruleId = String(note?.ruleId || '').trim();
    const rule: any = ruleMap.get(ruleId);
    if (!rule || (!canExplainPsychology(rule) && !canGenerateContextQuestion(rule))) return [];
    const sources = note?.sources || [];
    const links = evidenceLinks.filter((link: any) => String(link?.ruleId || '') === ruleId);
    const evidenceQuotes = links.flatMap((link: any) => {
      const chunkId = String(link?.chunkIds?.[0] || '').trim();
      const quote = String(link?.chunkPreview || '').replace(/\.\.\.$/u, '').trim();
      return chunkId && quote ? [{ sourceId: String(link?.sourceId || ''), chunkId, quote }] : [];
    });
    const enriched = buildVerifiedScientificNote({
      rule,
      noteText: String(note?.note || '').trim(),
      narrative,
      dreamEvidence: note?.dreamEvidence || note?.matchedDreamDetails || [],
      sources,
      evidenceQuotes,
      confidence: Number(note?.confidence) || 0,
    });
    const finalNote = enriched || {
      ...note,
      ruleCode: String(rule?.ruleCode || '').trim(),
      ruleStatement: String(rule?.ruleStatement || '').trim(),
      insightTitle: buildScientificInsightTitle(rule),
    };
    return [{
      ...finalNote,
      note: removeInternalAnalysisVocabulary(finalNote.note),
      boundary: removeInternalAnalysisVocabulary(finalNote.boundary),
    }];
  })]);
  const responseScientificNotes = deduplicateScientificNotes([
    ...baseScientificNotes,
    ...responseHypotheses.flatMap((hypothesis: any) => {
      const linkedRuleIds = [...new Set<string>(
        (hypothesis?.ruleIds || [hypothesis?.ruleId])
          .map((id: unknown) => String(id || '').trim())
          .filter(Boolean),
      )];
      const rule = linkedRuleIds.map(ruleId => ruleMap.get(ruleId)).find(Boolean) as any;
      if (!rule || !canGenerateContextQuestion(rule)) return [];
      if (baseScientificNotes.some((note: any) => linkedRuleIds.includes(String(note?.ruleId || '')))) return [];
      const ruleId = String(rule?.ruleId || rule?._id || linkedRuleIds[0] || '').trim();
      const links = evidenceLinks.filter((link: any) => String(link?.ruleId || '') === ruleId);
      const sources = sourceByRule.get(ruleId) || [];
      const evidenceQuotes = links.flatMap((link: any) => {
        const chunkId = String(link?.chunkIds?.[0] || '').trim();
        const quote = String(link?.chunkPreview || '').replace(/\.\.\.$/u, '').trim();
        return chunkId && quote
          ? [{ sourceId: String(link?.sourceId || ''), chunkId, quote }]
          : [];
      });
      if (sources.length === 0 || evidenceQuotes.length === 0) return [];
      return [{
        ruleId,
        ruleCode: String(rule?.ruleCode || '').trim(),
        ruleStatement: String(rule?.ruleStatement || '').trim(),
        insightTitle: buildScientificInsightTitle(rule),
        note: removeInternalAnalysisVocabulary(String(rule?.ruleStatement || '').trim()),
        boundary: 'Nguồn này hỗ trợ mối liên hệ chung. Việc mối liên hệ đó có phù hợp với giấc mơ của bạn được kiểm tra bằng câu hỏi xác nhận ở phía trên.',
        sources,
        evidenceQuotes,
        academicEvidenceScore: Number(rule?.evidenceScore) || 0,
        applicationTier: rule?.applicationTier || 'supported',
      }];
    }),
  ]);
  const caseConclusion = buildDreamCaseConclusion(
    narrative,
    responseHypotheses,
    responseScientificNotes,
    analysis.core_analysis,
  );

  return {
    ...publicAnalysis,
    emotional_tone_key: emotion.key,
    emotional_tone: emotion.label,
    core_analysis: removeInternalAnalysisVocabulary(buildCaseGroundedSynthesis(
      narrative,
      responseHypotheses,
      sanitizeUnsupportedDreamClaims(analysis.core_analysis),
    )),
    case_conclusion: caseConclusion,
    summary: removeInternalAnalysisVocabulary(polishGeneratedDreamProse(analysis.summary)),
    real_life_hypotheses: responseHypotheses,
    feedback_conclusion: feedbackConclusion,
    feedback_analysis: buildFeedbackAppliedAnalysis(responseHypotheses),
    grounding_summary: {
      narrativeUsed: Boolean(narrative.trim()),
      resolvedContextCount: responseHypotheses.filter((item: any) => ['yes', 'no'].includes(item?.userFeedback)).length,
      unresolvedContextCount: responseHypotheses.filter((item: any) => item?.userFeedback === 'unsure').length,
      dictionaryMotifCount: responseSymbolicNotes.filter((item: any) => item?.origin === 'dictionary').length,
      contextualMotifCount: responseSymbolicNotes.filter((item: any) => item?.origin !== 'dictionary').length,
      appliedRuleCount: responseScientificNotes.length,
      explanatoryRuleCount: responseScientificNotes.filter((note: any) => note?.applicationTier !== 'exploratory').length,
      exploratoryRuleCount: responseScientificNotes.filter((note: any) => note?.applicationTier === 'exploratory').length,
      similarDreamCount: Array.isArray(retrievedContext?.componentC?.similarDreams)
        ? retrievedContext.componentC.similarDreams.length
        : Array.isArray(analysis.similar_dreams) ? analysis.similar_dreams.length : 0,
      sleepContextFactCount: Object.keys(retrievedContext?.componentA?.sleepContext || {}).length,
    },
    interpretive_threads: responseThreads,
    practical_reflections: sanitizePracticalReflections(publicAnalysis.practical_reflections)
      .map(item => ({
        suggestion: removeInternalAnalysisVocabulary(item.suggestion),
        rationale: removeInternalAnalysisVocabulary(item.rationale),
      })),
    symbolic_notes: responseSymbolicNotes,
    scientific_context_notes: responseScientificNotes,
  };
}
