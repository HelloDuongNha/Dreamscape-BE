import { Types } from 'mongoose';
import {
  ContributionServiceResult,
  DuplicateCondition,
} from '../../dto/contributionWorkflow.dto';
import {
  SourceImportResolverInput,
  SourceImportResolverResult,
} from '../../dto/sourceImport.dto';
import AcademicSource from '../../models/AcademicSource';
import SourceContribution from '../../models/SourceContribution';
import { buildResolverReport } from '../ingestion/structured/resolverDiagnostics.service';
import { resolveSourceImport } from '../source/sourceImportResolver.service';
import { incrementSubmitted } from './contributionStats.service';
import {
  buildDuplicateConditions,
  buildNewContribution,
  reactivateContribution,
  saveNewContribution,
} from './contributionSubmissionPersistence.service';

// Preview one source through the same resolver used by contribution submission.
export async function previewSourceContribution(
  input: SourceImportResolverInput,
  userId?: Types.ObjectId,
): Promise<Record<string, unknown>> {
  const source = await resolveSourceImport(input, userId);
  const resolverReport = await buildResolverReport(rawResolverInput(input), source);
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

// Resolve, deduplicate and persist one academic-source contribution.
export async function submitSourceContribution(
  input: SourceImportResolverInput,
  submittedBy: Types.ObjectId,
  note: string,
): Promise<ContributionServiceResult> {
  const source = await resolveSourceImport(input, submittedBy);
  const conditions = buildDuplicateConditions(source);

  const existingResult = await handleExistingContribution(
    source,
    conditions,
    submittedBy,
    note,
    input,
  );
  if (existingResult) return existingResult;

  const contribution = buildNewContribution(source, submittedBy, note);
  const collisionResult = await saveNewContribution(
    contribution,
    source,
    conditions,
    submittedBy,
    note,
  );
  if (collisionResult) return collisionResult;

  await recordSubmissionBestEffort(submittedBy);
  return {
    status: 201,
    body: {
      success: true,
      message: 'Source contribution submitted successfully.',
      data: contribution,
      resolverReport: await buildResolverReport(rawResolverInput(input), source),
    },
  };
}

async function handleExistingContribution(
  source: SourceImportResolverResult,
  conditions: DuplicateCondition[],
  submittedBy: Types.ObjectId,
  note: string,
  input: SourceImportResolverInput,
): Promise<ContributionServiceResult | null> {
  if (conditions.length === 0) return null;

  const existingContribution = await SourceContribution.findOne({
    reviewStatus: { $ne: 'rejected' },
    $or: conditions,
  });
  const existingSource = await AcademicSource.findOne({ $or: conditions });
  if (existingSource) {
    return duplicateResult('DUPLICATE_SOURCE', 'Nguồn này đã tồn tại trong thư viện.');
  }
  if (existingContribution) {
    return duplicateResult(
      'DUPLICATE_CONTRIBUTION',
      'Nguồn này đã được gửi hoặc đang chờ duyệt.',
    );
  }

  const rejected = await SourceContribution.findOne({
    reviewStatus: 'rejected',
    $or: conditions,
  });
  if (!rejected) return null;

  await reactivateContribution(rejected, source, submittedBy, note);
  await recordSubmissionBestEffort(submittedBy);
  return {
    status: 201,
    body: {
      success: true,
      code: 'REACTIVATED',
      message: 'Đóng góp trước bị từ chối đã được kích hoạt lại.',
      data: rejected,
      resolverReport: await buildResolverReport(rawResolverInput(input), source),
    },
  };
}

function duplicateResult(code: string, message: string): ContributionServiceResult {
  return { status: 409, body: { success: false, code, message } };
}

async function recordSubmissionBestEffort(submittedBy: Types.ObjectId): Promise<void> {
  try {
    await incrementSubmitted(submittedBy.toString());
  } catch (error) {
    console.error('Failed to increment contribution stats:', error);
  }
}

function rawResolverInput(input: SourceImportResolverInput): string {
  return input.doi || input.pmcid || input.url || '';
}
