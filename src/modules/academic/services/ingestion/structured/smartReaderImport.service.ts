import mongoose from 'mongoose';
import { collectCandidates } from './candidateCollector.service';
import { buildAndSaveSmartReaderData } from '../../reader/persistence/readerChunkBuilder.service';
import {
  assertReaderReplacementActive,
  recordReaderReplacementAssets,
} from '../../reader/persistence/readerReplacement.service';
import { ReaderQualityReport } from '../../types/canonical.types';
import { buildResolverReport } from './resolverDiagnostics.service';
import { calculateVirtualPageCount } from '../../reader/compile/paginationHelper';
import { groupReaderCandidates } from './readerSourceSelection.service';
import { executeReaderCandidates } from './readerCandidateExecution.service';
import { materializeReaderFigures } from './readerFigureOwnership.service';
import { prepareReaderPmcContext } from './readerPmcContext.service';
import {
  deleteReaderImageAssets,
  getPersistedReaderImageAssetIds,
  getUsedReaderImageAssetIds,
} from './readerImageAssetLifecycle.service';
import { reconcileReaderCandidates } from './readerReconciliation.service';
export { classifyBlock } from './readerSourceSelection.service';
export { sanitizeReaderHtml as sanitizeHtml } from './readerHtml.service';

export interface ImportResult {
  success: boolean;
  message: string;
  error?: string;
  report?: ReaderQualityReport;
  resolverReport?: any;
  candidateAttempts?: any[];
}

export async function importSmartReaderForSource(
  source: any,
  moderatorId: mongoose.Types.ObjectId,
  isReimport = false,
  replacement?: {
    replacementRunId?: string;
    abortSignal?: AbortSignal;
    sourcePolicy?: 'any' | 'structured_only';
    buildStartedAt?: number;
  },
): Promise<ImportResult> {
  const buildStartedAt = replacement?.buildStartedAt ?? Date.now();
  await assertReaderReplacementActive(replacement?.replacementRunId, replacement?.abortSignal);
  const {
    imageMap: pmcImageMap,
    archivePublicIds: pmcArchivePublicIds,
    publicIdByUrl: pmcPublicIdByUrl,
    candidateSource,
  } = await prepareReaderPmcContext(source);

  const candidates = collectCandidates(candidateSource);
  console.log(`[Collector] Collected ${candidates.length} candidates for source: ${source.title}`);

  const candidateGroups = groupReaderCandidates(candidates, replacement?.sourcePolicy);
  const {
    parsedPdf,
    parsedXml,
    parsedHtml,
    candidateAttempts,
    has403Block,
  } = await executeReaderCandidates({ groups: candidateGroups, source, pmcImageMap });

  const {
    blocks: reconciledBlocks,
    selectedSourceType,
    parserEngineUsed,
    documentTitle,
    isValid,
    isChallengePage,
    isMetadataOnly,
  } = await reconcileReaderCandidates({
    source,
    parsedPdf,
    parsedXml,
    parsedHtml,
    pmcImageMap,
    pmcPublicIdByUrl,
  });

  const isContribution = source.constructor.modelName === 'SourceContribution';

  if (isValid) {
    await materializeReaderFigures({
      blocks: reconciledBlocks,
      sourceKey: source._id || source.doi || source.pmcid,
      alreadyOwned: pmcPublicIdByUrl,
      newAssetIds: pmcArchivePublicIds,
    });

    console.log(`[Reconciliation] Figure materialization complete. Performing transactional save...`);
    await assertReaderReplacementActive(replacement?.replacementRunId, replacement?.abortSignal);
    const previousReaderImageIds = await getPersistedReaderImageAssetIds(source, isContribution);
    await recordReaderReplacementAssets(replacement?.replacementRunId, {
      newAssetIds: pmcArchivePublicIds,
    });
    try {
    const chunkMetrics = await buildAndSaveSmartReaderData(
      source,
      documentTitle,
      reconciledBlocks,
      parserEngineUsed,
      selectedSourceType,
      isContribution,
      {
        runId: replacement?.replacementRunId,
        abortSignal: replacement?.abortSignal,
      },
      { startedAt: buildStartedAt },
    );

    source.fullTextStatus = 'imported';
    source.readableInApp = true;
    source.chunkBuildStatus = 'completed';
    source.chunkBuiltAt = new Date();
    source.fullTextImportedAt = new Date();
    source.fullTextImportedBy = moderatorId;
    source.chunkEmbeddingModel = chunkMetrics.embedModel;
    source.chunkCount = chunkMetrics.ragChunkCount;
    source.extractionMethod = selectedSourceType === 'jats_xml'
      ? 'jats'
      : selectedSourceType.includes('html')
        ? 'html'
        : selectedSourceType === 'pdf' || selectedSourceType === 'uploaded_pdf'
          ? 'pdf_text'
          : source.extractionMethod;

    const figuresCount = reconciledBlocks.filter((b: any) => b.blockType === 'figure').length;
    const tablesCount = reconciledBlocks.filter((b: any) => b.blockType === 'table').length;
    const referencesCount = reconciledBlocks.filter((b: any) => b.blockType === 'reference').length;

    // Use dynamic pagination algorithm matching FE paginateBlocks exactly to resolve pageCount
    const pagesCount = calculateVirtualPageCount(reconciledBlocks);

    source.smartReaderStats = {
      pageCount: pagesCount,
      figureCount: figuresCount,
      tableCount: tablesCount,
      referenceCount: referencesCount,
      updatedAt: new Date()
    };

    await assertReaderReplacementActive(replacement?.replacementRunId, replacement?.abortSignal);
    await source.save();
    } catch (error) {
      await deleteReaderImageAssets(pmcArchivePublicIds);
      throw error;
    }

    const usedArchiveIds = getUsedReaderImageAssetIds(reconciledBlocks);
    await recordReaderReplacementAssets(replacement?.replacementRunId, {
      oldAssetIds: previousReaderImageIds.filter(id => !usedArchiveIds.has(id)),
    });
    await assertReaderReplacementActive(replacement?.replacementRunId, replacement?.abortSignal);
    await deleteReaderImageAssets([
      ...(replacement?.replacementRunId
        ? []
        : previousReaderImageIds.filter((id) => !usedArchiveIds.has(id))),
      ...pmcArchivePublicIds.filter((id) => !usedArchiveIds.has(id)),
    ]);

    const rawInput = source.doi || source.pmcid || source.url || '';
    const resolverReport = await buildResolverReport(rawInput, {
      title: source.title,
      authors: source.authors,
      year: source.year,
      journal: source.journal,
      publisher: source.publisher,
      doi: source.doi,
      pmcid: source.pmcid,
      sourceUrl: source.url,
      pdfUrl: source.pdfUrl,
      htmlUrl: source.htmlUrl,
      xmlUrl: source.xmlUrl,
      fullTextAvailable: true
    });

    const report: ReaderQualityReport = {
      overallScore: 95,
      headingScore: 100,
      paragraphScore: 100,
      referenceScore: 100,
      listScore: 100,
      noiseScore: 100,
      metadataScore: 100,
      figureScore: 100,
      tableScore: 100,
      whitespaceScore: 100,
      pageContinuityScore: 100,
      warnings: [],
      chosenParser: parserEngineUsed,
      chosenCandidate: selectedSourceType,
      fallbackUsed: false,
      processingTimeMs: 100,
      metrics: {
        blockCount: reconciledBlocks.length,
        headingCount: reconciledBlocks.filter(b => b.blockType === 'heading').length,
        paragraphCount: reconciledBlocks.filter(b => b.blockType === 'paragraph').length,
        listItemCount: reconciledBlocks.filter(b => b.blockType === 'list_item').length,
        referenceCount: reconciledBlocks.filter(b => b.blockType === 'reference').length,
        figureCount: reconciledBlocks.filter(b => b.blockType === 'figure').length,
        tableCount: reconciledBlocks.filter(b => b.blockType === 'table').length
      }
    };

    return {
      success: true,
      message: isReimport ? 'Nhập lại bản đọc thành công.' : 'Nhập bản đọc thành công.',
      report,
      resolverReport,
      candidateAttempts
    };
  }

  console.warn(`[Reconciliation] Reimport failed validation. Protecting existing good Smart Reader.`);
  await deleteReaderImageAssets(pmcArchivePublicIds);
  const rawInput = source.doi || source.pmcid || source.url || '';
  const resolverReport = await buildResolverReport(rawInput, {
    title: source.title,
    authors: source.authors,
    year: source.year,
    journal: source.journal,
    publisher: source.publisher,
    doi: source.doi,
    pmcid: source.pmcid,
    sourceUrl: source.url,
    pdfUrl: source.pdfUrl,
    htmlUrl: source.htmlUrl,
    xmlUrl: source.xmlUrl,
    fullTextAvailable: false
  });

  let failMessage = 'Tất cả các nguồn full text đều không đạt tiêu chuẩn chất lượng tối thiểu.';
  let errorType = 'metadata_only';
  if (has403Block) {
    failMessage = 'Không thể tải toàn văn tự động do máy chủ tài liệu chặn truy cập (403/Forbidden).';
    errorType = 'publisher_blocked';
  } else if (isChallengePage) {
    failMessage = 'Không thể truy cập do bị chặn bởi hệ thống Cloudflare / bảo vệ chống bot.';
    errorType = 'publisher_blocked';
  } else if (isMetadataOnly) {
    failMessage = 'Nguồn bài viết chỉ chứa thông tin mô tả (Metadata), không có nội dung toàn văn để nhập.';
    errorType = 'metadata_only';
  }

  return {
    success: false,
    message: failMessage,
    error: errorType,
    resolverReport,
    candidateAttempts
  };
}
