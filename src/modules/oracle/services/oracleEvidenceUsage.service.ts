import Dream from '../../dream/models/Dream';
import OracleTurn from '../models/OracleTurn';
import {
  cleanOracleEvidenceClaim,
  evidenceGapRuleSimilarity,
} from './oracleEvidenceGap.service';

export interface OracleEvidenceUsageExcerpt {
  surfaceType: 'oracle' | 'dream_analysis';
  citationIndex: number;
  excerpt: string;
}

interface EvidenceUsageGap {
  _id: unknown;
  turnId?: unknown;
  occurrenceTurnIds?: unknown[];
  claim: string;
  relatedClaims?: string[];
  resolvedRuleIds?: unknown[];
  resolutionCitationIndex?: number;
}

const MAX_EXCERPTS_PER_GAP = 20;

// Loads only AI-written citation passages, without user content or navigable resource IDs.
export async function loadOracleEvidenceUsageExcerpts(
  gaps: EvidenceUsageGap[],
): Promise<Map<string, OracleEvidenceUsageExcerpt[]>> {
  const resolvedGaps = gaps.filter((gap) => (gap.resolvedRuleIds || []).length > 0);
  if (!resolvedGaps.length) return new Map();

  const turnIds = [...new Set(resolvedGaps.flatMap((gap) => [
    String(gap.turnId || ''),
    ...(gap.occurrenceTurnIds || []).map(String),
  ]).filter(Boolean))];
  const ruleIds = [...new Set(resolvedGaps.flatMap((gap) =>
    (gap.resolvedRuleIds || []).map(String)))];

  const [turns, dreams] = await Promise.all([
    OracleTurn.find({
      _id: { $in: turnIds },
      role: 'assistant',
      status: 'completed',
    }).select('_id contentBlocks citations').lean(),
    Dream.find({
      ai_status: 'completed',
      'ai_result.scientific_context_notes.ruleId': { $in: ruleIds },
    }).select('ai_result').limit(500).lean(),
  ]);
  const turnById = new Map(turns.map((turn) => [String(turn._id), turn]));
  const result = new Map<string, OracleEvidenceUsageExcerpt[]>();

  for (const gap of resolvedGaps) {
    const excerpts = [
      ...collectOracleTurnExcerpts(gap, turnById),
      ...collectDreamAnalysisExcerpts(gap, dreams),
    ];
    result.set(String(gap._id), deduplicateExcerpts(excerpts).slice(0, MAX_EXCERPTS_PER_GAP));
  }
  return result;
}

function collectOracleTurnExcerpts(
  gap: EvidenceUsageGap,
  turnById: Map<string, any>,
): OracleEvidenceUsageExcerpt[] {
  const resolvedRuleIds = new Set((gap.resolvedRuleIds || []).map(String));
  const turnIds = [...new Set([
    String(gap.turnId || ''),
    ...(gap.occurrenceTurnIds || []).map(String),
  ].filter(Boolean))];
  const excerpts: OracleEvidenceUsageExcerpt[] = [];

  for (const turnId of turnIds) {
    const turn = turnById.get(turnId);
    if (!turn) continue;
    const citationIndexes = turn.citations
      .filter((citation: any) => (citation.ruleLinks || []).some(
        (link: any) => resolvedRuleIds.has(String(link.ruleId)),
      ))
      .map((citation: any) => Number(citation.index))
      .filter(Number.isInteger);
    if (!citationIndexes.length && gap.resolutionCitationIndex) {
      citationIndexes.push(gap.resolutionCitationIndex);
    }
    for (const block of turn.contentBlocks || []) {
      for (const passage of splitAnalysisPassages(String(block.text || ''))) {
        const citationIndex = citationIndexes.find(
          (index: number) => passage.includes(`[${index}]`),
        );
        if (!citationIndex || !passageMatchesGap(passage, gap)) continue;
        excerpts.push({ surfaceType: 'oracle', citationIndex, excerpt: passage });
      }
    }
  }
  return excerpts;
}

function collectDreamAnalysisExcerpts(
  gap: EvidenceUsageGap,
  dreams: any[],
): OracleEvidenceUsageExcerpt[] {
  const resolvedRuleIds = new Set((gap.resolvedRuleIds || []).map(String));
  const excerpts: OracleEvidenceUsageExcerpt[] = [];

  for (const dream of dreams) {
    const analysis = dream.ai_result;
    const notes = Array.isArray(analysis?.scientific_context_notes)
      ? analysis.scientific_context_notes
      : [];
    if (!notes.some((note: any) => resolvedRuleIds.has(String(note.ruleId)))) continue;
    const texts = [
      analysis?.core_analysis,
      analysis?.summary,
      ...(analysis?.interpretive_threads || []).map((thread: any) => thread.reasoning),
    ].filter(Boolean);
    for (const text of texts) {
      for (const passage of splitAnalysisPassages(String(text))) {
        const marker = passage.match(/\[(\d+)\]/u);
        if (!marker || !passageMatchesGap(passage, gap)) continue;
        excerpts.push({
          surfaceType: 'dream_analysis',
          citationIndex: Number(marker[1]),
          excerpt: passage,
        });
      }
    }
  }
  return excerpts;
}

function splitAnalysisPassages(text: string): string[] {
  return text
    .split(/\n{2,}/u)
    .map((passage) => passage.replace(/\s+/gu, ' ').trim())
    .filter((passage) => passage.length >= 35 && /\[\d+\]/u.test(passage));
}

function passageMatchesGap(passage: string, gap: EvidenceUsageGap): boolean {
  const normalizedPassage = comparableText(passage);
  const variants = [...new Set([gap.claim, ...(gap.relatedClaims || [])])]
    .map(cleanOracleEvidenceClaim)
    .filter((variant) => variant.length >= 25);
  if (variants.some((variant) => normalizedPassage.includes(comparableText(variant)))) return true;
  return evidenceGapRuleSimilarity(gap.claim, passage) >= 0.5;
}

function comparableText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
    .replace(/\[(?:\d+|\?)\]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function deduplicateExcerpts(
  excerpts: OracleEvidenceUsageExcerpt[],
): OracleEvidenceUsageExcerpt[] {
  const unique = new Map<string, OracleEvidenceUsageExcerpt>();
  for (const excerpt of excerpts) {
    const key = `${excerpt.surfaceType}:${excerpt.citationIndex}:${comparableText(excerpt.excerpt)}`;
    if (!unique.has(key)) unique.set(key, excerpt);
  }
  return [...unique.values()];
}
