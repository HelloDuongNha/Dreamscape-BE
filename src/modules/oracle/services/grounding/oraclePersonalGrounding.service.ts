import type { OracleCitation } from '../oracle.types';
import type { OracleGrounding } from './oracleGrounding.service';
import type { OraclePersonalDreamRecords } from './oracleGroundingRetrieval.service';
import { compactGroundingText } from './oracleGroundingText.service';

export function buildPersonalDreamCitations(
  records: OraclePersonalDreamRecords,
  firstCitationIndex: number,
): {
  citations: OracleCitation[];
  personalContext?: OracleGrounding['personalContext'];
} {
  const distinctMatches = selectDistinctDreamMatches(records.matches);
  const citations = distinctMatches.map((match, offset): OracleCitation => ({
    index: firstCitationIndex + offset,
    sourceType: match.sameAuthor ? 'own_dream' : 'public_dream',
    sourceId: match.dreamId,
    title: compactGroundingText(match.title, 500),
    excerpt: compactGroundingText(match.excerpt, 1000),
    detail: buildDreamCitationDetail(match),
  }));
  const strongestOwnMatch = distinctMatches
    .filter((match) => match.sameAuthor && match.similarity >= 80)
    .sort((left, right) => right.similarity - left.similarity)[0];
  const strongestOwnCitation = strongestOwnMatch
    ? citations.find((citation) =>
      citation.sourceType === 'own_dream'
      && citation.sourceId === strongestOwnMatch.dreamId)
    : undefined;
  const personalContext = strongestOwnMatch && strongestOwnCitation
    ? {
      citationIndex: strongestOwnCitation.index,
      title: strongestOwnCitation.title,
      similarity: strongestOwnMatch.similarity,
      exact: strongestOwnMatch.similarity >= 100,
      duplicateCount: Math.max(1, Number(strongestOwnMatch.duplicateCount) || 1),
    }
    : undefined;
  return { citations, personalContext };
}

function selectDistinctDreamMatches(
  matches: OraclePersonalDreamRecords['matches'],
): OraclePersonalDreamRecords['matches'] {
  return matches
    .sort((left, right) => Number(right.sameAuthor) - Number(left.sameAuthor)
      || right.similarity - left.similarity)
    .filter((match, index, allMatches) => {
      const key = normalizedDreamExcerpt(match.excerpt);
      return allMatches.findIndex((candidate) =>
        normalizedDreamExcerpt(candidate.excerpt) === key) === index;
    })
    .slice(0, 3);
}

function normalizedDreamExcerpt(value: unknown): string {
  return compactGroundingText(value, 1000)
    .normalize('NFKC')
    .toLocaleLowerCase('vi');
}

function buildDreamCitationDetail(
  match: OraclePersonalDreamRecords['matches'][number],
): string {
  if (!match.sameAuthor) {
    return compactGroundingText(`Public dream · ${match.similarity}% similar`, 500);
  }
  return compactGroundingText([
    `Own dream · ${match.similarity}% similar`,
    Number(match.duplicateCount) > 1
      ? `Represents ${match.duplicateCount} saved records with the same narrative`
      : '',
    match.priorAnalysisSummary ? `Prior analysis: ${match.priorAnalysisSummary}` : '',
    ...(match.confirmedContext || []).map((item) =>
      `Confirmed answer: ${item.answer} — ${item.question} ${item.interpretation}`),
  ].filter(Boolean).join(' · '), 500);
}
