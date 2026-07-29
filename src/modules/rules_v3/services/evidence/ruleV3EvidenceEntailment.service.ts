import type {
  RuleV3QualityCandidate,
  RuleV3QualityEvidence,
  RuleV3SemanticSupport
} from './ruleV3CandidateQuality.types';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'by', 'for', 'from', 'in', 'into', 'is', 'it',
  'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'were', 'which', 'with',
  'các', 'có', 'của', 'đã', 'được', 'là', 'một', 'những', 'trong', 'và', 'về', 'với'
]);

export function assessAtomicSupport(
  candidate: RuleV3QualityCandidate,
  evidence: RuleV3QualityEvidence[]
): RuleV3SemanticSupport {
  const supportQuotes = supportQuoteClusters(evidence);
  let best: QuoteCoverage | null = null;

  for (const quote of supportQuotes) {
    const exactSupport = assessExactSupport(candidate.statement, quote);
    if (exactSupport) return exactSupport;

    const candidateCoverage = measureCandidateCoverage(candidate, quote);
    if (!best || totalCoverage(candidateCoverage) > totalCoverage(best)) {
      best = candidateCoverage;
    }
    if (isDirectCoverage(candidateCoverage)) {
      return directCoverageResult(candidateCoverage);
    }
  }

  return partialOrMissingSupport(best);
}

export function pruneUnsupportedSupportingEvidence<T extends RuleV3QualityEvidence>(
  candidate: RuleV3QualityCandidate,
  evidence: T[],
  maxClusterGap = 240
): T[] {
  const retained = evidence.filter(item => item.stance !== 'supports');
  const supportingByChunk = groupSupportingEvidenceByChunk(evidence);

  for (const entries of supportingByChunk.values()) {
    for (const cluster of splitEvidenceClusters(entries, maxClusterGap)) {
      if (assessAtomicSupport(candidate, cluster).level !== 'none') {
        retained.push(...cluster);
      }
    }
  }

  const retainedSet = new Set(retained);
  return evidence.filter(item => retainedSet.has(item));
}

interface QuoteCoverage {
  quote: string;
  statement: number;
  subject: number;
  outcome: number;
}

function assessExactSupport(statement: string, quote: string): RuleV3SemanticSupport | null {
  const normalizedStatement = normalizeText(statement);
  const normalizedQuote = normalizeText(quote);
  if (!normalizedQuote.includes(normalizedStatement) && !normalizedStatement.includes(normalizedQuote)) {
    return null;
  }
  return {
    level: 'direct',
    score: 1,
    reason: `Kết luận và trích dẫn có nội dung bao hàm trực tiếp: “${quotePreview(quote)}”`
  };
}

function measureCandidateCoverage(candidate: RuleV3QualityCandidate, quote: string): QuoteCoverage {
  return {
    quote,
    statement: coverage(candidate.statement, quote),
    subject: coverage(candidate.subject, quote),
    outcome: coverage(candidate.outcome, quote)
  };
}

function isDirectCoverage(value: QuoteCoverage): boolean {
  return value.statement >= 0.62 || (value.subject >= 0.6 && value.outcome >= 0.55);
}

function directCoverageResult(value: QuoteCoverage): RuleV3SemanticSupport {
  return {
    level: 'direct',
    score: Math.min(1, Math.max(value.statement, (value.subject + value.outcome) / 2)),
    reason: `Trích dẫn “${quotePreview(value.quote)}” bao phủ ${percent(value.statement)}% nội dung kết luận; chủ thể ${percent(value.subject)}% và kết quả ${percent(value.outcome)}%. Mức này đạt ngưỡng hỗ trợ trực tiếp.`
  };
}

function partialOrMissingSupport(best: QuoteCoverage | null): RuleV3SemanticSupport {
  if (best && (best.statement >= 0.4 || (best.subject >= 0.5 && best.outcome >= 0.3))) {
    return {
      level: 'partial',
      score: Math.min(0.6, Math.max(best.statement, (best.subject + best.outcome) / 2)),
      reason: `Trích dẫn gần nhất “${quotePreview(best.quote)}” chỉ bao phủ ${percent(best.statement)}% kết luận; chủ thể ${percent(best.subject)}% và kết quả ${percent(best.outcome)}%. Mức này chỉ đạt hỗ trợ một phần.`
    };
  }
  return {
    level: 'none',
    score: best ? Math.min(0.35, Math.max(best.statement, (best.subject + best.outcome) / 2)) : 0,
    reason: best
      ? `Trích dẫn gần nhất chỉ bao phủ ${percent(best.statement)}% kết luận; chủ thể ${percent(best.subject)}% và kết quả ${percent(best.outcome)}%, dưới ngưỡng hỗ trợ.`
      : 'Không có trích dẫn mang vai trò hỗ trợ để đối chiếu với kết luận.'
  };
}

function supportQuoteClusters(evidence: RuleV3QualityEvidence[], maxClusterGap = 240): string[] {
  const standalone: string[] = [];
  const byChunk = new Map<string, RuleV3QualityEvidence[]>();
  for (const item of evidence.filter(entry => entry.stance === 'supports' && entry.exactQuote?.trim())) {
    if (item.chunkId == null || !Number.isFinite(item.startOffset) || !Number.isFinite(item.endOffset)) {
      standalone.push(item.exactQuote!.trim());
      continue;
    }
    const entries = byChunk.get(String(item.chunkId)) || [];
    entries.push(item);
    byChunk.set(String(item.chunkId), entries);
  }

  const clusters = [...standalone];
  for (const entries of byChunk.values()) {
    clusters.push(...splitEvidenceClusters(entries, maxClusterGap)
      .map(cluster => cluster.map(item => item.exactQuote!.trim()).join(' ')));
  }
  return clusters;
}

function groupSupportingEvidenceByChunk<T extends RuleV3QualityEvidence>(evidence: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of evidence.filter(entry => entry.stance === 'supports')) {
    const key = String(item.chunkId || '__unknown_chunk__');
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }
  return grouped;
}

function splitEvidenceClusters<T extends RuleV3QualityEvidence>(entries: T[], maxClusterGap: number): T[][] {
  const sorted = [...entries].sort((left, right) => Number(left.startOffset || 0) - Number(right.startOffset || 0));
  const clusters: T[][] = [];
  for (const item of sorted) {
    const current = clusters[clusters.length - 1];
    const previous = current?.[current.length - 1];
    const gap = previous && Number.isFinite(previous.endOffset) && Number.isFinite(item.startOffset)
      ? Number(item.startOffset) - Number(previous.endOffset)
      : Number.POSITIVE_INFINITY;
    if (!current || gap > maxClusterGap) clusters.push([item]);
    else current.push(item);
  }
  return clusters;
}

function normalizeText(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function coverage(needle: string, haystack: string): number {
  const tokens = [...new Set(contentTokens(needle))];
  if (tokens.length === 0) return 0;
  const haystackTokens = new Set(contentTokens(haystack));
  return tokens.filter(token => haystackTokens.has(token)).length / tokens.length;
}

function contentTokens(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter(token => token.length >= 2 && !STOP_WORDS.has(token));
}

function totalCoverage(value: QuoteCoverage): number {
  return value.statement + value.subject + value.outcome;
}

function quotePreview(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 150 ? `${compact.slice(0, 147)}…` : compact;
}

function percent(value: number): number {
  return Math.round(value * 100);
}
