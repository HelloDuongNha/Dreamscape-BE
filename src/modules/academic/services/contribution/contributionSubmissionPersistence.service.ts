import { Types } from 'mongoose';
import {
  ContributionServiceResult,
  DuplicateCondition,
} from '../../dto/contributionWorkflow.dto';
import { SourceImportResolverResult } from '../../dto/sourceImport.dto';
import SourceContribution, {
  ISourceContribution,
} from '../../models/SourceContribution';
import { normalizeSourceUrl } from '../source/sourceNormalization.service';

// Build all identifiers that can establish contribution identity.
export function buildDuplicateConditions(
  source: SourceImportResolverResult,
): DuplicateCondition[] {
  const conditions: DuplicateCondition[] = [];
  if (source.doi) conditions.push({ normalizedDoi: source.doi }, { doi: source.doi });
  if (source.pmcid) {
    conditions.push({ normalizedPmcid: source.pmcid }, { pmcid: source.pmcid });
  }
  if (source.isbn) {
    conditions.push({ isbn: source.isbn }, { 'metadata.isbn': source.isbn });
  }
  if (source.sourceUrl) {
    conditions.push(
      { normalizedUrl: normalizeSourceUrl(source.sourceUrl) },
      { url: source.sourceUrl },
    );
  }
  if (source.pdfUrl) {
    conditions.push(
      { pdfUrl: source.pdfUrl },
      { normalizedUrl: normalizeSourceUrl(source.pdfUrl) },
    );
  }
  if (source.originalFile?.cloudinaryPublicId) {
    conditions.push({
      'originalFile.cloudinaryPublicId': source.originalFile.cloudinaryPublicId,
    });
  }
  return conditions;
}

// Create the pending document before the workflow attempts persistence.
export function buildNewContribution(
  source: SourceImportResolverResult,
  submittedBy: Types.ObjectId,
  note: string,
): ISourceContribution {
  return new SourceContribution({
    submittedBy,
    doi: source.doi || undefined,
    normalizedDoi: source.doi || undefined,
    pmcid: source.pmcid || undefined,
    normalizedPmcid: source.pmcid || undefined,
    url: source.sourceUrl || undefined,
    normalizedUrl: source.sourceUrl ? normalizeSourceUrl(source.sourceUrl) : undefined,
    submittedNote: note || undefined,
    reviewStatus: 'pending',
    metadata: buildContributionMetadata(source),
    license: source.license || 'all-rights-reserved',
    allowedUse: source.allowedUse || 'metadata_only',
    verificationStatus: source.sourceType === 'doi' ? 'verified_doi' : 'unverified',
    sourceQuality: source.sourceType === 'doi' ? 'peer_reviewed' : 'informal',
    copyrightStatus: source.allowedUse === 'open_access_fulltext'
      ? 'copyrighted_with_open_access'
      : 'paywalled',
    fullTextStatus: source.fullTextAvailable ? 'available' : 'none',
    fullTextUrl: source.pdfUrl || source.htmlUrl || source.sourceUrl || undefined,
    oaStatus: source.openAccessStatus || 'closed',
    openAccessStatus: source.openAccessStatus || 'unknown',
    readableInApp: false,
    title: source.title,
    authors: source.authors,
    year: source.year,
    journal: source.journal,
    publisher: source.publisher,
    originalFile: source.originalFile,
    pdfUrl: source.pdfUrl || undefined,
    htmlUrl: source.htmlUrl || undefined,
  });
}

// Save a new contribution and recover deterministically from unique-index races.
export async function saveNewContribution(
  contribution: ISourceContribution,
  source: SourceImportResolverResult,
  conditions: DuplicateCondition[],
  submittedBy: Types.ObjectId,
  note: string,
): Promise<ContributionServiceResult | null> {
  try {
    await contribution.save();
    return null;
  } catch (error: unknown) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  const recovered = await SourceContribution.findOne({
    $or: conditions.length ? conditions : [{ _id: null }],
  });
  if (recovered?.reviewStatus === 'rejected') {
    await reactivateContribution(recovered, source, submittedBy, note);
    return {
      status: 201,
      body: {
        success: true,
        code: 'REACTIVATED',
        message: 'Đóng góp đã được kích hoạt lại.',
        data: recovered,
      },
    };
  }
  if (recovered) {
    return {
      status: 409,
      body: {
        success: false,
        code: 'DUPLICATE_CONTRIBUTION',
        message: 'Nguồn này đang chờ duyệt hoặc đã tồn tại.',
      },
    };
  }
  return {
    status: 409,
    body: {
      success: false,
      message: 'Không thể gửi đóng góp do trùng lặp dữ liệu.',
    },
  };
}

// Reset a rejected contribution while preserving its identity.
export async function reactivateContribution(
  contribution: ISourceContribution,
  source: SourceImportResolverResult,
  submittedBy: Types.ObjectId,
  note: string,
): Promise<void> {
  contribution.submittedBy = submittedBy;
  contribution.doi = source.doi || contribution.doi;
  contribution.normalizedDoi = source.doi || contribution.normalizedDoi;
  contribution.pmcid = source.pmcid || contribution.pmcid;
  contribution.normalizedPmcid = source.pmcid || contribution.normalizedPmcid;
  contribution.url = source.sourceUrl || contribution.url;
  contribution.normalizedUrl = source.sourceUrl
    ? normalizeSourceUrl(source.sourceUrl)
    : contribution.normalizedUrl;
  contribution.submittedNote = note || undefined;
  contribution.reviewStatus = 'pending';
  contribution.reviewedBy = undefined;
  contribution.reviewedAt = undefined;
  contribution.reviewNote = undefined;
  contribution.title = source.title || contribution.title;
  contribution.authors = source.authors || contribution.authors;
  contribution.year = source.year || contribution.year;
  contribution.license = source.license || contribution.license || 'all-rights-reserved';
  contribution.allowedUse = source.allowedUse || contribution.allowedUse || 'metadata_only';
  contribution.copyrightStatus = source.allowedUse === 'open_access_fulltext'
    ? 'copyrighted_with_open_access'
    : contribution.copyrightStatus || 'paywalled';
  contribution.fullTextStatus = source.fullTextAvailable ? 'available' : 'none';
  contribution.readableInApp = false;
  contribution.smartReaderStats = undefined;
  contribution.extractionStatus = undefined;
  contribution.extractionMethod = undefined;
  contribution.extractionQuality = undefined;
  contribution.pdfPageCount = undefined;
  contribution.detectedLanguage = undefined;
  contribution.detectedIdentifiers = undefined;
  contribution.originalFile = isValidOriginalFile(source.originalFile)
    ? source.originalFile
    : undefined;
  contribution.pdfUrl = source.pdfUrl || undefined;
  contribution.htmlUrl = source.htmlUrl || undefined;
  contribution.metadata = buildContributionMetadata(source);
  await contribution.save();
}

function buildContributionMetadata(
  source: SourceImportResolverResult,
): Record<string, unknown> {
  return {
    title: source.title,
    authors: source.authors,
    year: source.year,
    journal: source.journal,
    publisher: source.publisher,
    doi: source.doi,
    isbn: source.isbn,
    url: source.sourceUrl,
    pdfUrl: source.pdfUrl,
    htmlUrl: source.htmlUrl,
    allowedUse: source.allowedUse,
    openAccessStatus: source.openAccessStatus,
    oaStatus: source.openAccessStatus,
    fullTextAvailable: source.fullTextAvailable,
    warnings: source.warnings,
    metadataProvider: source.metadataProvider,
  };
}

function isValidOriginalFile(
  file: SourceImportResolverResult['originalFile'],
): file is NonNullable<SourceImportResolverResult['originalFile']> {
  return Boolean(file?.cloudinaryPublicId && file.cloudinarySecureUrl);
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return error !== null
    && typeof error === 'object'
    && 'code' in error
    && error.code === 11000;
}
