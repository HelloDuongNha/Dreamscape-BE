export function normalizeAnalysisText(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
    .replace(/[“”‘’]/gu, "'")
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function significantTokens(value: unknown): string[] {
  return normalizeAnalysisText(value)
    .split(' ')
    .filter(token => token.length >= 3);
}

function coverageAgainstKnownContext(candidate: string, knownContext: string): number {
  const candidateTokens = [...new Set(significantTokens(candidate))];
  const knownTokens = new Set(significantTokens(knownContext));
  if (candidateTokens.length < 3 || knownTokens.size === 0) return 0;
  const matched = candidateTokens.filter(token => knownTokens.has(token)).length;
  return matched / candidateTokens.length;
}

export function isHypothesisAnsweredByKnownContext(
  hypothesis: any,
  knownContext: string,
): boolean {
  if (!knownContext.trim()) return false;
  return Math.max(
    coverageAgainstKnownContext(hypothesis?.hypothesis || '', knownContext),
    coverageAgainstKnownContext(hypothesis?.followUpQuestion || '', knownContext),
  ) >= 0.5;
}

export function exactNarrativeExcerptExists(excerpt: unknown, narrative: string): boolean {
  const normalizedExcerpt = normalizeAnalysisText(excerpt);
  return normalizedExcerpt.length >= 4
    && normalizeAnalysisText(narrative).includes(normalizedExcerpt);
}

export function isStructurallyInvalidFollowUpQuestion(question: unknown): boolean {
  const raw = String(question || '').replace(/\s+/gu, ' ').trim();
  const words = raw.match(/[\p{L}\p{N}]+/gu) || [];
  const questionMarks = (raw.match(/\?/gu) || []).length;
  return raw.length < 20
    || raw.length > 500
    || words.length < 5
    || words.length > 80
    || questionMarks > 1;
}

export function validateInterpretiveThreads(threads: any[], narrative: string): any[] {
  const accepted: any[] = [];
  for (const thread of threads || []) {
    const evidence = [...new Set((thread?.dreamEvidence || [])
      .map((item: unknown) => String(item).trim())
      .filter((item: string) => exactNarrativeExcerptExists(item, narrative)))];
    const reasoning = String(thread?.reasoning || '').trim();
    const alternative = String(thread?.alternativeExplanation || '').trim();
    if (!String(thread?.title || '').trim()
      || evidence.length < 2
      || reasoning.length < 80
      || alternative.length < 30) continue;
    accepted.push({
      title: String(thread.title).trim(),
      dreamEvidence: evidence.slice(0, 3),
      reasoning,
      alternativeExplanation: alternative,
    });
    if (accepted.length >= 3) break;
  }
  return accepted;
}

export function validateGeneratedHypotheses(
  hypotheses: any[],
  narrative: string,
  knownContext: string,
  validRuleIds: Set<string>,
): any[] {
  const accepted: any[] = [];
  const seen = new Set<string>();
  for (const raw of hypotheses || []) {
    if (!raw
      || isHypothesisAnsweredByKnownContext(raw, knownContext)
      || isStructurallyInvalidFollowUpQuestion(raw.followUpQuestion)) continue;
    const evidence = [...new Set((raw.evidenceFromDream || [])
      .map((item: unknown) => String(item).trim())
      .filter((item: string) => exactNarrativeExcerptExists(item, narrative)))];
    if (evidence.length === 0) continue;

    const hypothesis = String(raw.hypothesis || '').trim();
    const question = String(raw.followUpQuestion || '').trim();
    const reasonForAsking = String(raw.reasonForAsking || '').trim();
    const ifYesMeaning = String(raw.ifYesMeaning || '').trim();
    const ifNoMeaning = String(raw.ifNoMeaning || '').trim();
    if (!hypothesis
      || !question
      || reasonForAsking.length < 45
      || ifYesMeaning.length < 35
      || ifNoMeaning.length < 35) continue;

    const key = normalizeAnalysisText(`${hypothesis} ${question}`);
    if (!key || seen.has(key)) continue;
    const ruleId = raw.ruleId == null ? '' : String(raw.ruleId).trim();
    if (!ruleId || !validRuleIds.has(ruleId)) continue;
    seen.add(key);

    accepted.push({
      ...raw,
      ruleId,
      verificationKey: String(
        raw.verificationKey
        || `${ruleId}:${normalizeAnalysisText(question).replace(/\s+/gu, '_').slice(0, 120)}`,
      ),
      answerSemantics: raw.answerSemantics
        || { yes: 'supports', no: 'weakens', unsure: 'unresolved' },
      evidenceFromDream: evidence.slice(0, 3),
      confidence: 0,
      questionType: ['past', 'present', 'future'].includes(raw.questionType)
        ? raw.questionType
        : 'present',
      needsUserConfirmation: true,
    });
    if (accepted.length >= 4) break;
  }
  return accepted;
}
