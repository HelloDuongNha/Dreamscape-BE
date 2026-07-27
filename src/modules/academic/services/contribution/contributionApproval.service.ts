import AcademicDocument from '../../models/AcademicDocument';
import AcademicSource from '../../models/AcademicSource';
import { mapSourceOriginAndUrls } from '../source/academicSourceResponse.service';
import { sanitizeAcademicSourceData } from '../source/sourceSanitizer';
import { finalizeApprovedSource } from './contributionApprovalFinalization.service';
import { recordApproval } from './contributionStats.service';
import { loadContributionReaderStats } from './contributionReaderStats.service';

export type ContributionApprovalResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 409; body: Record<string, unknown> };

async function findDuplicateSource(contribution: any) {
  const conditions: any[] = [{ sourceContributionId: contribution._id }];
  if (contribution.normalizedDoi) {
    conditions.push({ normalizedDoi: contribution.normalizedDoi });
  }
  if (contribution.normalizedUrl) {
    conditions.push({ normalizedUrl: contribution.normalizedUrl });
  }
  return AcademicSource.findOne({ $or: conditions });
}

async function prepareContribution(contribution: any, title: string) {
  const rawMetadata = contribution.metadata || {};
  const metadata = sanitizeAcademicSourceData({
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

  const uploadedPdf = Boolean(
    contribution.originalFile
    && (contribution.originalFile.originalFileName
      || contribution.originalFile.cloudinarySecureUrl),
  );
  const previewDocument = await AcademicDocument.findOne({
    previewContributionId: contribution._id,
  });

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

  if (uploadedPdf || previewDocument || contribution.readableInApp) {
    contribution.allowedUse = 'open_access_fulltext';
    contribution.readableInApp = true;
    contribution.fullTextStatus = previewDocument
      ? 'imported'
      : contribution.fullTextStatus || 'available';
    contribution.fullTextSourceType = uploadedPdf
      ? 'pdf'
      : contribution.fullTextSourceType || 'unknown';
    if (uploadedPdf) {
      const isCloudinary = (url: string) => (
        url.toLowerCase().includes('cloudinary.com')
        || url.toLowerCase().includes('res.cloudinary.com')
      );
      if (!contribution.pdfUrl || isCloudinary(contribution.pdfUrl)) {
        contribution.pdfUrl = contribution.originalFile?.cloudinarySecureUrl;
      }
      if (!contribution.fullTextUrl || isCloudinary(contribution.fullTextUrl)) {
        contribution.fullTextUrl = contribution.originalFile?.cloudinarySecureUrl;
      }
    }
    contribution.copyrightStatus = contribution.copyrightStatus || 'paywalled';
    contribution.verificationStatus = contribution.verificationStatus || 'manual';
    contribution.metadata.allowedUse = 'open_access_fulltext';
    contribution.sourceOrigin = contribution.sourceOrigin
      || (uploadedPdf ? 'uploaded_pdf' : 'doi_import');
  } else {
    contribution.allowedUse = metadata.allowedUse || contribution.allowedUse || 'metadata_only';
    contribution.sourceOrigin = contribution.sourceOrigin
      || (contribution.doi ? 'doi_import' : 'url_import');
  }

  const needsStats = !contribution.smartReaderStats
    || (contribution.smartReaderStats.pageCount <= 1
      && (contribution.fullTextStatus === 'imported' || contribution.readableInApp));
  if (needsStats && (contribution.fullTextStatus === 'imported' || contribution.readableInApp)) {
    try {
      contribution.smartReaderStats = await loadContributionReaderStats(contribution._id)
        || contribution.smartReaderStats;
    } catch (error) {
      console.warn('Failed to compute smartReaderStats on approval fallback:', error);
    }
  }

  return { metadata, uploadedPdf, previewDocument };
}

function createAcademicSource(contribution: any, prepared: any) {
  const metadata = prepared.metadata;
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

export async function approveSourceContribution(
  contribution: any,
  reviewerId: any,
  title: string,
  reviewNote: string,
  reviewNoteProvided: boolean,
  previousStatus: string,
): Promise<ContributionApprovalResult> {
  if (await findDuplicateSource(contribution)) {
    return {
      status: 409,
      body: {
        success: false,
        message: 'An academic source with the same contribution ID, DOI, or URL already exists.',
      },
    };
  }

  const prepared = await prepareContribution(contribution, title);
  const academicSource = createAcademicSource(contribution, prepared);
  await academicSource.save();

  contribution.reviewStatus = 'approved';
  contribution.reviewedBy = reviewerId;
  contribution.reviewedAt = new Date();
  if (reviewNoteProvided) contribution.reviewNote = reviewNote || undefined;
  await contribution.save();

  if (previousStatus !== 'approved') {
    try {
      await recordApproval(contribution.submittedBy.toString(), contribution);
    } catch (error) {
      console.error('Failed to record contribution approval:', error);
    }
  }

  const outcome = await finalizeApprovedSource(
    academicSource,
    { ...prepared, contribution },
    reviewerId,
  );
  return {
    status: 200,
    body: {
      success: true,
      warning: outcome.warning,
      code: outcome.code,
      message: outcome.message,
      details: outcome.details,
      data: {
        contribution: mapSourceOriginAndUrls(contribution),
        academicSource: mapSourceOriginAndUrls(academicSource),
        fullText: outcome.fullText,
      },
    },
  };
}
