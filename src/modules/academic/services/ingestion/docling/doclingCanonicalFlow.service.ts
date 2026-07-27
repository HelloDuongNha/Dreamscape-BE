import { CanonicalBlock } from '../../types/canonical.types';
import { DoclingTextRepairService } from './doclingTextRepair.service';

export function normalizeDoclingTypography(text: string): string {
  const accentMarks: Record<string, string> = {
    '˜': '\u0303',
    '¨': '\u0308',
    '`': '\u0300',
    '´': '\u0301',
    '^': '\u0302',
  };
  let normalized = text.replace(/[\u0003\uFFFD]/g, '*').replace(
    /\s+([˜¨`´^])\s+([\p{L}])/gu,
    (_match, mark: string, letter: string) => `${letter}${accentMarks[mark]}`.normalize('NFC'),
  );
  normalized = normalized.replace(/([\p{L}])\s+(['’])\s+([\p{L}])/gu, '$1$2$3');
  return DoclingTextRepairService.repairText(normalized);
}

export function stripPublisherDownloadNotice(text: string): string {
  const notice = /downloaded\s+from\s+https?\s*:\s*\/?\/?/i.exec(text);
  if (!notice) return text;
  const tail = text.slice(notice.index).toLowerCase();
  if (!tail.includes('terms and conditions') && !tail.includes('online library')) return text;

  const prefix = text.slice(0, notice.index);
  const metadataPrefix = /\b\d{6,9}\s*,\s*(?:19|20)\d{2}\s*,\s*\d+\s*,\s*$/i.exec(prefix);
  return text.slice(0, metadataPrefix ? metadataPrefix.index : notice.index).trim();
}

export function escapeDoclingHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Repair only conservative paragraph and reference continuations.
export function normalizeCanonicalFlow(input: CanonicalBlock[]): CanonicalBlock[] {
  const blocks = [...input];

  for (let index = 0; index < blocks.length; index++) {
    const current = blocks[index];
    if (mergeStandaloneReference(blocks, index)) {
      index -= 1;
      continue;
    }
    if (current.blockType !== 'paragraph') continue;
    if (mergeAdjacentParagraph(blocks, index)) {
      index -= 1;
      continue;
    }
    if (mergeParagraphAroundTable(blocks, index)) index -= 1;
  }

  blocks.forEach((block, index) => { block.order = index; });
  return blocks;
}

function mergeStandaloneReference(blocks: CanonicalBlock[], index: number): boolean {
  const current = blocks[index];
  if (
    current.blockType !== 'reference' ||
    !isStandaloneReferenceIdentifier(current.text) ||
    index === 0 ||
    blocks[index - 1].blockType !== 'reference'
  ) return false;

  const previous = blocks[index - 1];
  previous.text = `${previous.text.trim()} ${current.text.trim()}`;
  previous.html = `<p>${escapeDoclingHtml(previous.text)}</p>`;
  blocks.splice(index, 1);
  return true;
}

function mergeAdjacentParagraph(blocks: CanonicalBlock[], index: number): boolean {
  const current = blocks[index];
  const next = blocks[index + 1];
  if (next?.blockType !== 'paragraph') return false;

  const samePage = next.pageNumber === current.pageNumber;
  const adjacentPage =
    typeof current.pageNumber === 'number' &&
    next.pageNumber === current.pageNumber + 1;
  const shortHardWrap =
    /[-\u00ad]\s*$/u.test(current.text) ||
    (current.text.trim().length < 180 && next.text.trim().length < 260);
  const pageBreak = adjacentPage && !endsSentence(current.text);
  if (!((samePage && shortHardWrap) || pageBreak) || !isSentenceContinuation(current.text, next.text)) {
    return false;
  }

  current.text = joinContinuation(current.text, next.text);
  current.html = `<p>${escapeDoclingHtml(current.text)}</p>`;
  blocks.splice(index + 1, 1);
  return true;
}

function mergeParagraphAroundTable(blocks: CanonicalBlock[], index: number): boolean {
  const current = blocks[index];
  let cursor = index + 1;
  let sawTable = false;

  while (cursor < blocks.length) {
    const candidate = blocks[cursor];
    if (candidate.blockType === 'table') {
      sawTable = true;
      cursor += 1;
      continue;
    }
    if (sawTable && candidate.blockType === 'paragraph' && /^note\s*[.:]/i.test(candidate.text.trim())) {
      cursor += 1;
      continue;
    }
    break;
  }

  const continuation = blocks[cursor];
  if (
    !sawTable ||
    continuation?.blockType !== 'paragraph' ||
    continuation.pageNumber !== current.pageNumber ||
    !isSentenceContinuation(current.text, continuation.text)
  ) return false;

  current.text = joinContinuation(current.text, continuation.text);
  current.html = `<p>${escapeDoclingHtml(current.text)}</p>`;
  blocks.splice(cursor, 1);
  return true;
}

function isStandaloneReferenceIdentifier(text: string): boolean {
  const clean = text.trim().replace(/[.,;]+$/, '');
  return /^(?:(?:https?:\/\/(?:dx\.)?doi\.org\/)|(?:doi\s*:\s*))?10\.\d{4,9}\/\S+$/i.test(clean);
}

function isSentenceContinuation(previous: string, next: string): boolean {
  return Boolean(previous.trim()) && /^\p{Ll}/u.test(next.trim()) && !endsSentence(previous);
}

function endsSentence(text: string): boolean {
  return /[.!?。！？:;"'”’\])}]$/.test(text.trim());
}

function joinContinuation(previous: string, next: string): string {
  const left = previous.trimEnd();
  const right = next.trimStart();
  return left.endsWith('-') ? `${left.slice(0, -1)}${right}` : `${left} ${right}`;
}
