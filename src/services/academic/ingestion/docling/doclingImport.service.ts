import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import AcademicChunk from '../../../../models/AcademicChunk';
import { deleteAsset, uploadDocumentImage } from '../../../storage/cloudinaryStorage.service';
import { downloadOriginalPdfAsset, OriginalPdfReference } from '../../../storage/originalPdfStorage.service';
import { compileExtractedDocument, CompileExtractedDocumentResult } from '../../reader/compile/documentCompiler.service';
import { DoclingAdapterService } from './doclingAdapter.service';
import { DoclingArtifactDescriptor } from '../../types/docling.types';
import { DoclingClientService } from './doclingClient.service';
import { CanonicalBlock } from '../../types/canonical.types';
import { ExtractedDocument } from '../../types/extractedDocument.types';

export interface DoclingImportInput {
  targetType: 'contribution' | 'approved_source';
  targetId: string;
  originalFile: OriginalPdfReference;
  forceReplace?: boolean;
  doOcr?: boolean;
}

export interface DoclingImportResult {
  compileResult: CompileExtractedDocumentResult;
  detectedPictureCount: number;
  acceptedFigureCount: number;
  discardedFurnitureCount: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getFigureDisplayWidth(artifact: DoclingArtifactDescriptor, imageScale: number): number | undefined {
  if (artifact.bbox) {
    const pdfPointWidth = Math.abs(artifact.bbox[2] - artifact.bbox[0]);
    if (Number.isFinite(pdfPointWidth) && pdfPointWidth > 0) {
      // PDF coordinates are points. Convert to CSS pixels without stretching
      // the extracted 2x raster beyond the physical figure region.
      return Math.min(900, Math.max(1, Math.round(pdfPointWidth * (96 / 72))));
    }
  }
  if (artifact.width && artifact.width > 0) {
    return Math.min(900, Math.max(1, Math.round(artifact.width / Math.max(1, imageScale))));
  }
  return undefined;
}

function getInputTempBase(): string {
  return process.env.DOCLING_INPUT_TEMP_DIR || os.tmpdir();
}

async function getExistingDoclingAssetIds(targetType: 'contribution' | 'approved_source', targetId: string): Promise<string[]> {
  const query: any = targetType === 'contribution'
    ? { previewContributionId: targetId, chunkPurpose: 'reader', blockType: 'figure' }
    : { sourceId: targetId, chunkPurpose: 'reader', blockType: 'figure' };
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

async function deleteImageAssets(publicIds: string[]): Promise<void> {
  await Promise.all(publicIds.map(async (publicId) => {
    try { await deleteAsset(publicId, 'image'); } catch { /* best-effort cleanup */ }
  }));
}

function toExtractedDocument(blocks: CanonicalBlock[], pageCount: number, title: string): ExtractedDocument {
  const grouped = new Map<number, CanonicalBlock[]>();
  for (const block of blocks) {
    const page = Math.max(1, block.pageNumber || 1);
    if (!grouped.has(page)) grouped.set(page, []);
    grouped.get(page)!.push(block);
  }
  const pages = [...grouped.entries()].sort(([a], [b]) => a - b).map(([physicalPageNumber, pageBlocks], pageIndex) => {
    const text = pageBlocks.map((block) => block.text).join(' ');
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
        sourceMethod: 'docling' as const
      }))
    };
  });
  const totalText = blocks.map((block) => block.text).join(' ');
  return {
    title,
    pageCount,
    pages,
    totalWordCount: totalText.split(/\s+/).filter(Boolean).length,
    totalCharacterCount: totalText.length,
    extractedVia: 'docling',
    hasUsableTextLayer: totalText.trim().length > 0,
    qualitySignals: {
      pagesWithText: pages.filter((page) => page.characterCount > 0).length,
      emptyPageCount: Math.max(0, pageCount - pages.filter((page) => page.characterCount > 0).length),
      averageCharactersPerPage: pageCount > 0 ? totalText.length / pageCount : totalText.length,
      lowTextPageCount: pages.filter((page) => page.characterCount < 80).length
    }
  };
}

export async function runDoclingPdfImport(input: DoclingImportInput): Promise<DoclingImportResult> {
  if (!(await DoclingClientService.isAvailable())) {
    throw new Error('Trình phân tích Docling chưa sẵn sàng trên máy chủ này.');
  }

  const pdfBuffer = await downloadOriginalPdfAsset(input.originalFile);
  const inputBase = path.resolve(getInputTempBase());
  const inputDir = fs.mkdtempSync(path.join(inputBase, 'docling-import-'));
  fs.chmodSync(inputDir, 0o700);
  const realInputDir = fs.realpathSync(inputDir);
  const relative = path.relative(inputBase, realInputDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fs.rmSync(inputDir, { recursive: true, force: true });
    throw new Error('Đường dẫn xử lý PDF tạm thời không hợp lệ.');
  }

  const pdfPath = path.join(realInputDir, 'document.pdf');
  fs.writeFileSync(pdfPath, pdfBuffer, { mode: 0o600 });
  let runCleanup: (() => Promise<void>) | undefined;
  const uploadedIds: string[] = [];

  try {
    const run = await DoclingClientService.extractPdf(pdfPath, input.doOcr === true);
    runCleanup = run.cleanup;
    if (!run.result.success) throw new Error(run.result.errorDetail || 'Docling không thể phân tích PDF.');

    const adapter = DoclingAdapterService.mapToCanonicalBlocks(run.result, run.artifacts);
    const figureBlocks = adapter.canonicalOutput.blocks.filter((block) => block.blockType === 'figure');
    if (figureBlocks.length !== adapter.figureArtifacts.length) {
      throw new Error('Không thể đối chiếu figure Docling với artifact đã trích xuất.');
    }

    for (let index = 0; index < figureBlocks.length; index++) {
      const block = figureBlocks[index];
      const artifact: DoclingArtifactDescriptor = adapter.figureArtifacts[index];
      if (!artifact.filePath || artifact.figureType === 'region_only') {
        block.html = `<figure class="figure-block"><figcaption class="caption">${escapeHtml(block.text)}</figcaption></figure>`;
        continue;
      }
      const assetName = `docling/${input.targetType}/${input.targetId}/${artifact.itemId}-${crypto.randomUUID()}`;
      const uploaded = await uploadDocumentImage(artifact.filePath, assetName);
      uploadedIds.push(uploaded.public_id);
      block.imageUrl = uploaded.secure_url;
      const displayWidth = getFigureDisplayWidth(artifact, run.result.imageScale || 1);
      const widthAttribute = displayWidth ? ` width="${displayWidth}"` : '';
      block.html = `<figure class="figure-block docling-figure-block" data-cloudinary-public-id="${escapeHtml(uploaded.public_id)}"><img class="figure-img docling-figure-img" src="${escapeHtml(uploaded.secure_url)}" alt="${escapeHtml(block.text || 'Scientific figure')}"${widthAttribute}/><figcaption class="caption">${escapeHtml(block.text)}</figcaption></figure>`;
    }

    const oldAssetIds = await getExistingDoclingAssetIds(input.targetType, input.targetId);
    const extractedDocument = toExtractedDocument(
      adapter.canonicalOutput.blocks,
      run.result.pageCount,
      adapter.canonicalOutput.title
    );
    const compileResult = await compileExtractedDocument({
      targetType: input.targetType,
      targetId: input.targetId,
      extractedDocument,
      extractionMethod: 'pdf_text',
      forceReplace: input.forceReplace,
      parserEngine: 'docling',
      sourceType: 'uploaded_pdf'
    });

    if (!compileResult.success) {
      await deleteImageAssets(uploadedIds);
      return {
        compileResult,
        detectedPictureCount: adapter.detectedPictureCount,
        acceptedFigureCount: adapter.acceptedFigureCount,
        discardedFurnitureCount: adapter.discardedFurnitureCount
      };
    }

    await deleteImageAssets(oldAssetIds.filter((id) => !uploadedIds.includes(id)));
    return {
      compileResult,
      detectedPictureCount: adapter.detectedPictureCount,
      acceptedFigureCount: adapter.acceptedFigureCount,
      discardedFurnitureCount: adapter.discardedFurnitureCount
    };
  } catch (error) {
    await deleteImageAssets(uploadedIds);
    throw error;
  } finally {
    try { fs.rmSync(realInputDir, { recursive: true, force: true }); } catch { /* already removed */ }
    if (runCleanup) await runCleanup().catch(() => {});
  }
}
