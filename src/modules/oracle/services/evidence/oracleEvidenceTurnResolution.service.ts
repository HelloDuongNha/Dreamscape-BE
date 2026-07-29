import { Types } from 'mongoose';
import OracleTurn from '../../models/OracleTurn';
import type { OracleCitation } from '../oracle.types';
import {
  buildOracleCitationVerificationQuestion,
  localizeOracleRuleStatement,
  ORACLE_CITATION_QUESTION_VERSION,
} from '../presentation/oracleRulePresentation.service';
import {
  cleanOracleEvidenceClaim,
  sanitizeOracleUnresolvedMarkers,
} from '../../../../shared/evidence/evidenceClaim';
import {
  loadRuleEvidenceSupport,
  type EvidenceGapRuleInput,
} from './oracleEvidenceRuleSupport.service';
import {
  emitOracleCitationStatesChanged,
} from './oracleEvidenceTurnNotification.service';

export interface ResolvableEvidenceGap {
  userId: Types.ObjectId;
  turnId: Types.ObjectId;
  occurrenceTurnIds?: Types.ObjectId[];
  claim: string;
  relatedClaims?: string[];
}

export async function resolveEvidenceGapInOracleTurns(
  gap: ResolvableEvidenceGap,
  rule: EvidenceGapRuleInput,
): Promise<number | null> {
  const support = await loadRuleEvidenceSupport(gap.claim, rule);
  if (!support) return null;
  const ruleLink = buildCitationRuleLink(rule, support.evidence);
  const variants = evidenceClaimVariants(gap);
  const turnIds = await findOccurrenceTurnIds(gap, variants);
  let firstCitationIndex: number | null = null;

  for (const turnId of turnIds) {
    const citationIndex = await resolveTurn({
      turnId,
      variants,
      rule,
      ruleLink,
      evidence: support.evidence,
      source: support.source,
    });
    firstCitationIndex ??= citationIndex;
  }
  return firstCitationIndex;
}

function buildCitationRuleLink(rule: EvidenceGapRuleInput, evidence: any) {
  const question = buildOracleCitationVerificationQuestion(rule);
  return {
    ruleId: String(rule._id),
    ruleCode: String(rule.ruleCode || rule._id),
    statement: String(rule.statement || ''),
    localizedStatement: localizeOracleRuleStatement(rule),
    quote: String(evidence.exactQuote || ''),
    evidenceScore: Number(rule.evidenceScore) || 0,
    supportingSourceCount: Number(rule.supportingSourceCount) || 0,
    verificationKey: `${String(rule._id)}:${String(evidence._id)}:oracle-citation-${ORACLE_CITATION_QUESTION_VERSION}`,
    verificationQuestion: question.vi,
    localizedVerificationQuestion: question,
    currentUserAnswer: null,
  };
}

function evidenceClaimVariants(gap: ResolvableEvidenceGap): string[] {
  return [...new Set([gap.claim, ...(gap.relatedClaims || [])])]
    .map(cleanOracleEvidenceClaim)
    .filter(Boolean);
}

async function findOccurrenceTurnIds(
  gap: ResolvableEvidenceGap,
  variants: string[],
): Promise<string[]> {
  const patterns = variants
    .map((variant) => variant.replace(/[.!?]+\s*$/u, '').trim())
    .filter(Boolean)
    .map((stem) => new RegExp(
      `${stem.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*\\[\\?\\]`,
      'u',
    ));
  const legacyOccurrences = patterns.length
    ? await OracleTurn.find({
      userId: gap.userId,
      'contentBlocks.text': { $in: patterns },
    }).select('_id').lean()
    : [];
  return [...new Set([
    String(gap.turnId),
    ...(gap.occurrenceTurnIds || []).map(String),
    ...legacyOccurrences.map((turn) => String(turn._id)),
  ])];
}

async function resolveTurn(input: {
  turnId: string;
  variants: string[];
  rule: EvidenceGapRuleInput;
  ruleLink: any;
  evidence: any;
  source: any;
}): Promise<number | null> {
  const turn = await OracleTurn.findById(input.turnId);
  if (!turn) return null;
  const sourceId = String(input.source._id);
  const existingCitation = turn.citations.find((item) =>
    item.sourceType === 'academic_source' && item.sourceId === sourceId);
  const citationIndex = existingCitation?.index
    || Math.max(0, ...turn.citations.map((item) => item.index)) + 1;
  let citationInserted = false;
  const contentBlocks = turn.contentBlocks.map((block) => {
    if (block.type !== 'text') return block;
    let text = sanitizeOracleUnresolvedMarkers(block.text);
    for (const variant of input.variants) {
      const updated = replaceClaimMarker(text, variant, citationIndex);
      if (updated === text) continue;
      text = updated;
      citationInserted = true;
      break;
    }
    return text === block.text ? block : { ...block, text };
  });
  if (!citationInserted) {
    if (contentBlocks.some((block, index) => block.text !== turn.contentBlocks[index]?.text)) {
      turn.set({ contentBlocks });
      await turn.save();
    }
    return null;
  }
  const citations: OracleCitation[] = existingCitation
    ? turn.citations.map((citation) => citation !== existingCitation
      ? citation
      : {
        ...citation,
        ruleLinks: [
          ...(citation.ruleLinks || []).filter((link) =>
            link.ruleId !== input.ruleLink.ruleId),
          input.ruleLink,
        ],
      })
    : [...turn.citations, buildCitation(input, citationIndex, sourceId)];
  turn.set({ contentBlocks, citations });
  await turn.save();
  await emitOracleCitationStatesChanged([turn._id]);
  return citationIndex;
}

function replaceClaimMarker(text: string, variant: string, citationIndex: number): string {
  const stem = variant.replace(/[.!?]+\s*$/u, '').trim();
  if (!stem) return text;
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const marker = new RegExp(`(${escaped})(\\s*)\\[\\?\\]([.!?]?)`, 'u');
  return marker.test(text) ? text.replace(marker, `$1 [${citationIndex}]$3`) : text;
}

function buildCitation(
  input: Parameters<typeof resolveTurn>[0],
  citationIndex: number,
  sourceId: string,
): OracleCitation {
  return {
    index: citationIndex,
    sourceType: 'academic_source',
    sourceId,
    title: String(input.source.title || input.source.metadata?.title || 'Nguồn học thuật đã duyệt'),
    year: Number(input.source.year) || undefined,
    excerpt: input.evidence.exactQuote,
    detail: input.rule.statement?.slice(0, 500),
    ruleLinks: [input.ruleLink],
  };
}
