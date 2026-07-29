import { ILLMOutput } from '../../../../../infrastructure/llm.service';
import { logger } from '../../../../../infrastructure/logger';
import { sanitizePracticalReflections } from '../assembly/practicalReflection.service';
import {
  appendDreamVerificationQuestion,
} from '../evidence/dreamCitationQuestion.service';
import {
  buildGroundedDreamTitle,
  buildGroundedMotifExplanation,
  buildRuleScientificFallback,
  buildVerifiedScientificNote,
  collectScientificDreamEvidence,
  deduplicateAcademicSources,
  deriveDreamEmotionTone,
  ensureInterpretiveThreadCoverage,
  findNarrativeSentenceForSymbol,
  isGroundedDreamTitle,
  polishGeneratedDreamProse,
  removeInternalAnalysisVocabulary,
  sanitizeInterpretiveThreads,
  sanitizeUnsupportedDreamClaims,
} from '../grounding/dreamAnalysisGrounding.service';
import { SimilarDreamMatch } from '../retrieval/similarDreamRetrieval.service';
import { IRetrievedSymbol } from '../retrieval/symbolRetrieval.service';
import { normalizeObjectPunctuation } from './dreamAnalysisNormalization.service';

interface OutputContext {
  rawAnalysis: ILLMOutput;
  dreamNarrative: string;
  wakingReactionText: string;
  retrievedSymbols: IRetrievedSymbol[];
  matchedRules: any[];
  explanatoryRules: any[];
  questionRules: any[];
  validSourcesMap: Map<string, any[]>;
  validEvidenceMap: Map<string, Array<{
    evidenceId: string;
    sourceId: string;
    chunkId: string;
    quote: string;
  }>>;
  culturalProfileUsed: boolean;
  similarDreams: SimilarDreamMatch[];
}

function groundSymbolicNotes(analysis: ILLMOutput, context: OutputContext): void {
  if (!Array.isArray(analysis.symbolic_notes)) return;
  const groundedSymbols: any[] = [];
  const seenSymbols = new Set<string>();
  for (const note of analysis.symbolic_notes) {
    const noteSymbol = String(note.symbol || '').trim().toLowerCase();
    const matchedSymbol = context.retrievedSymbols.find(symbol => [
      symbol.symbol,
      symbol.canonicalSymbol,
      ...(symbol.matchedVariants || []),
    ].map(value => String(value || '').trim().toLowerCase()).includes(noteSymbol));
    if (matchedSymbol) {
      note.symbolValence = matchedSymbol.symbolValence;
      note.symbol = matchedSymbol.matchedTextVariant || matchedSymbol.symbol;
      note.origin = 'dictionary';
      const evidenceLabel = matchedSymbol.matchedTextVariant
        || matchedSymbol.matchedVariants?.find(variant =>
          findNarrativeSentenceForSymbol(variant, context.dreamNarrative),
        )
        || matchedSymbol.symbol;
      note.dreamEvidence = findNarrativeSentenceForSymbol(evidenceLabel, context.dreamNarrative) || undefined;
    } else {
      const evidence = findNarrativeSentenceForSymbol(note.symbol, context.dreamNarrative);
      if (!evidence) continue;
      note.origin = 'contextual_observation';
      note.dreamEvidence = evidence;
      note.relevance = Math.min(0.75, Math.max(0, Number(note.relevance) || 0));
      note.symbolValence = Math.max(-1, Math.min(1, Number(note.symbolValence) || 0));
    }
    note.contextualTone = note.contextualTone || 'neutral';
    note.meaning = buildGroundedMotifExplanation(note, context.matchedRules);
    const key = String(note.symbol || '').trim().toLocaleLowerCase('vi');
    if (!key || seenSymbols.has(key)) continue;
    seenSymbols.add(key);
    groundedSymbols.push(note);
  }
  analysis.symbolic_notes = groundedSymbols.slice(0, 8);
}

function groundScientificNotes(analysis: ILLMOutput, context: OutputContext): void {
  if (context.explanatoryRules.length === 0) {
    analysis.scientific_context_notes = [];
    return;
  }
  if (!Array.isArray(analysis.scientific_context_notes)) return;
  const validRuleIds = new Set(context.explanatoryRules.map(rule => String(rule.ruleId || rule._id)));
  const finalNotes: any[] = [];
  const seenRuleIds = new Set<string>();
  for (const note of analysis.scientific_context_notes) {
    const ruleId = String(note.ruleId || '').trim();
    if (!validRuleIds.has(ruleId) || seenRuleIds.has(ruleId)) continue;
    const rule = context.explanatoryRules.find(item => String(item.ruleId || item._id) === ruleId);
    const availableSources = context.validSourcesMap.get(ruleId) || [];
    const allowedSourceIds = new Set(availableSources.map(source => source.sourceId));
    let sources = Array.isArray(note.sources)
      ? note.sources
        .filter((source: any) => source && allowedSourceIds.has(source.sourceId))
        .map((source: any) => availableSources.find(item => item.sourceId === source.sourceId) || source)
      : [];
    if (sources.length === 0) sources = availableSources;
    sources = deduplicateAcademicSources(sources);
    const noteText = String(note.note || '').trim();
    if (sources.length === 0 || noteText.split(/(?<=[.!?])\s+/).filter(Boolean).length < 2) {
      logger.warn('Discarding scientific note without a citable source or sufficient explanation.', { ruleId });
      continue;
    }
    const verifiedNote = buildVerifiedScientificNote({
      rule,
      noteText,
      narrative: context.dreamNarrative,
      dreamEvidence: note.dreamEvidence,
      sources,
      evidenceQuotes: context.validEvidenceMap.get(ruleId) || [],
      confidence: Math.min(1, Math.max(0, Number(rule?.confidenceCap) || 0)),
    });
    if (!verifiedNote) continue;
    seenRuleIds.add(ruleId);
    finalNotes.push(verifiedNote);
  }
  for (const rule of context.explanatoryRules) {
    const ruleId = String(rule.ruleId || rule._id);
    if (seenRuleIds.has(ruleId) || finalNotes.length >= 4) continue;
    const noteText = buildRuleScientificFallback(rule, context.dreamNarrative);
    const sources = deduplicateAcademicSources(context.validSourcesMap.get(ruleId) || []);
    if (!noteText || sources.length === 0) continue;
    const verifiedNote = buildVerifiedScientificNote({
      rule,
      noteText,
      narrative: context.dreamNarrative,
      sources,
      evidenceQuotes: context.validEvidenceMap.get(ruleId) || [],
      confidence: Number(rule.confidenceCap) || 0,
    });
    if (!verifiedNote) continue;
    seenRuleIds.add(ruleId);
    finalNotes.push(verifiedNote);
  }
  analysis.scientific_context_notes = finalNotes;
}

function groundQuestionsAndProse(analysis: ILLMOutput, context: OutputContext): void {
  if (!context.culturalProfileUsed) analysis.cultural_symbolic_notes = [];
  analysis.real_life_hypotheses = buildAcademicVerificationQuestions(context);
  analysis.scientific_context_notes = (analysis.scientific_context_notes || []).map((note: any) => {
    const linkedEvidence = (analysis.real_life_hypotheses || [])
      .filter((item: any) => String(item?.ruleId || '') === String(note?.ruleId || ''))
      .flatMap((item: any) => item.evidenceFromDream || []);
    return {
      ...note,
      matchedDreamDetails: collectScientificDreamEvidence(
        { note: note.note, dreamEvidence: note.matchedDreamDetails },
        context.dreamNarrative,
        linkedEvidence,
      ),
    };
  });
  analysis.interpretive_threads = ensureInterpretiveThreadCoverage(
    context.dreamNarrative,
    sanitizeInterpretiveThreads(analysis.interpretive_threads || [], context.dreamNarrative)
      .map((thread: any) => ({
        ...thread,
        reasoning: polishGeneratedDreamProse(sanitizeUnsupportedDreamClaims(thread.reasoning)),
        alternativeExplanation: polishGeneratedDreamProse(sanitizeUnsupportedDreamClaims(thread.alternativeExplanation)),
      })),
  ).map((thread: any) => ({
    ...thread,
    title: removeInternalAnalysisVocabulary(thread.title),
    reasoning: removeInternalAnalysisVocabulary(thread.reasoning),
    alternativeExplanation: removeInternalAnalysisVocabulary(thread.alternativeExplanation),
  }));
  analysis.practical_reflections = sanitizePracticalReflections(
    (analysis.practical_reflections || [])
      .map((item: any) => ({
        suggestion: String(item?.suggestion || '').trim(),
        rationale: String(item?.rationale || '').trim(),
      }))
      .filter((item: any) => item.suggestion.length >= 30 && item.rationale.length >= 40)
      .slice(0, 3),
  );
  analysis.summary = removeInternalAnalysisVocabulary(polishGeneratedDreamProse(analysis.summary));
  analysis.core_analysis = removeInternalAnalysisVocabulary(
    polishGeneratedDreamProse(sanitizeUnsupportedDreamClaims(analysis.core_analysis)),
  );
  if (!analysis.emotional_tone_key || !analysis.emotional_tone) {
    const emotion = deriveDreamEmotionTone(context.dreamNarrative);
    analysis.emotional_tone_key = emotion.key;
    analysis.emotional_tone = emotion.label;
  }
}

// Uses the same rule-backed question contract as Oracle, one question per rule/excerpt.
function buildAcademicVerificationQuestions(context: OutputContext): any[] {
  const result = { real_life_hypotheses: [] as any[] };
  for (const rule of context.matchedRules) {
    if (result.real_life_hypotheses.length >= 4) break;
    const ruleId = String(rule.ruleId || rule._id || '');
    const evidence = (context.validEvidenceMap.get(ruleId) || [])[0];
    if (!evidence) continue;
    const source = (context.validSourcesMap.get(ruleId) || [])
      .find(item => String(item.sourceId || '') === evidence.sourceId);
    if (!source) continue;

    appendDreamVerificationQuestion(
      result,
      rule,
      {
        source: { ...source, _id: source.sourceId },
        evidence: {
          _id: evidence.evidenceId,
          chunkId: evidence.chunkId,
          exactQuote: evidence.quote,
        },
      },
      evidence.sourceId,
      [findRuleNarrativeEvidence(rule, context.dreamNarrative)],
    );
  }
  return result.real_life_hypotheses;
}

function findRuleNarrativeEvidence(rule: any, narrative: string): string {
  const anchors = [
    ...(rule.dreamFeatureTags || []),
    rule.factor,
    rule.outcome,
    rule.subject,
  ].map((item: unknown) => String(item || '').trim()).filter(Boolean);
  for (const anchor of anchors) {
    const evidence = findNarrativeSentenceForSymbol(anchor, narrative);
    if (evidence) return evidence;
  }
  return narrative.split(/(?<=[.!?])\s+/u).find(Boolean) || narrative;
}

function attachSimilarDreams(analysis: ILLMOutput, similarDreams: SimilarDreamMatch[]): void {
  analysis.similar_dreams = similarDreams.map(item => ({
    dreamId: item.dreamId,
    title: item.title,
    excerpt: item.excerpt,
    createdAt: item.createdAt,
    authorDisplayName: item.authorDisplayName,
    sameAuthor: item.sameAuthor,
    similarity: item.similarity,
  }));
  const creative = analysis.creative_continuation;
  if (!creative || typeof creative.title !== 'string' || typeof creative.continuation !== 'string'
    || typeof creative.connectionToCurrentDream !== 'string') {
    delete analysis.creative_continuation;
    return;
  }
  const indexes = Array.isArray(creative.inspirationIndexes)
    ? [...new Set<number>((creative.inspirationIndexes as unknown[])
      .filter((index): index is number =>
        typeof index === 'number'
        && Number.isInteger(index)
        && index >= 1
        && index <= similarDreams.length,
      ))]
    : [];
  creative.inspirations = indexes.map(index => {
    const dream = similarDreams[index - 1];
    return { dreamId: dream.dreamId, title: dream.title, similarity: dream.similarity };
  });
  creative.inspirationIndexes = indexes;
  creative.disclaimer = 'Đây là một đoạn sáng tác tham khảo dựa trên mô-típ kể chuyện, không phải dự báo về giấc mơ tiếp theo và không phải kết luận tâm lý.';
}

// Validates generated fields against retrieved dream evidence and rules.
export function finalizeDreamAnalysisOutput(context: OutputContext): ILLMOutput {
  const analysis = normalizeObjectPunctuation(context.rawAnalysis);
  groundSymbolicNotes(analysis, context);
  if (!isGroundedDreamTitle(analysis.title, context.dreamNarrative)) {
    analysis.title = buildGroundedDreamTitle(
      context.dreamNarrative,
      (analysis.symbolic_notes || []).map((note: any) => note.symbol),
    );
  }
  groundScientificNotes(analysis, context);
  groundQuestionsAndProse(analysis, context);
  attachSimilarDreams(analysis, context.similarDreams);
  return analysis;
}
