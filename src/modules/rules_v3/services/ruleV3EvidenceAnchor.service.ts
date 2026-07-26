import crypto from 'crypto';
import type { RuleV3ProviderChunk } from './ruleV3GenerationProvider.types';

export interface RuleV3EvidenceAnchor {
  evidenceId: string;
  chunkId: string;
  exactQuote: string;
  startOffset: number;
  endOffset: number;
  chunkContentHash: string;
}

const MIN_QUOTE_LENGTH = 10;
const MAX_QUOTE_LENGTH = 900;

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function pushBoundedSpan(
  output: RuleV3EvidenceAnchor[],
  chunkId: string,
  text: string,
  rawStart: number,
  rawEnd: number,
  chunkContentHash: string
) {
  let start = rawStart;
  let end = rawEnd;
  while (start < end && /\s/u.test(text[start])) start++;
  while (end > start && /\s/u.test(text[end - 1])) end--;
  if (end - start < MIN_QUOTE_LENGTH) return;

  while (end - start > MAX_QUOTE_LENGTH) {
    const ceiling = start + MAX_QUOTE_LENGTH;
    const window = text.slice(start, ceiling + 1);
    const lastWhitespace = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\n'), window.lastIndexOf('\t'));
    const splitAt = lastWhitespace >= Math.floor(MAX_QUOTE_LENGTH * 0.65)
      ? start + lastWhitespace
      : ceiling;
    pushBoundedSpan(output, chunkId, text, start, splitAt, chunkContentHash);
    start = splitAt;
    while (start < end && /\s/u.test(text[start])) start++;
  }

  if (end - start < MIN_QUOTE_LENGTH) return;
  const exactQuote = text.slice(start, end);
  const evidenceId = `eva_${sha256(`${chunkId}:${start}:${end}:${exactQuote}`).slice(0, 20)}`;
  output.push({ evidenceId, chunkId, exactQuote, startOffset: start, endOffset: end, chunkContentHash });
}

/**
 * Builds immutable evidence choices directly from canonical chunk text.
 * The model chooses evidenceId; it never transcribes the quotation itself.
 */
export function buildRuleV3EvidenceAnchors(chunks: RuleV3ProviderChunk[]): RuleV3EvidenceAnchor[] {
  const anchors: RuleV3EvidenceAnchor[] = [];
  for (const chunk of chunks) {
    const text = String(chunk.text || '');
    const chunkContentHash = sha256(text);
    let spanStart = 0;

    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      const next = text[index + 1] || '';
      const previousToken = text.slice(0, index).match(/([^\s]+)$/u)?.[1]?.replace(/["'“”‘’()[\]]/gu, '') || '';
      const looksLikeAbbreviation = char === '.' && /^[\p{L}]{1,3}$/u.test(previousToken);
      const isSentenceEnd = /[.!?]/u.test(char) && (!next || /\s/u.test(next)) && !looksLikeAbbreviation;
      const isParagraphEnd = char === '\n' && next === '\n';
      if (!isSentenceEnd && !isParagraphEnd) continue;
      pushBoundedSpan(anchors, chunk.chunkId, text, spanStart, index + 1, chunkContentHash);
      spanStart = index + 1;
      if (isParagraphEnd) spanStart = index + 2;
    }

    pushBoundedSpan(anchors, chunk.chunkId, text, spanStart, text.length, chunkContentHash);
  }
  return anchors;
}

export function verifyRuleV3EvidenceAnchor(
  anchor: RuleV3EvidenceAnchor,
  chunkText: string
): boolean {
  return sha256(chunkText) === anchor.chunkContentHash
    && chunkText.slice(anchor.startOffset, anchor.endOffset) === anchor.exactQuote;
}
