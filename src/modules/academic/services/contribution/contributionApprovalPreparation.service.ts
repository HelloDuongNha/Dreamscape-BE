import {
  ApprovalContribution,
  PreparedContribution,
  SourceMetadata,
} from '../../dto/contributionWorkflow.dto';
import AcademicDocument from '../../models/AcademicDocument';
import AcademicSource, {
  IAcademicSource,
} from '../../models/AcademicSource';
import { sanitizeAcademicSourceData } from '../source/sourceSanitizer';
import { loadContributionReaderStats } from './contributionReaderStats.service';

// Normalize contribution data and prepare its reader state for approval.
export async function prepareContribution(
  contribution: ApprovalContribution,
  title: string,
): Promise<PreparedContribution> {
  const rawMetadata = asMetadata(contribution.metadata);
  const metadata = sanitizeMetadata({
    title: title || rawMetadata.title || contribution.title,
    authors: rawMetadata.authors || contribution.authors,
    journal: rawMetadata.journal || rawMetadata.publisher || contribution.journal,
    publisher: rawMetadata.publisher || contribution.publisher,
    year: rawMetadata.year || contribution.year,
    doi: contribution.doi || rawMetadata.doi,
    url: contribution.url || rawMetadata.url,
    pdfUrl: contribution.pdfUrl || rawMetadata.pdfUrl,
    htmlUrl: contribution.htmlUrl || rawMetadata.htmlUrl,
    xmlUrl: contribution.xmlUrl || rawMetadata.xmlUrl,
    landingPageUrl: contribution.landingPageUrl || rawMetadata.landingPageUrl,
    openAccessStatus: contribution.openAccessStatus
      || rawMetadata.openAccessStatus
      || contribution.oaStatus
      || rawMetadata.oaStatus,
    allowedUse: contribution.allowedUse || rawMetadata.allowedUse,
    license: contribution.license || rawMetadata.license,
  });
  const uploadedPdf = hasUploadedPdf(contribution);
  const previewDocument = await AcademicDocument.findOne({
    previewContributionId: contribution._id,
  });

  applyMetadata(contribution, rawMetadata, metadata);
  if (uploadedPdf || previewDocument || contribution.readableInApp) {
    applyReaderAccess(contribution, uploadedPdf, Boolean(previewDocument));
  } else {
    applyMetadataOnlyAccess(contribution, metadata);
  }
  await repairReaderStatsBestEffort(contribution);

  return { metadata, uploadedPdf, previewDocument };
}

// Build the approved library source from its prepared contribution.
export function createAcademicSource(
  contribution: ApprovalContribution,
  prepared: PreparedContribution,
): IAcademicSource {
  const { metadata } = prepared;
  return new AcademicSource({
    sourceContributionId: contribution._id,
    doi: metadata.doi || contribution.doi,
    normalizedDoi: contribution.normalizedDoi,
    url: prepared.uploadedPdf ? contribution.url : metadata.url || contribution.url,
    normalizedUrl: contribution.normalizedUrl,
    metadata: contribution.metadata,
    license: contribution.license,
    allowedUse: contribution.allowedUse,
    copyrightStatus: contribution.copyrightStatus
      || (contribution.allowedUse === 'open_access_fulltext'
        ? 'copyrighted_with_open_access'
        : 'paywalled'),
    verificationStatus: contribution.verificationStatus || 'unverified',
    sourceQuality: contribution.sourceQuality || 'informal',
    fullTextStatus: contribution.fullTextStatus || 'none',
    fullTextUrl: contribution.fullTextUrl,
    oaStatus: contribution.oaStatus,
    openAccessStatus: contribution.openAccessStatus,
    readableInApp: contribution.readableInApp || false,
    fullTextSourceType: contribution.fullTextSourceType || 'unknown',
    landingPageUrl: metadata.landingPageUrl || contribution.landingPageUrl,
    pdfUrl: contribution.pdfUrl,
    xmlUrl: metadata.xmlUrl || contribution.xmlUrl,
    htmlUrl: metadata.htmlUrl || contribution.htmlUrl,
    title: metadata.title,
    authors: metadata.authors,
    journal: metadata.journal || metadata.publisher,
    year: metadata.year,
    originalFile: contribution.originalFile,
    sourceOrigin: contribution.sourceOrigin
      || (prepared.uploadedPdf ? 'uploaded_pdf' : 'doi_import'),
    extractionMethod: contribution.extractionMethod,
    extractionQuality: contribution.extractionQuality,
    pdfPageCount: contribution.pdfPageCount,
    detectedLanguage: contribution.detectedLanguage,
    readerBuildSnapshots: contribution.readerBuildSnapshots || [],
    pdfImportProgress: contribution.pdfImportProgress,
    pdfImportHistory: contribution.pdfImportHistory || [],
    smartReaderStats: contribution.smartReaderStats,
  });
}

function applyMetadata(
  contribution: ApprovalContribution,
  rawMetadata: Record<string, unknown>,
  metadata: SourceMetadata,
): void {
  contribution.metadata = { ...rawMetadata, ...metadata };
  contribution.title = metadata.title || contribution.title;
  contribution.authors = metadata.authors || contribution.authors;
  contribution.year = metadata.year || contribution.year;
  contribution.journal = metadata.journal || contribution.journal;
  contribution.publisher = metadata.publisher || contribution.publisher;
  contribution.openAccessStatus = metadata.openAccessStatus;
  contribution.oaStatus = metadata.oaStatus;
  contribution.license = metadata.license || contribution.license || 'all-rights-reserved';
  contribution.pdfUrl = metadata.pdfUrl || contribution.pdfUrl;
  contribution.htmlUrl = metadata.htmlUrl || contribution.htmlUrl;
}

function applyReaderAccess(
  contribution: ApprovalContribution,
  uploadedPdf: boolean,
  hasPreviewDocument: boolean,
): void {
  contribution.allowedUse = 'open_access_fulltext';
  contribution.readableInApp = true;
  contribution.fullTextStatus = hasPreviewDocument
    ? 'imported'
    : contribution.fullTextStatus || 'available';
  contribution.fullTextSourceType = uploadedPdf
    ? 'pdf'
    : contribution.fullTextSourceType || 'unknown';
  if (uploadedPdf) preferUploadedPdfUrl(contribution);
  contribution.copyrightStatus = contribution.copyrightStatus || 'paywalled';
  contribution.verificationStatus = contribution.verificationStatus || 'manual';
  contribution.metadata = {
    ...asMetadata(contribution.metadata),
    allowedUse: 'open_access_fulltext',
  };
  contribution.sourceOrigin = contribution.sourceOrigin
    || (uploadedPdf ? 'uploaded_pdf' : 'doi_import');
}

function applyMetadataOnlyAccess(
  contribution: ApprovalContribution,
  metadata: SourceMetadata,
): void {
  contribution.allowedUse = metadata.allowedUse
    || contribution.allowedUse
    || 'metadata_only';
  contribution.sourceOrigin = contribution.sourceOrigin
    || (contribution.doi ? 'doi_import' : 'url_import');
}

function preferUploadedPdfUrl(contribution: ApprovalContribution): void {
  const storedUrl = contribution.originalFile?.cloudinarySecureUrl;
  if (!contribution.pdfUrl || isCloudinaryUrl(contribution.pdfUrl)) {
    contribution.pdfUrl = storedUrl;
  }
  if (!contribution.fullTextUrl || isCloudinaryUrl(contribution.fullTextUrl)) {
    contribution.fullTextUrl = storedUrl;
  }
}

async function repairReaderStatsBestEffort(
  contribution: ApprovalContribution,
): Promise<void> {
  const hasReader = contribution.fullTextStatus === 'imported'
    || contribution.readableInApp;
  const needsStats = !contribution.smartReaderStats
    || contribution.smartReaderStats.pageCount <= 1;
  if (!hasReader || !needsStats) return;

  try {
    contribution.smartReaderStats = await loadContributionReaderStats(contribution._id)
      || contribution.smartReaderStats;
  } catch (error) {
    console.warn('Failed to compute smartReaderStats on approval fallback:', error);
  }
}

function sanitizeMetadata(input: Record<string, unknown>): SourceMetadata {
  return sanitizeAcademicSourceData(input) as SourceMetadata;
}

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasUploadedPdf(contribution: ApprovalContribution): boolean {
  return Boolean(
    contribution.originalFile
    && (contribution.originalFile.originalFileName
      || contribution.originalFile.cloudinarySecureUrl),
  );
}

function isCloudinaryUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return normalized.includes('cloudinary.com')
    || normalized.includes('res.cloudinary.com');
}
