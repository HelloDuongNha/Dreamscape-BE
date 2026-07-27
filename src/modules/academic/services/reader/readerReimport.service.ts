import type { Types } from 'mongoose';
import { deleteAsset } from '../../../../infrastructure/storage/cloudinaryStorage.service';
import { removeRuleV3SourceData } from '../../../rules_v3/services/ruleV3Lifecycle.service';
import {
  ImportCandidate,
  ReaderReimportSource,
  ReimportResponse,
} from '../../dto/readerReimport.dto';
import AcademicChunk from '../../models/AcademicChunk';
import AcademicDocument from '../../models/AcademicDocument';
import AcademicSection from '../../models/AcademicSection';
import AcademicSource from '../../models/AcademicSource';
import SourceContribution from '../../models/SourceContribution';
import {
  ImportResult,
  importFullTextForSource,
} from '../source/fullTextImport.service';
import { recordReaderBuildFailure } from './history/readerBuildHistory.service';
import {
  beginReaderReplacement,
  captureReaderRuleBackup,
  completeReaderReplacement,
  rollbackReaderReplacement,
} from './persistence/readerReplacement.service';
import { resolveImportCandidate } from './readerReimportCandidate.service';

interface ReimportTarget {
  source: ReaderReimportSource;
  isContribution: boolean;
}

interface ReimportContext extends ReimportTarget {
  replacementRunId: string;
  hasExistingReader: boolean;
  warnings: string[];
}

// Re-import one reader while preserving the previous reader until commit.
export async function reimportReader(
  sourceId: string,
  moderatorId: Types.ObjectId,
): Promise<ReimportResponse> {
  const buildStartedAt = Date.now();
  const target = await loadReimportTarget(sourceId);
  if (!target) return sourceNotFoundResult();

  const candidate = await resolveImportCandidate(target.source, moderatorId);
  if (!candidate.url) {
    return handleMissingCandidate(target, buildStartedAt);
  }

  const context = await createReimportContext(target, candidate);
  try {
    const importResult = await importFullTextForSource(
      context.source,
      moderatorId,
      true,
      {
        replacementRunId: context.replacementRunId,
        sourcePolicy: 'structured_only',
        buildStartedAt,
      },
    );
    if (!importResult.success) {
      return handleImportFailure(context, importResult);
    }
    return commitSuccessfulImport(context, importResult);
  } catch (error: unknown) {
    return handleUnexpectedFailure(context, error);
  }
}

async function loadReimportTarget(sourceId: string): Promise<ReimportTarget | null> {
  const approvedSource = await AcademicSource.findById(sourceId);
  if (approvedSource) {
    return { source: approvedSource, isContribution: false };
  }
  const contribution = await SourceContribution.findById(sourceId);
  return contribution
    ? { source: contribution, isContribution: true }
    : null;
}

async function createReimportContext(
  target: ReimportTarget,
  candidate: ImportCandidate,
): Promise<ReimportContext> {
  const readerFilter: Record<string, unknown> = target.isContribution
    ? { previewContributionId: target.source._id, chunkPurpose: 'reader' }
    : { sourceId: target.source._id, chunkPurpose: 'reader' };
  const hasExistingReader = Boolean(await AcademicChunk.exists(readerFilter));
  const replacementRunId = await beginReaderReplacement({
    targetType: target.isContribution ? 'contribution' : 'approved_source',
    targetId: String(target.source._id),
    kind: 'structured',
  });
  return {
    ...target,
    replacementRunId,
    hasExistingReader,
    warnings: candidate.field
      ? [`Legacy import source recovered from: ${candidate.field}`]
      : [],
  };
}

async function handleMissingCandidate(
  target: ReimportTarget,
  buildStartedAt: number,
): Promise<ReimportResponse> {
  await recordReaderBuildFailure({
    sourceId: target.source._id,
    isContribution: target.isContribution,
    engine: 'structured_resolver',
    sourceType: 'doi_html_xml',
    failureCode: 'NO_FULLTEXT_IMPORT_SOURCE',
    failureMessage: 'Không tìm thấy nguồn DOI / HTML / XML toàn văn có thể dùng để nhập lại.',
    timing: { startedAt: buildStartedAt },
  }).catch(() => {});
  return {
    status: 422,
    body: {
      success: false,
      code: 'NO_FULLTEXT_IMPORT_SOURCE',
      message: 'Không tìm thấy nguồn DOI / HTML / XML toàn văn có thể dùng để nhập lại.',
      suggestion: 'Hãy kiểm tra DOI hoặc URL nguồn. Nếu muốn dùng tệp đã tải lên, chọn “Dựng lại từ PDF (Docling)”.',
    },
  };
}

async function handleImportFailure(
  context: ReimportContext,
  importResult: ImportResult,
): Promise<ReimportResponse> {
  const rollback = await rollbackReaderReplacement(
    context.replacementRunId,
    'failed',
  );
  await deleteImagesBestEffort(rollback.newAssetIds);
  if (!context.hasExistingReader) {
    await markSourceFailed(context.source._id, context.isContribution, {
      fullTextStatus: 'failed',
      readableInApp: false,
      chunkBuildStatus: 'failed',
      fullTextImportError: importResult.message || 'Lỗi không xác định.',
    });
  }
  return {
    status: 422,
    body: {
      success: false,
      error: importResult.error || 'candidate_fetch_failed',
      message: importResult.message || (
        context.hasExistingReader
          ? 'Phân tích văn bản thất bại. Giữ lại bản đọc cũ.'
          : 'Phân tích văn bản thất bại.'
      ),
      resolverReport: importResult.resolverReport,
      preservedExistingReader: context.hasExistingReader,
      warnings: context.warnings,
    },
  };
}

async function commitSuccessfulImport(
  context: ReimportContext,
  importResult: ImportResult,
): Promise<ReimportResponse> {
  const documentFilter = context.isContribution
    ? { previewContributionId: context.source._id }
    : { sourceId: context.source._id };
  const document = await AcademicDocument.findOne(documentFilter);
  const cleared = {
    fullText: document ? 1 : 0,
    sections: document
      ? await AcademicSection.countDocuments({ documentId: document._id })
      : 0,
    chunks: await AcademicChunk.countDocuments(
      context.isContribution
        ? { previewContributionId: context.source._id }
        : { sourceId: context.source._id },
    ),
    ruleEvidence: 0,
    rulesRemoved: 0,
    rulesRescored: 0,
  };

  await captureReaderRuleBackup(
    context.replacementRunId,
    String(context.source._id),
  );
  const cleanup = await removeRuleV3SourceData(String(context.source._id));
  cleared.ruleEvidence = cleanup.evidenceRemoved;
  cleared.rulesRemoved = cleanup.rulesRemoved;
  cleared.rulesRescored = cleanup.rulesRescored;

  const replacement = await completeReaderReplacement(context.replacementRunId);
  await deleteImagesBestEffort(replacement.oldAssetIds);
  return {
    status: 200,
    body: {
      success: true,
      reimported: true,
      cleared,
      importResult,
      warnings: context.warnings,
    },
  };
}

async function handleUnexpectedFailure(
  context: ReimportContext,
  error: unknown,
): Promise<ReimportResponse> {
  const message = error instanceof Error ? error.message : String(error);
  const cancelled = error instanceof Error
    && (error.name === 'AbortError' || message === 'reader_replacement_cancelled');
  const rollback = await rollbackReaderReplacement(
    context.replacementRunId,
    cancelled ? 'cancelled' : 'failed',
  ).catch(() => ({ newAssetIds: [] }));
  await deleteImagesBestEffort(rollback.newAssetIds);
  if (!context.hasExistingReader && !cancelled) {
    await markSourceFailed(context.source._id, context.isContribution, {
      fullTextStatus: 'failed',
      readableInApp: false,
      chunkBuildStatus: 'failed',
    });
  }
  return {
    status: 422,
    body: {
      success: false,
      error: 'candidate_fetch_failed',
      message,
      preservedExistingReader: context.hasExistingReader,
      warnings: [
        ...context.warnings,
        `Quá trình nạp bản đọc gặp lỗi: ${message}`,
      ],
    },
  };
}

async function markSourceFailed(
  sourceId: Types.ObjectId,
  isContribution: boolean,
  fields: Record<string, unknown>,
): Promise<void> {
  const filter = { _id: sourceId };
  if (isContribution) {
    await SourceContribution.updateOne(filter, { $set: fields });
    return;
  }
  await AcademicSource.updateOne(filter, { $set: fields });
}

async function deleteImagesBestEffort(assetIds: string[]): Promise<void> {
  await Promise.all(
    assetIds.map(id => deleteAsset(id, 'image').catch(() => undefined)),
  );
}

function sourceNotFoundResult(): ReimportResponse {
  return {
    status: 404,
    body: { success: false, message: 'Không tìm thấy tài liệu này.' },
  };
}
