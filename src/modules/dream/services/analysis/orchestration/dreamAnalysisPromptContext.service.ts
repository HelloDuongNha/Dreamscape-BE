import { SimilarDreamMatch } from '../retrieval/similarDreamRetrieval.service';
import { ObservedSymbolPattern } from '../retrieval/symbolObservation.service';

interface PersonalSymbolPattern {
  symbol: string;
  occurrences: number;
  recentMeaning: string;
}

export function buildDreamPromptContext(input: {
  retrievedSymbols: any[];
  usableRules: any[];
  personalSymbolPatterns: PersonalSymbolPattern[];
  observedSymbolPatterns: ObservedSymbolPattern[];
  similarDreams: SimilarDreamMatch[];
}): {
  compactSymbolsText: string;
  compactRulesText: string;
  personalPatternText: string;
  observedSymbolText: string;
  similarDreamText: string;
} {
  const promptSymbols = input.retrievedSymbols
    .filter(symbol =>
      symbol.retrievalMethods.includes('exact_match')
      || (symbol.boostReasons && symbol.boostReasons.length > 0)
      || symbol.adjustedScore >= 0.85,
    )
    .sort((left, right) => {
      const exactDifference = Number(right.retrievalMethods.includes('exact_match'))
        - Number(left.retrievalMethods.includes('exact_match'));
      if (exactDifference !== 0) return exactDifference;

      const boostDifference = Number(Boolean(right.boostReasons?.length))
        - Number(Boolean(left.boostReasons?.length));
      if (boostDifference !== 0) return boostDifference;

      const preferredDifference = Number(right.adjustedScore >= 0.85)
        - Number(left.adjustedScore >= 0.85);
      if (preferredDifference !== 0) return preferredDifference;
      return right.adjustedScore - left.adjustedScore;
    })
    .slice(0, 5);

  const compactSymbolsText = promptSymbols
    .map(symbol =>
      `- Symbol: "${symbol.symbol}" (Category: "${symbol.category}", Valence: ${symbol.symbolValence}, Relevance/Similarity: ${symbol.rawSimilarityScore !== null ? symbol.rawSimilarityScore.toFixed(3) : 'Exact-Match-Only'}, Adjusted Score: ${symbol.adjustedScore.toFixed(3)})\n  Dictionary Meaning: ${symbol.interpretation}`,
    )
    .join('\n');

  const compactRulesText = input.usableRules
    .map(rule =>
      `- RuleId: "${String(rule.ruleId || rule._id)}"; role: "${rule.applicationRole}"; tier: "${rule.applicationTier || 'supported'}"; statement: "${rule.ruleStatement}"; score: ${rule.evidenceScore ?? 0}/100`,
    )
    .join('\n');

  const personalPatternText = input.personalSymbolPatterns.length > 0
    ? input.personalSymbolPatterns.map(pattern =>
      `- "${pattern.symbol}" appeared in ${pattern.occurrences} prior dream(s). Recent case-specific interpretation: ${pattern.recentMeaning}`,
    ).join('\n')
    : 'None matched the current narrative';

  const observedSymbolText = input.observedSymbolPatterns.length > 0
    ? input.observedSymbolPatterns.map(pattern =>
      `- ${pattern.matchedLabels[0] || pattern.symbolKey}: ${pattern.personalDreamCount} prior personal occurrence(s), ${pattern.publicDreamCount} public occurrence(s); contextual tones ${JSON.stringify(pattern.toneCounts)}\n  Prior interpretations: ${pattern.recentMeanings.join(' | ') || 'None'}\n  Earlier narrative evidence: ${pattern.evidenceExamples.join(' | ') || 'None'}`,
    ).join('\n')
    : 'None matched the current narrative';

  const similarDreamText = input.similarDreams.length > 0
    ? input.similarDreams.map((item, index) => `
PriorDream ${index + 1}:
- Similarity: ${item.similarity}%
- Same author: ${item.sameAuthor ? 'yes' : 'no'}
- Dream excerpt: ${item.excerpt}
- Earlier analysis summary: ${item.priorAnalysisSummary || 'Unavailable'}
- First-person confirmations from that dream: ${item.confirmedContext?.length ? item.confirmedContext.map(entry => `${entry.answer.toUpperCase()}: ${entry.question} — ${entry.interpretation}`).join(' | ') : 'None'}
- Context later added by that dream's author: ${item.ownerContextComments?.length ? item.ownerContextComments.join(' | ') : 'None'}
`).join('\n')
    : 'None found';

  return {
    compactSymbolsText,
    compactRulesText,
    personalPatternText,
    observedSymbolText,
    similarDreamText,
  };
}
