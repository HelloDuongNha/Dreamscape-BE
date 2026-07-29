import os from 'os';
import AcademicChunk from '../../../models/AcademicChunk';
import { deleteAsset } from '../../../../../infrastructure/storage/cloudinaryStorage.service';
import { CanonicalBlock } from '../../types/canonical.types';
import { DoclingArtifactDescriptor } from '../../types/docling.types';
import { ExtractedDocument } from '../../types/extractedDocument.types';

export function detectFrontMatterAuthors(blocks: CanonicalBlock[]): string[] | undefined {
  const firstBlocks = blocks.slice(0, 30);
  const rolePattern = /^(?:chủ\s*biên|tác\s*giả|author|editor|edited\s+by|editor-in-chief)\b/iu;
  for (let index = 0; index < firstBlocks.length - 1; index++) {
    const candidate = firstBlocks[index].text.trim();
    if (!rolePattern.test(firstBlocks[index + 1]?.text.trim() || '')) continue;
    const words = candidate.split(/\s+/).filter(Boolean);
    const isPersonName =
      words.length >= 2 &&
      words.length <= 7 &&
      candidate.length <= 100 &&
      !/[.!?:]$/.test(candidate) &&
      words.every(word => /^[\p{L}.'’()-]+$/u.test(word));
    if (isPersonName) return [titleCasePersonName(candidate)];
  }
  return undefined;
}

export function detectFrontMatterTitle(
  blocks: CanonicalBlock[],
  extractionTitle: string,
  originalFileName?: string,
): string | undefined {
  const fileKey = normalizedTitleKey(originalFileName || '');
  const extractionKey = normalizedTitleKey(extractionTitle);
  const blockCandidates = blocks
    .slice(0, 40)
    .filter(block => block.blockType === 'title')
    .map(block => normalizeDocumentTitle(block.text))
    .filter(isUsableFrontMatterTitle);
  const distinctTitle = blockCandidates.find(candidate => {
    const key = normalizedTitleKey(candidate);
    return key && key !== fileKey && key !== extractionKey;
  });
  if (distinctTitle) return distinctTitle;

  const normalizedExtractionTitle = normalizeDocumentTitle(extractionTitle);
  if (
    isUsableFrontMatterTitle(normalizedExtractionTitle) &&
    normalizedTitleKey(normalizedExtractionTitle) !== fileKey
  ) return normalizedExtractionTitle;
  return blockCandidates[0];
}

export function shouldReplaceStoredTitle(
  currentTitle: string | undefined,
  originalFileName: string | undefined,
): boolean {
  const currentKey = normalizedTitleKey(currentTitle || '');
  const fileKey = normalizedTitleKey(originalFileName || '');
  return !currentKey ||
    currentKey === fileKey ||
    /^(?:bandoc|smartreader|tailieupdf|tailieuhocThuat|untitled|document)$/iu.test(currentKey);
}

export function escapeDoclingImportHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getFigureDisplayWidth(
  artifact: DoclingArtifactDescriptor,
  imageScale: number,
): number | undefined {
  if (artifact.bbox) {
    const pdfPointWidth = Math.abs(artifact.bbox[2] - artifact.bbox[0]);
    if (Number.isFinite(pdfPointWidth) && pdfPointWidth > 0) {
      return Math.min(900, Math.max(1, Math.round(pdfPointWidth * (96 / 72))));
    }
  }
  if (!artifact.width || artifact.width <= 0) return undefined;
  return Math.min(900, Math.max(1, Math.round(artifact.width / Math.max(1, imageScale))));
}

export function getDoclingInputTempBase(): string {
  return process.env.DOCLING_INPUT_TEMP_DIR || os.tmpdir();
}

export async function getExistingDoclingAssetIds(
  targetType: 'contribution' | 'approved_source',
  targetId: string,
): Promise<string[]> {
  const readerFigure = { chunkPurpose: 'reader' as const, blockType: 'figure' as const };
  const query = targetType === 'contribution'
    ? { previewContributionId: targetId, ...readerFigure }
    : { sourceId: targetId, ...readerFigure };
  const chunks = await AcademicChunk.find(query).select('html').lean();
  const ids = new Set<string>();
  const pattern = /data-cloudinary-public-id="([^"]+)"/g;
  for (const chunk of chunks) {
    const html = String(chunk.html || '');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) ids.add(match[1]);
  }
  return [...ids];
}

export async function deleteDoclingImageAssets(publicIds: string[]): Promise<void> {
  await Promise.all(publicIds.map(async publicId => {
    try {
      await deleteAsset(publicId, 'image');
    } catch {
      // Asset cleanup is best effort.
    }
  }));
}

export function toDoclingExtractedDocument(
  blocks: CanonicalBlock[],
  pageCount: number,
  title: string,
): ExtractedDocument {
  const grouped = new Map<number, CanonicalBlock[]>();
  for (const block of blocks) {
    const page = Math.max(1, block.pageNumber || 1);
    grouped.set(page, [...(grouped.get(page) || []), block]);
  }
  const pages = [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([physicalPageNumber, pageBlocks], pageIndex) => {
      const text = pageBlocks.map(block => block.text).join(' ');
      return {
        pageIndex,
        physicalPageNumber,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        characterCount: text.length,
        blocks: pageBlocks.map((block, readingOrder) => ({
          blockType: block.blockType,
          text: block.text,
          html: block.html,
          tableData: block.tableData,
          pageNumber: physicalPageNumber,
          readingOrder,
          sectionHint: block.sectionHeading || undefined,
          confidence: 1,
          sourceMethod: 'docling' as const,
        })),
      };
    });
  const totalText = blocks.map(block => block.text).join(' ');
  const pagesWithText = pages.filter(page => page.characterCount > 0).length;
  return {
    title,
    pageCount,
    pages,
    totalWordCount: totalText.split(/\s+/).filter(Boolean).length,
    totalCharacterCount: totalText.length,
    extractedVia: 'docling',
    hasUsableTextLayer: totalText.trim().length > 0,
    qualitySignals: {
      pagesWithText,
      emptyPageCount: Math.max(0, pageCount - pagesWithText),
      averageCharactersPerPage: pageCount > 0 ? totalText.length / pageCount : totalText.length,
      lowTextPageCount: pages.filter(page => page.characterCount < 80).length,
    },
  };
}

function titleCasePersonName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(
    /(^|[\s-])\p{L}/gu,
    match => match.toLocaleUpperCase(),
  );
}

function normalizeDocumentTitle(value: string): string {
  return String(value || '')
    .normalize('NFC')
    .replace(/\.(?:pdf)$/iu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizedTitleKey(value: string): string {
  return normalizeDocumentTitle(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\p{L}]+/gu, '');
}

function isUsableFrontMatterTitle(value: string): boolean {
  const clean = normalizeDocumentTitle(value);
  if (clean.length < 4 || clean.length > 240) return false;
  if (/^(?:bản đọc thông minh|smart reader|document|tài liệu pdf|untitled)$/iu.test(clean)) return false;
  if (/https?:\/\/|www\.|thuviennotion/iu.test(clean)) return false;
  const words = clean.split(/\s+/u).filter(Boolean);
  return words.length >= 2 && words.length <= 32 && /[\p{L}]/u.test(clean);
}
