import type { OracleCitation } from '../oracle.types';

const SUPPORT_CONCEPTS: Array<[string, RegExp]> = [
  ['memory', /\bmemory|memories|remember|recall\b|ký ức|trí nhớ|quá khứ/iu],
  ['future', /\bfuture|prospective|anticipated|upcoming\b|tương lai|sắp tới|dự kiến/iu],
  ['stress', /\bstress|anxiety|pressure|worry\b|căng thẳng|lo lắng|áp lực/iu],
  ['work', /\bwork|job|project|presentation|meeting\b|công việc|dự án|trình bày|cuộc họp/iu],
  ['emotion', /\bemotion|affect|feeling\b|cảm xúc|cảm giác/iu],
  ['creativity', /\bcreative|creativity|divergent thinking\b|sáng tạo|linh hoạt/iu],
  ['threat', /\bthreat|danger|fear\b|đe dọa|nguy hiểm|sợ hãi/iu],
  ['sleep', /\bsleep|awakening|rem|nrem\b|giấc ngủ|tỉnh giấc/iu],
];

export function validateAcademicCitationSupport(
  text: string,
  citations: OracleCitation[],
): string {
  let validated = text;
  for (const citation of citations.filter((item) => item.sourceType === 'academic_source')) {
    validated = validateCitationMarkers(validated, citation);
  }
  return validated;
}

function validateCitationMarkers(text: string, citation: OracleCitation): string {
  const marker = `[${citation.index}]`;
  let validated = text;
  let searchFrom = 0;
  while (true) {
    const markerStart = validated.indexOf(marker, searchFrom);
    if (markerStart < 0) return validated;
    if (citationSupportsClaim(validated, markerStart, citation)) {
      searchFrom = markerStart + marker.length;
      continue;
    }
    validated = `${validated.slice(0, markerStart)}[?]${validated.slice(markerStart + marker.length)}`;
    searchFrom = markerStart + 3;
  }
}

function citationSupportsClaim(
  text: string,
  markerStart: number,
  citation: OracleCitation,
): boolean {
  const claimConcepts = conceptsIn(citationClaimBefore(text, markerStart));
  const citationScope = [
    citation.excerpt,
    citation.detail || '',
    ...(citation.ruleLinks || []).flatMap((rule) => [rule.statement, rule.quote]),
  ].join(' ');
  const scopeConcepts = conceptsIn(citationScope);
  const covered = [...claimConcepts].filter((concept) => scopeConcepts.has(concept)).length;
  const coverage = claimConcepts.size ? covered / claimConcepts.size : 0;
  const quoteIsSubstantive = citation.excerpt.replace(/\s+/gu, ' ').trim().length >= 60;
  return claimConcepts.size > 0 && coverage >= 0.75 && quoteIsSubstantive;
}

function conceptsIn(value: string): Set<string> {
  return new Set(SUPPORT_CONCEPTS
    .filter(([, pattern]) => pattern.test(value))
    .map(([name]) => name));
}

function citationClaimBefore(text: string, markerStart: number): string {
  const before = text.slice(Math.max(0, markerStart - 700), markerStart);
  const boundary = Math.max(
    before.lastIndexOf('\n'),
    before.lastIndexOf('.'),
    before.lastIndexOf('!'),
    before.lastIndexOf('?'),
  );
  return before.slice(boundary + 1).replace(/\s+/gu, ' ').trim();
}
