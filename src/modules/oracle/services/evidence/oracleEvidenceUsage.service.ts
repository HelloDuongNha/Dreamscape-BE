import Dream from '../../../dream/models/Dream';
import OracleTurn from '../../models/OracleTurn';
import OracleThread from '../../models/OracleThread';
import {
  cleanOracleEvidenceClaim,
} from '../../../../shared/evidence/evidenceClaim';
import {
  evidenceGapRuleSimilarity,
} from '../../../../shared/evidence/evidenceClaimMatching';
import {
  readEvidenceClaimContent,
  type EvidenceClaimBinding,
} from '../../../../shared/evidence/citationClaim';

export interface OracleEvidenceUsageExcerpt {
  surfaceType: 'oracle' | 'dream_analysis';
  citationIndex: number | null;
  excerpt: string;
}

interface EvidenceUsageGap {
  _id: unknown;
  turnId?: unknown;
  occurrenceTurnIds?: unknown[];
  occurrenceDreamIds?: unknown[];
  claim: string;
  relatedClaims?: string[];
  resolvedRuleIds?: unknown[];
  resolutionCitationIndex?: number;
}

const MAX_EXCERPTS_PER_GAP = 20;

// Selects the Oracle-written passage that most closely applies one cited argument.
export function findOracleCitationUsageExcerpt(
  contentBlocks: Array<{ text?: string }>,
  citationIndex: number,
  statement: string,
): string | null {
  const marker = `[${citationIndex}]`;
  const passages = contentBlocks
    .flatMap((block) => splitAnalysisPassages(String(block.text || '')))
    .filter((passage) => passage.includes(marker));
  if (!passages.length) return null;
  return passages
    .map((passage) => ({
      passage,
      similarity: evidenceGapRuleSimilarity(statement, passage),
    }))
    .sort((left, right) => right.similarity - left.similarity)[0]?.passage || null;
}

// Loads only AI-written citation passages, without user content or navigable resource IDs.
export async function loadOracleEvidenceUsageExcerpts(
  gaps: EvidenceUsageGap[],
): Promise<Map<string, OracleEvidenceUsageExcerpt[]>> {
  if (!gaps.length) return new Map();

  const turnIds = [...new Set(gaps.flatMap((gap) => [
    String(gap.turnId || ''),
    ...(gap.occurrenceTurnIds || []).map(String),
  ]).filter(Boolean))];
  const dreamIds = [...new Set(gaps.flatMap((gap) =>
    (gap.occurrenceDreamIds || []).map(String)).filter(Boolean))];

  const turns = await OracleTurn.find({
    _id: { $in: turnIds },
    role: 'assistant',
    status: 'completed',
  }).select('_id threadId contentBlocks citations').lean();
  const activeThreadIds = new Set((await OracleThread.find({
    _id: { $in: turns.map((turn) => turn.threadId) },
    deletedAt: { $exists: false },
  }).select('_id').lean()).map((thread) => String(thread._id)));
  const liveTurns = turns.filter((turn) => activeThreadIds.has(String(turn.threadId)));
  const dreams = await Dream.find({
    _id: { $in: dreamIds },
    ai_status: 'completed',
  }).select('_id ai_result').limit(500).lean();
  const turnById = new Map(liveTurns.map((turn) => [String(turn._id), turn]));
  const result = new Map<string, OracleEvidenceUsageExcerpt[]>();

  for (const gap of gaps) {
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
  const isResolved = resolvedRuleIds.size > 0;
  const turnIds = [...new Set([
    String(gap.turnId || ''),
    ...(gap.occurrenceTurnIds || []).map(String),
  ].filter(Boolean))];
  const excerpts: OracleEvidenceUsageExcerpt[] = [];

  for (const turnId of turnIds) {
    const turn = turnById.get(turnId);
    if (!turn) continue;
    if (!isResolved) {
      for (const block of turn.contentBlocks || []) {
        for (const passage of splitAnalysisPassages(String(block.text || ''))) {
          if (!passage.includes('[?]') || !passageMatchesGap(passage, gap)) continue;
          excerpts.push({
            surfaceType: 'oracle',
            citationIndex: null,
            excerpt: passage,
          });
        }
      }
      continue;
    }
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
  const isResolved = resolvedRuleIds.size > 0;
  const occurrenceDreamIds = new Set((gap.occurrenceDreamIds || []).map(String));
  const excerpts: OracleEvidenceUsageExcerpt[] = [];

  for (const dream of dreams) {
    if (!occurrenceDreamIds.has(String(dream._id))) continue;
    const analysis = dream.ai_result;
    const bindingExcerpts = collectDreamBindingExcerpts(
      analysis,
      gap,
      resolvedRuleIds,
    );
    if (bindingExcerpts.length) {
      excerpts.push(...bindingExcerpts);
      continue;
    }

    // Compatibility path for analyses created before the claim-binding ledger.
    if (!isResolved) {
      for (const text of dreamAnalysisTexts(analysis)) {
        for (const passage of splitAnalysisPassages(String(text))) {
          if (!passage.includes('[?]') || !passageMatchesGap(passage, gap)) continue;
          excerpts.push({
            surfaceType: 'dream_analysis',
            citationIndex: null,
            excerpt: passage,
          });
        }
      }
      continue;
    }
    const notes = Array.isArray(analysis?.scientific_context_notes)
      ? analysis.scientific_context_notes
      : [];
    if (!notes.some((note: any) => resolvedRuleIds.has(String(note.ruleId)))) continue;
    for (const text of dreamAnalysisTexts(analysis)) {
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

function collectDreamBindingExcerpts(
  analysis: any,
  gap: EvidenceUsageGap,
  resolvedRuleIds: Set<string>,
): OracleEvidenceUsageExcerpt[] {
  const bindings: EvidenceClaimBinding[] = Array.isArray(analysis?.claim_bindings)
    ? analysis.claim_bindings
    : [];
  const excerpts: OracleEvidenceUsageExcerpt[] = [];
  const isResolved = resolvedRuleIds.size > 0;
  for (const binding of bindings) {
    if (
      (isResolved
        ? binding.status !== 'resolved'
          || !binding.citationIndex
          || !resolvedRuleIds.has(String(binding.ruleId || ''))
        : binding.status !== 'unresolved')
      || !bindingMatchesGap(binding, gap)
    ) {
      continue;
    }
    const excerpt = findDreamBindingExcerpt(analysis, binding);
    if (!excerpt) continue;
    excerpts.push({
      surfaceType: 'dream_analysis',
      citationIndex: binding.status === 'resolved'
        ? Number(binding.citationIndex)
        : null,
      excerpt,
    });
  }
  return excerpts;
}

function findDreamBindingExcerpt(
  analysis: any,
  binding: EvidenceClaimBinding,
): string | null {
  const marker = binding.status === 'resolved'
    ? `[${Number(binding.citationIndex)}]`
    : '[?]';
  const passages = splitAnalysisPassages(
    readEvidenceClaimContent(analysis, binding.contentPath),
  ).filter((passage) => passage.includes(marker));
  if (!passages.length) return null;
  return passages
    .map((passage) => ({
      passage,
      similarity: evidenceGapRuleSimilarity(binding.claimText, passage),
    }))
    .sort((left, right) => right.similarity - left.similarity)[0]?.passage || null;
}

function bindingMatchesGap(
  binding: EvidenceClaimBinding,
  gap: EvidenceUsageGap,
): boolean {
  const claim = cleanOracleEvidenceClaim(
    binding.evidenceClaim || binding.claimText,
  );
  return [gap.claim, ...(gap.relatedClaims || [])]
    .map(cleanOracleEvidenceClaim)
    .some((variant) =>
      comparableText(variant) === comparableText(claim)
      || evidenceGapRuleSimilarity(variant, claim) >= 0.5);
}

function splitAnalysisPassages(text: string): string[] {
  return text
    .split(/\n{2,}/u)
    .map((passage) => passage.replace(/\s+/gu, ' ').trim())
    .filter((passage) => passage.length >= 35 && /\[(?:\d+|\?)\]/u.test(passage));
}

function dreamAnalysisTexts(analysis: any): string[] {
  return [
    analysis?.core_analysis,
    analysis?.summary,
    ...(analysis?.interpretive_threads || []).flatMap((thread: any) => [
      thread.reasoning,
      thread.alternativeExplanation,
    ]),
  ].filter(Boolean).map(String);
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
