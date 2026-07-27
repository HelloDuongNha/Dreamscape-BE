import { SourceImportResolverResult } from '../../dto/sourceImport.dto';
import { isValidHttpUrl } from '../../../../infrastructure/security/ssrfGuard';
import { fetchUnpaywallMetadata, normalizeDoi } from './openAccess.service';
import { sanitizeAcademicSourceData } from './sourceSanitizer';
import {
  fetchCrossrefMetadata,
  fetchEuropePmcMetadata,
  fetchIsbnMetadata,
} from './sourceMetadataProviders.service';

export async function resolvePmcidSource(
  pmcid: string,
  warnings: string[],
): Promise<SourceImportResolverResult> {
  const metadata = await fetchEuropePmcMetadata(pmcid);
  if (!metadata) {
    throw new Error(`Không thể tìm thấy tài liệu PMC ID ${pmcid} từ EuropePMC.`);
  }

  const sanitized = sanitizeAcademicSourceData({
    title: metadata.title,
    authors: metadata.authors,
    journal: metadata.journal,
    publisher: metadata.publisher,
    year: metadata.year,
    doi: metadata.doi || undefined,
    url: `https://europepmc.org/articles/${pmcid}`,
    pdfUrl: `https://europepmc.org/articles/${pmcid}?pdf=render`,
    htmlUrl: `https://europepmc.org/articles/${pmcid}`,
    xmlUrl: `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`,
    openAccessStatus: 'gold',
    allowedUse: 'open_access_fulltext',
    license: 'open-access',
  });

  return {
    sourceType: 'pmcid',
    title: sanitized.title,
    authors: sanitized.authors || [],
    year: sanitized.year,
    journal: sanitized.journal,
    publisher: sanitized.publisher,
    doi: sanitized.doi,
    pmcid,
    normalizedPmcid: pmcid,
    sourceUrl: sanitized.url,
    pdfUrl: sanitized.pdfUrl,
    htmlUrl: sanitized.htmlUrl,
    xmlUrl: `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`,
    openAccessStatus: sanitized.openAccessStatus,
    license: sanitized.license,
    allowedUse: sanitized.allowedUse,
    fullTextAvailable: true,
    metadataProvider: 'europe_pmc',
    warnings,
  };
}

export async function resolveDoiSource(
  doi: string,
  warnings: string[],
): Promise<SourceImportResolverResult> {
  const normalized = normalizeDoi(doi);
  let crossrefResult: any;
  let unpaywallResult: any;
  try {
    crossrefResult = await fetchCrossrefMetadata(normalized);
  } catch (error: any) {
    console.warn('[Crossref] Error fetching metadata:', error.message || error);
    crossrefResult = { success: false, errorType: 'network_error' };
  }
  if (!crossrefResult.success) {
    warnings.push(`Không thể lấy metadata từ Crossref (${crossrefResult.errorType || 'unknown_error'}).`);
  }

  try {
    unpaywallResult = await fetchUnpaywallMetadata(normalized);
  } catch (error: any) {
    console.warn('[Unpaywall] Error fetching metadata:', error.message || error);
    unpaywallResult = { success: false };
  }
  if (!unpaywallResult.success) {
    warnings.push('Không thể truy xuất thông tin Open Access từ Unpaywall.');
  }

  const metadata = crossrefResult.metadata || {};
  const openAccess = unpaywallResult.data || {};
  let allowedUse: 'metadata_only' | 'abstract_only' | 'open_access_fulltext' = 'metadata_only';
  let fullTextAvailable = false;
  let pdfUrl = openAccess.pdfUrl || '';
  let htmlUrl = openAccess.htmlUrl || '';
  let fullTextUrl = '';

  if (openAccess.is_oa) {
    if (htmlUrl && isValidHttpUrl(htmlUrl)) {
      fullTextUrl = htmlUrl;
    } else if (pdfUrl && isValidHttpUrl(pdfUrl)) {
      fullTextUrl = pdfUrl;
    } else if (
      openAccess.landingPageUrl
      && isValidHttpUrl(openAccess.landingPageUrl)
    ) {
      fullTextUrl = openAccess.landingPageUrl;
    }
    if (fullTextUrl) {
      allowedUse = 'open_access_fulltext';
      fullTextAvailable = true;
    }
  }

  const isFrontiers = normalized.startsWith('10.3389/')
    || metadata.publisher?.toLowerCase().includes('frontiers');
  if (isFrontiers) {
    htmlUrl = `https://www.frontiersin.org/articles/${normalized}/full`;
    pdfUrl = `https://www.frontiersin.org/articles/${normalized}/pdf`;
    allowedUse = 'open_access_fulltext';
    fullTextAvailable = true;
  }
  if (!fullTextAvailable) {
    warnings.push('Tài liệu đóng (Closed Access) hoặc không tìm thấy đường dẫn bản đọc công khai.');
  }

  const sanitized = sanitizeAcademicSourceData({
    title: metadata.title || `DOI ${normalized}`,
    authors: metadata.authors,
    journal: metadata.journal,
    publisher: metadata.publisher,
    year: metadata.year,
    doi: normalized,
    url: metadata.url || `https://doi.org/${normalized}`,
    pdfUrl,
    htmlUrl,
    openAccessStatus: openAccess.oa_status || 'unknown',
    allowedUse,
    license: openAccess.license || 'all-rights-reserved',
  });
  return {
    sourceType: 'doi',
    title: sanitized.title,
    authors: sanitized.authors || [],
    year: sanitized.year,
    journal: sanitized.journal,
    publisher: sanitized.publisher,
    doi: sanitized.doi,
    sourceUrl: sanitized.url,
    pdfUrl: sanitized.pdfUrl,
    htmlUrl: sanitized.htmlUrl,
    openAccessStatus: sanitized.openAccessStatus,
    license: sanitized.license,
    allowedUse: sanitized.allowedUse,
    fullTextAvailable,
    metadataProvider: crossrefResult.success ? 'crossref' : 'fallback_doi',
    warnings,
  };
}

export async function resolveIsbnSource(
  isbn: string,
  warnings: string[],
): Promise<SourceImportResolverResult> {
  const cleanIsbn = isbn.replace(/[^0-9Xx]/g, '');
  const metadata = await fetchIsbnMetadata(cleanIsbn);
  if (!metadata) {
    return {
      sourceType: 'isbn',
      title: `ISBN ${cleanIsbn}`,
      authors: [],
      isbn: cleanIsbn,
      openAccessStatus: 'closed',
      allowedUse: 'metadata_only',
      fullTextAvailable: false,
      metadataProvider: 'none',
      warnings: [
        'Không tìm thấy thông tin sách cho ISBN này.',
        'ISBN chỉ cung cấp thông tin mô tả, không nhập toàn văn sách bản quyền.',
      ],
    };
  }

  const sanitized = sanitizeAcademicSourceData({
    title: metadata.title,
    authors: metadata.authors,
    publisher: metadata.publisher,
    year: metadata.year,
    isbn: cleanIsbn,
    openAccessStatus: 'closed',
    allowedUse: 'metadata_only',
  });
  warnings.push('ISBN cung cấp thông tin sách bản quyền. Toàn văn sách không được tự động nhập.');
  return {
    sourceType: 'isbn',
    title: sanitized.title,
    authors: sanitized.authors || [],
    year: sanitized.year,
    publisher: sanitized.publisher,
    isbn: sanitized.isbn,
    openAccessStatus: sanitized.openAccessStatus,
    allowedUse: sanitized.allowedUse,
    fullTextAvailable: false,
    metadataProvider: metadata.metadataProvider,
    warnings,
  };
}
