import AcademicSource from '../../models/AcademicSource';
import SourceContribution from '../../models/SourceContribution';
import { buildResolverReport } from '../ingestion/structured/resolverDiagnostics.service';
import { resolveSourceImport } from '../source/sourceImportResolver.service';
import { normalizeSourceUrl } from '../source/sourceNormalization.service';
import { incrementSubmitted } from './contributionStats.service';

export interface ContributionServiceResult {
  status: number;
  body: Record<string, unknown>;
}

function isValidOriginalFile(file: any): boolean {
  if (!file) return false;
  if (file.storageProvider === 'firebase') {
    return Boolean(file.firebaseStorageBucket && file.firebaseStoragePath);
  }
  if (file.storageProvider === 'cloudinary') {
    return Boolean(file.cloudinaryPublicId && file.cloudinarySecureUrl);
  }
  return Boolean(file.storageProvider && file.originalFileName);
}

async function reactivateContribution(
  contribution: any,
  source: any,
  submittedBy: any,
  note: string,
) {
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

function buildContributionMetadata(source: any) {
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

function buildDuplicateConditions(source: any): any[] {
  const conditions: any[] = [];
  if (source.doi) conditions.push({ normalizedDoi: source.doi }, { doi: source.doi });
  if (source.pmcid) conditions.push({ normalizedPmcid: source.pmcid }, { pmcid: source.pmcid });
  if (source.isbn) conditions.push({ isbn: source.isbn }, { 'metadata.isbn': source.isbn });
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
    conditions.push({ 'originalFile.cloudinaryPublicId': source.originalFile.cloudinaryPublicId });
  }
  return conditions;
}

export async function previewSourceContribution(body: any, userId: any) {
  const source = await resolveSourceImport(body, userId);
  const rawInput = body.doi || body.pmcid || body.url || '';
  const resolverReport = await buildResolverReport(rawInput, source);
  return {
    title: source.title,
    authors: source.authors,
    year: source.year,
    journal: source.journal,
    publisher: source.publisher,
    doi: source.doi,
    pmcid: source.pmcid,
    isbn: source.isbn,
    url: source.sourceUrl,
    pdfUrl: source.pdfUrl,
    htmlUrl: source.htmlUrl,
    allowedUse: source.allowedUse,
    openAccessStatus: source.openAccessStatus,
    oaStatus: source.openAccessStatus,
    fullTextAvailable: source.fullTextAvailable,
    originalFile: source.originalFile,
    warnings: source.warnings,
    metadataProvider: source.metadataProvider,
    sourceProvider: source.sourceType === 'doi' ? 'crossref' : 'manual_url',
    verificationStatus: source.sourceType === 'doi' ? 'verified_doi' : 'unverified',
    copyrightStatus: source.allowedUse === 'open_access_fulltext'
      ? 'copyrighted_with_open_access'
      : 'paywalled',
    fullTextStatus: source.fullTextAvailable ? 'available' : 'none',
    fullTextUrl: source.pdfUrl || source.htmlUrl || source.sourceUrl || '',
    readableInApp: false,
    fullTextSourceType: source.sourceType === 'pdf_upload' ? 'pdf' : 'unknown',
    resolverReport,
  };
}

export async function submitSourceContribution(
  body: any,
  submittedBy: any,
  note: string,
): Promise<ContributionServiceResult> {
  const source = await resolveSourceImport(body, submittedBy);
  const conditions = buildDuplicateConditions(source);

  if (conditions.length) {
    const existingContribution = await SourceContribution.findOne({
      reviewStatus: { $ne: 'rejected' },
      $or: conditions,
    });
    const existingSource = await AcademicSource.findOne({ $or: conditions });
    if (existingSource) {
      return {
        status: 409,
        body: {
          success: false,
          code: 'DUPLICATE_SOURCE',
          message: 'Nguồn này đã tồn tại trong thư viện.',
        },
      };
    }
    if (existingContribution) {
      return {
        status: 409,
        body: {
          success: false,
          code: 'DUPLICATE_CONTRIBUTION',
          message: 'Nguồn này đã được gửi hoặc đang chờ duyệt.',
        },
      };
    }

    const rejected = await SourceContribution.findOne({
      reviewStatus: 'rejected',
      $or: conditions,
    });
    if (rejected) {
      await reactivateContribution(rejected, source, submittedBy, note);
      try { await incrementSubmitted(submittedBy.toString()); } catch {}
      const rawInput = body.doi || body.pmcid || body.url || '';
      return {
        status: 201,
        body: {
          success: true,
          code: 'REACTIVATED',
          message: 'Đóng góp trước bị từ chối đã được kích hoạt lại.',
          data: rejected,
          resolverReport: await buildResolverReport(rawInput, source),
        },
      };
    }
  }

  const contribution = new SourceContribution({
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

  try {
    await contribution.save();
  } catch (error: any) {
    if (error.code !== 11000) throw error;
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

  try {
    await incrementSubmitted(submittedBy.toString());
  } catch (error) {
    console.error('Failed to increment contribution stats:', error);
  }

  const rawInput = body.doi || body.pmcid || body.url || '';
  return {
    status: 201,
    body: {
      success: true,
      message: 'Source contribution submitted successfully.',
      data: contribution,
      resolverReport: await buildResolverReport(rawInput, source),
    },
  };
}
