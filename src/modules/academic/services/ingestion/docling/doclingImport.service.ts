import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AcademicSource from '../../../models/AcademicSource';
import SourceContribution from '../../../models/SourceContribution';
import { uploadDocumentImage } from '../../../../../infrastructure/storage/cloudinaryStorage.service';
import { downloadOriginalPdfAsset, OriginalPdfReference } from '../../storage/originalPdfStorage.service';
import { compileExtractedDocument, CompileExtractedDocumentResult } from '../../reader/compile/documentCompiler.service';
import { DoclingAdapterService } from './doclingAdapter.service';
import { DoclingArtifactDescriptor } from '../../types/docling.types';
import { DoclingClientService } from './doclingClient.service';
import {
  assertReaderReplacementActive,
  recordReaderReplacementAssets,
} from '../../reader/persistence/readerReplacement.service';
import {
  deleteDoclingImageAssets,
  detectFrontMatterAuthors,
  detectFrontMatterTitle,
  escapeDoclingImportHtml,
  getDoclingInputTempBase,
  getExistingDoclingAssetIds,
  getFigureDisplayWidth,
  shouldReplaceStoredTitle,
  toDoclingExtractedDocument,
} from './doclingImportSupport.service';
import { DoclingDocumentRepairProfileService } from './doclingDocumentRepairProfile.service';

export { detectFrontMatterAuthors } from './doclingImportSupport.service';

export interface DoclingImportInput {
  targetType: 'contribution' | 'approved_source';
  targetId: string;
  originalFile: OriginalPdfReference;
  forceReplace?: boolean;
  doOcr?: boolean;
  abortSignal?: AbortSignal;
  replacementRunId?: string;
  buildTiming?: {
    startedAt?: number;
    estimatedDurationSeconds?: number;
    pageCount?: number;
    ocrUsed?: boolean;
  };
  onStage?: (stage: 'parsing_layout' | 'cleaning_ocr' | 'compiling_reader', details?: { pageCount: number }) => Promise<void>;
}

export interface DoclingImportResult {
  compileResult: CompileExtractedDocumentResult;
  detectedPictureCount: number;
  acceptedFigureCount: number;
  discardedFurnitureCount: number;
  metadataHints?: {
    authors?: string[];
    title?: string;
  };
}

export async function runDoclingPdfImport(input: DoclingImportInput): Promise<DoclingImportResult> {
  const throwIfCancelled = () => {
    if (input.abortSignal?.aborted) {
      const error = new Error('pdf_import_cancelled');
      error.name = 'AbortError';
      throw error;
    }
  };
  if (!(await DoclingClientService.isAvailable())) {
    throw new Error('Trình phân tích Docling chưa sẵn sàng trên máy chủ này.');
  }

  const pdfBuffer = await downloadOriginalPdfAsset(input.originalFile);
  const inputBase = path.resolve(getDoclingInputTempBase());
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
    const run = await DoclingClientService.extractPdf(pdfPath, input.doOcr === true, input.abortSignal);
    runCleanup = run.cleanup;
    if (!run.result.success) {
      const extractionError = new Error(run.result.errorDetail || 'Docling không thể phân tích PDF.') as Error & {
        code?: string;
      };
      extractionError.code = run.result.errorCode || 'DOCLING_EXTRACTION_FAILED';
      throw extractionError;
    }
    throwIfCancelled();

    await input.onStage?.('parsing_layout', { pageCount: run.result.pageCount });
    await input.onStage?.('cleaning_ocr', { pageCount: run.result.pageCount });
    const adapter = DoclingAdapterService.mapToCanonicalBlocks(run.result, run.artifacts);
    adapter.canonicalOutput.blocks = DoclingDocumentRepairProfileService.apply(
      adapter.canonicalOutput.blocks,
      input.originalFile.fileHash,
    );
    const frontMatterAuthors = detectFrontMatterAuthors(adapter.canonicalOutput.blocks);
    const frontMatterTitle = detectFrontMatterTitle(
      adapter.canonicalOutput.blocks,
      adapter.canonicalOutput.title,
      input.originalFile.originalFileName,
    );
    if (frontMatterTitle) {
      adapter.canonicalOutput.title = frontMatterTitle;
    }
    const figureBlocks = adapter.canonicalOutput.blocks.filter((block) => block.blockType === 'figure');
    if (figureBlocks.length !== adapter.figureArtifacts.length) {
      throw new Error('Không thể đối chiếu figure Docling với artifact đã trích xuất.');
    }

    for (let index = 0; index < figureBlocks.length; index++) {
      throwIfCancelled();
      const block = figureBlocks[index];
      const artifact: DoclingArtifactDescriptor = adapter.figureArtifacts[index];
      if (!artifact.filePath || artifact.figureType === 'region_only') {
        block.html = `<figure class="figure-block"><figcaption class="caption">${escapeDoclingImportHtml(block.text)}</figcaption></figure>`;
        continue;
      }
      const assetName = `docling/${input.targetType}/${input.targetId}/${artifact.itemId}-${crypto.randomUUID()}`;
      const uploaded = await uploadDocumentImage(artifact.filePath, assetName);
      uploadedIds.push(uploaded.public_id);
      await recordReaderReplacementAssets(input.replacementRunId, { newAssetIds: [uploaded.public_id] });
      block.imageUrl = uploaded.secure_url;
      const displayWidth = getFigureDisplayWidth(artifact, run.result.imageScale || 1);
      const widthAttribute = displayWidth ? ` width="${displayWidth}"` : '';
      block.html = `<figure class="figure-block docling-figure-block" data-cloudinary-public-id="${escapeDoclingImportHtml(uploaded.public_id)}"><img class="figure-img docling-figure-img" src="${escapeDoclingImportHtml(uploaded.secure_url)}" alt="${escapeDoclingImportHtml(block.text || 'Scientific figure')}"${widthAttribute}/><figcaption class="caption">${escapeDoclingImportHtml(block.text)}</figcaption></figure>`;
    }

    const oldAssetIds = await getExistingDoclingAssetIds(input.targetType, input.targetId);
    await recordReaderReplacementAssets(input.replacementRunId, { oldAssetIds });
    const extractedDocument = toDoclingExtractedDocument(
      adapter.canonicalOutput.blocks,
      run.result.pageCount,
      adapter.canonicalOutput.title
    );
    throwIfCancelled();
    await input.onStage?.('compiling_reader', { pageCount: run.result.pageCount });
    const compileResult = await compileExtractedDocument({
      targetType: input.targetType,
      targetId: input.targetId,
      extractedDocument,
      extractionMethod: input.doOcr ? 'ocr' : 'pdf_text',
      forceReplace: input.forceReplace,
      parserEngine: 'docling',
      sourceType: 'uploaded_pdf',
      replacementRunId: input.replacementRunId,
      abortSignal: input.abortSignal,
      buildTiming: {
        ...input.buildTiming,
        pageCount: run.result.pageCount,
        ocrUsed: input.doOcr === true,
      },
    });

    if (!compileResult.success) {
      await deleteDoclingImageAssets(uploadedIds);
      return {
        compileResult,
        detectedPictureCount: adapter.detectedPictureCount,
        acceptedFigureCount: adapter.acceptedFigureCount,
        discardedFurnitureCount: adapter.discardedFurnitureCount,
        metadataHints: { authors: frontMatterAuthors, title: frontMatterTitle }
      };
    }

    await assertReaderReplacementActive(input.replacementRunId, input.abortSignal);
    const targetModel: any = input.targetType === 'contribution' ? SourceContribution : AcademicSource;
    const currentTarget = await targetModel.findById(input.targetId).select('title metadata').lean();
    if (
      frontMatterTitle &&
      currentTarget &&
      shouldReplaceStoredTitle(currentTarget.title, input.originalFile.originalFileName)
    ) {
      await targetModel.updateOne(
        { _id: input.targetId },
        { $set: { title: frontMatterTitle, 'metadata.title': frontMatterTitle } },
      );
    }
    return {
      compileResult,
      detectedPictureCount: adapter.detectedPictureCount,
      acceptedFigureCount: adapter.acceptedFigureCount,
      discardedFurnitureCount: adapter.discardedFurnitureCount,
      metadataHints: { authors: frontMatterAuthors, title: frontMatterTitle }
    };
  } catch (error) {
    await deleteDoclingImageAssets(uploadedIds);
    throw error;
  } finally {
    try { fs.rmSync(realInputDir, { recursive: true, force: true }); } catch { /* already removed */ }
    if (runCleanup) await runCleanup().catch(() => {});
  }
}
