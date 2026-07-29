import { Types } from 'mongoose';
import {
  ImportCandidate,
  ReaderReimportSource,
} from '../../dto/readerReimport.dto';
import AcademicDocument from '../../models/AcademicDocument';
import { resolveSourceImport } from '../source/sourceImportResolver.service';

const EMPTY_CANDIDATE: ImportCandidate = { field: '', url: '' };

// Resolve a structured re-import URL from stored data before using identifiers.
export async function resolveImportCandidate(
  source: ReaderReimportSource,
  moderatorId: Types.ObjectId,
): Promise<ImportCandidate> {
  let candidate = findSourceCandidate(source);
  if (!candidate.url) candidate = await findDocumentCandidate(source._id);
  if (!candidate.url) candidate = await recoverCandidateFromDoi(source, moderatorId);
  if (!candidate.url && (source.doi || source.pmcid)) {
    candidate = {
      field: source.pmcid
        ? 'PMCID-derived structured candidates'
        : 'DOI-derived structured candidates',
      url: `identifier:${source.pmcid || source.doi}`,
    };
  }
  if (!candidate.url) return candidate;

  await rememberRecoveredCandidate(source, candidate);
  return candidate;
}

function findSourceCandidate(source: ReaderReimportSource): ImportCandidate {
  const metadata = objectValue(source.metadata);
  return firstUsableCandidate([
    ['xmlUrl', source.xmlUrl],
    ['htmlUrl', source.htmlUrl],
    ['fullTextUrl', source.fullTextUrl],
    ['sourceUrl', source.sourceUrl],
    ['url', source.url],
    ['metadata.url', metadata.url],
    ['metadata.sourceUrl', metadata.sourceUrl],
    ['metadata.htmlUrl', metadata.htmlUrl],
    ['metadata.landingPageUrl', metadata.landingPageUrl],
    ['metadata.importSourceUrl', metadata.importSourceUrl],
    ['metadata.importedFrom', metadata.importedFrom],
    ['metadata.originalUrl', metadata.originalUrl],
  ]);
}

async function findDocumentCandidate(
  sourceId: Types.ObjectId,
): Promise<ImportCandidate> {
  const document = await AcademicDocument.findOne({ sourceId });
  if (!document) return EMPTY_CANDIDATE;

  const stored = objectValue(document.toObject());
  const metadata = objectValue(stored.metadata);
  return firstUsableCandidate([
    ['AcademicDocument.sourceUrl', stored.sourceUrl],
    ['AcademicDocument.url', stored.url],
    ['AcademicDocument.metadata.sourceUrl', metadata.sourceUrl],
  ]);
}

async function recoverCandidateFromDoi(
  source: ReaderReimportSource,
  moderatorId: Types.ObjectId,
): Promise<ImportCandidate> {
  const doi = source.doi || objectValue(source.metadata).doi;
  if (typeof doi !== 'string' || !doi) return EMPTY_CANDIDATE;

  try {
    const resolved = await resolveSourceImport({ doi }, moderatorId);
    const candidate = resolved.htmlUrl
      ? { url: resolved.htmlUrl, field: 'resolved htmlUrl via DOI' }
      : resolved.sourceUrl
        ? { url: resolved.sourceUrl, field: 'resolved sourceUrl via DOI' }
        : EMPTY_CANDIDATE;
    if (!candidate.url) return candidate;

    if (resolved.htmlUrl) source.htmlUrl = resolved.htmlUrl;
    if (resolved.sourceUrl) source.sourceUrl = resolved.sourceUrl;
    if (resolved.openAccessStatus) source.openAccessStatus = resolved.openAccessStatus;
    if (resolved.allowedUse) source.allowedUse = resolved.allowedUse;
    if (resolved.license) source.license = resolved.license;
    await source.save();
    return candidate;
  } catch (error) {
    console.warn(`Preflight DOI resolution failed for ${doi}:`, error);
    return EMPTY_CANDIDATE;
  }
}

async function rememberRecoveredCandidate(
  source: ReaderReimportSource,
  candidate: ImportCandidate,
): Promise<void> {
  const missingStoredUrl = !source.htmlUrl
    && !source.fullTextUrl
    && !source.sourceUrl
    && !source.xmlUrl;
  if (!candidate.url.startsWith('http') || !missingStoredUrl) return;

  if (candidate.field.includes('xml')) {
    source.xmlUrl = candidate.url;
  } else if (candidate.field.includes('html')) {
    source.htmlUrl = candidate.url;
  } else {
    source.sourceUrl = candidate.url;
  }
  await source.save();
}

function firstUsableCandidate(
  candidates: Array<[string, unknown]>,
): ImportCandidate {
  const match = candidates.find(([, value]) => isStructuredUrl(value));
  return match
    ? { field: match[0], url: String(match[1]).trim() }
    : EMPTY_CANDIDATE;
}

function isStructuredUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim().startsWith('http')) return false;
  return !value.trim().toLowerCase().split(/[?#]/, 1)[0].endsWith('.pdf');
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
