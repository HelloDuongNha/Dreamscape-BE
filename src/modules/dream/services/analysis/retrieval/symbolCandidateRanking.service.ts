import {
  findExactDatabaseVariant,
  isMoreSpecificSymbol,
  normalizeMatchText,
} from './symbolMatching.service';
import type { RetrievedSymbol } from './symbolRetrieval.types';

export interface RankSymbolCandidatesInput {
  rows: any[];
  fullTextScores: Map<string, number>;
  normalizedDreamText: string;
  tokens: string[];
  tokenSet: Set<string>;
  ngramSet: Set<string>;
  minimumScore: number;
}

export interface RankedSymbolCandidates {
  symbols: RetrievedSymbol[];
  exactMatchCount: number;
  fullTextResultCount: number;
}

function databaseVariants(row: any): string[] {
  return [...new Set([
    row.symbol,
    row.canonicalSymbol,
    ...(Array.isArray(row.variants) ? row.variants : []),
  ].map(value => String(value || '').trim()).filter(Boolean))];
}

function vectorScoreForRow(row: any, scores: Map<string, number>): number | undefined {
  const keys = databaseVariants(row).map(normalizeMatchText);
  const matches = keys
    .map(key => scores.get(key))
    .filter((score): score is number => Number.isFinite(score));
  return matches.length > 0 ? Math.max(...matches) : undefined;
}

function mergeDuplicateCandidates(candidates: RetrievedSymbol[]): RetrievedSymbol[] {
  const unique = new Map<string, RetrievedSymbol>();
  for (const candidate of candidates) {
    const canonical = candidate.canonicalSymbol || candidate.symbol;
    const key = normalizeMatchText(canonical);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, {
        ...candidate,
        symbol: canonical,
        canonicalSymbol: canonical,
        matchedVariants: [candidate.metadataFromVariant || candidate.symbol],
      });
      continue;
    }

    const candidateVariant = candidate.metadataFromVariant || candidate.symbol;
    const existingVariant = existing.metadataFromVariant || existing.symbol;
    const preferCandidate = isMoreSpecificSymbol(candidateVariant, existingVariant)
      || candidate.adjustedScore > existing.adjustedScore;
    if (preferCandidate) {
      existing.category = candidate.category;
      existing.symbolValence = candidate.symbolValence;
      existing.interpretation = candidate.interpretation;
      existing.metadataFromVariant = candidateVariant;
    }
    if (candidate.adjustedScore > existing.adjustedScore) {
      existing.adjustedScore = candidate.adjustedScore;
      existing.rawSimilarityScore = candidate.rawSimilarityScore;
      existing.matchedTextVariant = candidate.matchedTextVariant || existing.matchedTextVariant;
    }
    existing.retrievalMethods = [...new Set([
      ...existing.retrievalMethods,
      ...candidate.retrievalMethods,
    ])];
    existing.matchedVariants = [...new Set([
      ...existing.matchedVariants,
      candidateVariant,
    ])];
  }
  return [...unique.values()];
}

export function rankSymbolCandidates(
  input: RankSymbolCandidatesInput,
): RankedSymbolCandidates {
  const candidates: RetrievedSymbol[] = [];
  let exactMatchCount = 0;
  let fullTextResultCount = 0;

  for (const row of input.rows) {
    const variants = databaseVariants(row);
    const matchedTextVariant = findExactDatabaseVariant(
      variants,
      input.tokenSet,
      input.ngramSet,
    );
    const exact = Boolean(matchedTextVariant);
    const rawScore = vectorScoreForRow(row, input.fullTextScores);
    if (!exact && (rawScore === undefined || rawScore < input.minimumScore)) continue;

    if (exact) exactMatchCount += 1;
    if (rawScore !== undefined) fullTextResultCount += 1;

    const adjustedScore = Math.min(1, Math.max(rawScore || 0, exact ? 0.72 : 0));
    const canonical = String(row.canonicalSymbol || row.symbol);
    candidates.push({
      symbol: String(row.symbol),
      category: String(row.category || ''),
      symbolValence: Number(row.symbolValence || 0),
      rawSimilarityScore: rawScore ?? null,
      adjustedScore,
      retrievalMethods: [
        ...(exact ? ['exact_match'] : []),
        ...(rawScore !== undefined ? ['full_text_vector'] : []),
      ],
      lowConfidence: !exact && adjustedScore < 0.7,
      fallbackReason: null,
      interpretation: String(row.interpretation || ''),
      boostReasons: exact ? ['database_alias_exact_match'] : [],
      suppressedBoostReasons: [],
      canonicalSymbol: canonical,
      matchedVariants: [String(row.symbol)],
      matchedTextVariant,
      metadataFromVariant: String(row.symbol),
    });
  }

  const symbols = mergeDuplicateCandidates(candidates)
    .sort((first, second) =>
      second.adjustedScore - first.adjustedScore
      || (second.rawSimilarityScore || 0) - (first.rawSimilarityScore || 0))
    .slice(0, 8);

  return {
    symbols,
    exactMatchCount,
    fullTextResultCount,
  };
}
