import mongoose from 'mongoose';
import SourceContribution from '../../../../../models/SourceContribution';
import AcademicSource from '../../../../../models/AcademicSource';
import { detectPdfMetadata, PdfMetadataDetectionResult } from './pdfMetadataDetector.service';
import { resolveSourceImport } from '../../../../source/sourceImportResolver.service';
import { normalizeDoi } from '../../../../source/openAccess.service';
import { ExtractedDocument } from '../../../types/extractedDocument.types';

export interface MetadataEnrichmentResult {
  success: boolean;
  message: string;
  identifiers: {
    doi?: string;
    isbn?: string;
    pmcid?: string;
  };
  preferredSource: 'jats' | 'html' | 'pdf_text';
  metadataEnriched: boolean;
  conflictDetected: boolean;
  warnings: string[];
}

export interface EnrichPdfMetadataInput {
  targetType: 'contribution' | 'approved_source';
  targetId: string;
  userId?: mongoose.Types.ObjectId;
  extractedDocument: ExtractedDocument;
}

/**
 * Normalizes PMCIDs.
 */
function normalizePmcid(pmcid: string): string {
  const clean = pmcid.toUpperCase().trim();
  if (/^\d+$/.test(clean)) {
    return `PMC${clean}`;
  }
  return clean;
}

/**
 * Normalizes ISBNs by stripping non-alphanumeric chars.
 */
function normalizeIsbn(isbn: string): string {
  return isbn.replace(/[^0-9Xx]/g, '').trim();
}

/**
 * Checks if a title is equivalent to the original filename basename (case-insensitive).
 */
function isFilenameFallback(title: string, originalFileName?: string): boolean {
  if (!title || !originalFileName) return false;
  const normalize = (s: string) => {
    return s
      .toLowerCase()
      .replace(/\.pdf$/i, '')
      .replace(/[\s\-_.]+/g, ' ')
      .trim();
  };
  return normalize(title) === normalize(originalFileName);
}

/**
 * Checks if a title is a generic placeholder.
 */
function isGenericPlaceholderTitle(title: string): boolean {
  if (!title) return true;
  const clean = title.trim().toLowerCase();
  return clean === '' || clean === 'tài liệu pdf' || clean === 'tài liệu học thuật' || clean === 'untitled';
}

/**
 * Strips identifier of labels, prefixes, and non-alphanumeric characters for conservative comparison.
 */
function stripIdentifier(val: string): string {
  if (!val) return '';
  return val
    .toLowerCase()
    .replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '')
    .replace(/^(doi|pmcid|isbn)[:\s]*/i, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Rejects a title if it is equivalent to any canonical/detected/resolved identifiers.
 */
function isIdentifierPlaceholderTitle(title: string, strippedIdentifiers: string[]): boolean {
  if (!title) return true;
  const normTitle = stripIdentifier(title);
  if (!normTitle) return true;
  return strippedIdentifiers.includes(normTitle);
}

/**
 * Checks if a resolver title is meaningful (non-generic, non-placeholder).
 */
function isMeaningfulResolverTitle(
  title: string | undefined,
  strippedIdentifiers: string[]
): boolean {
  if (!title) return false;
  if (isGenericPlaceholderTitle(title)) return false;
  if (isIdentifierPlaceholderTitle(title, strippedIdentifiers)) return false;
  return true;
}

/**
 * Checks if an embedded PDF title is meaningful.
 */
function isMeaningfulPdfTitle(
  title: string | undefined,
  strippedIdentifiers: string[]
): boolean {
  if (!title) return false;
  if (isGenericPlaceholderTitle(title)) return false;
  if (isIdentifierPlaceholderTitle(title, strippedIdentifiers)) return false;
  return true;
}

/**
 * Returns true if core metadata is missing or title is filename-derived.
 */
function checkMetadataIncomplete(target: any): boolean {
  const originalFileName = target.originalFile?.originalFileName;
  const isTitleFallback = isFilenameFallback(target.title, originalFileName);
  return (
    !target.title ||
    isTitleFallback ||
    !target.authors ||
    target.authors.length === 0 ||
    !target.year
  );
}

/**
 * Runs isolated text-layer extraction, scans for identifiers, resolves metadata,
 * merges fields under strict priority rules, and updates target documents.
 */
export async function enrichPdfMetadata(
  input: EnrichPdfMetadataInput
): Promise<MetadataEnrichmentResult> {
  const { targetType, targetId, userId } = input;
  const warnings: string[] = [];
  let metadataEnriched = false;
  let conflictDetected = false;

  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    throw new Error('ID tài liệu không hợp lệ.');
  }

  // 1. Load target
  let target: any = null;
  if (targetType === 'contribution') {
    target = await SourceContribution.findById(targetId);
  } else {
    target = await AcademicSource.findById(targetId);
  }

  if (!target) {
    throw new Error(`Không tìm thấy tài liệu với ID: ${targetId}`);
  }

  // Set contribution state to resolving_identifiers
  if (targetType === 'contribution') {
    target.extractionStatus = 'resolving_identifiers';
    await target.save();
  }

  // 3. Scan extracted blocks for identifiers
  const existingMetaCompare = {
    title: target.title,
    language: target.detectedLanguage
  };
  const detection = detectPdfMetadata(input.extractedDocument, existingMetaCompare);

  const detectedDoi = detection.identifiers.doi;
  const detectedPmcid = detection.identifiers.pmcid;
  const detectedIsbn = detection.identifiers.isbn;

  // 4. Check for identifier conflicts and filter them
  let resolvedDoi = target.doi || target.normalizedDoi;
  let resolvedPmcid = target.pmcid || target.normalizedPmcid;
  let resolvedIsbn = target.isbn || (target.metadata && target.metadata.isbn);

  const isMetadataIncomplete = checkMetadataIncomplete(target);
  let runResolver = false;
  const resolverInput: any = {};

  // DOI Resolution & Conflict Check
  if (resolvedDoi) {
    const normResolvedDoi = normalizeDoi(resolvedDoi);
    if (detectedDoi) {
      const normDetectedDoi = normalizeDoi(detectedDoi);
      if (normDetectedDoi !== normResolvedDoi) {
        conflictDetected = true;
        warnings.push(`DOI phát hiện được (${normDetectedDoi}) xung đột với DOI hiện có (${normResolvedDoi}).`);
      } else {
        if (isMetadataIncomplete) {
          resolverInput.doi = normResolvedDoi;
          runResolver = true;
        }
      }
    } else {
      if (isMetadataIncomplete) {
        resolverInput.doi = normResolvedDoi;
        runResolver = true;
      }
    }
  } else if (detectedDoi) {
    resolverInput.doi = normalizeDoi(detectedDoi);
    runResolver = true;
  }

  // PMCID Resolution & Conflict Check
  if (resolvedPmcid) {
    const normResolvedPmcid = normalizePmcid(resolvedPmcid);
    if (detectedPmcid) {
      const normDetectedPmcid = normalizePmcid(detectedPmcid);
      if (normDetectedPmcid !== normResolvedPmcid) {
        conflictDetected = true;
        warnings.push(`PMCID phát hiện được (${normDetectedPmcid}) xung đột với PMCID hiện có (${normResolvedPmcid}).`);
      } else {
        if (isMetadataIncomplete) {
          resolverInput.pmcid = normResolvedPmcid;
          runResolver = true;
        }
      }
    } else {
      if (isMetadataIncomplete) {
        resolverInput.pmcid = normResolvedPmcid;
        runResolver = true;
      }
    }
  } else if (detectedPmcid) {
    resolverInput.pmcid = normalizePmcid(detectedPmcid);
    runResolver = true;
  }

  // ISBN Resolution & Conflict Check
  if (resolvedIsbn) {
    const normResolvedIsbn = normalizeIsbn(resolvedIsbn);
    if (detectedIsbn) {
      const normDetectedIsbn = normalizeIsbn(detectedIsbn);
      if (normDetectedIsbn !== normResolvedIsbn) {
        conflictDetected = true;
        warnings.push(`ISBN phát hiện được (${normDetectedIsbn}) xung đột với ISBN hiện có (${normResolvedIsbn}).`);
      } else {
        if (isMetadataIncomplete) {
          resolverInput.isbn = normResolvedIsbn;
          runResolver = true;
        }
      }
    } else {
      if (isMetadataIncomplete) {
        resolverInput.isbn = normResolvedIsbn;
        runResolver = true;
      }
    }
  } else if (detectedIsbn) {
    resolverInput.isbn = normalizeIsbn(detectedIsbn);
    runResolver = true;
  }

  // 5. Query resolver safely
  let resolvedMeta: any = null;
  if (runResolver && !conflictDetected) {
    if (targetType === 'contribution') {
      target.extractionStatus = 'fetching_preferred_source';
      await target.save();
    }

    try {
      resolvedMeta = await resolveSourceImport(resolverInput, userId);
      if (resolvedMeta) {
        metadataEnriched = true;
      }
    } catch (resolveErr: any) {
      warnings.push(`Lỗi kết nối bộ phân giải định danh: ${resolveErr.message}`);
    }
  }

  // 6. Merge metadata under strict priority rules
  // Rule: Canonical > resolver > embedded metadata > text hints
  const originalFileName = target.originalFile?.originalFileName;
  const rawIdentifiers = [
    resolvedDoi, detectedDoi, resolvedMeta?.doi,
    resolvedPmcid, detectedPmcid, resolvedMeta?.pmcid,
    resolvedIsbn, detectedIsbn, resolvedMeta?.isbn
  ];

  const cleanedIdentifiers = Array.from(
    new Set(
      rawIdentifiers
        .filter((val): val is string => typeof val === 'string' && val.trim() !== '')
        .map(val => stripIdentifier(val))
        .filter(val => val !== '')
    )
  );

  let title = target.title;
  if (!title || isFilenameFallback(title, originalFileName)) {
    if (isMeaningfulResolverTitle(resolvedMeta?.title, cleanedIdentifiers)) {
      title = resolvedMeta.title;
    } else if (isMeaningfulPdfTitle(detection.metadataHints.title, cleanedIdentifiers)) {
      title = detection.metadataHints.title;
    }
  }

  const authors = (target.authors && target.authors.length > 0) ? target.authors : (resolvedMeta?.authors || detection.metadataHints.authors);
  const year = target.year || resolvedMeta?.year || detection.metadataHints.year;
  const journal = target.journal || resolvedMeta?.journal || detection.metadataHints.publisher;
  const publisher = target.publisher || resolvedMeta?.publisher || detection.metadataHints.publisher;
  const language = target.detectedLanguage || resolvedMeta?.language || detection.metadataHints.language;

  // External URLs (must not be Cloudinary URLs)
  const isCloudinary = (url: string) => (url || '').includes('cloudinary.com');
  const url = target.url || (!isCloudinary(resolvedMeta?.sourceUrl) ? resolvedMeta?.sourceUrl : undefined);
  const pdfUrl = target.pdfUrl || (!isCloudinary(resolvedMeta?.pdfUrl) ? resolvedMeta?.pdfUrl : undefined);
  const htmlUrl = target.htmlUrl || (!isCloudinary(resolvedMeta?.htmlUrl) ? resolvedMeta?.htmlUrl : undefined);

  // Update target fields
  if (targetType === 'contribution') {
    target.detectedIdentifiers = {
      doi: detectedDoi || undefined,
      isbn: detectedIsbn || undefined,
      pmcid: detectedPmcid || undefined
    };

    if (language && !target.detectedLanguage) {
      target.detectedLanguage = language;
    }

    // Assign canonical fields only when validated
    if (resolverInput.doi && !conflictDetected && resolvedMeta?.doi) {
      target.doi = resolvedMeta.doi;
      target.normalizedDoi = normalizeDoi(resolvedMeta.doi);
    }
    if (resolverInput.pmcid && !conflictDetected && resolvedMeta?.pmcid) {
      const normalized = normalizePmcid(resolvedMeta.pmcid);
      const duplicate = await SourceContribution.exists({
        _id: { $ne: target._id },
        normalizedPmcid: normalized
      });
      if (duplicate) {
        conflictDetected = true;
        warnings.push(`PMCID ${normalized} đã thuộc về một đóng góp nguồn khác; giữ nguyên định danh hiện tại.`);
      } else {
        target.pmcid = resolvedMeta.pmcid;
        target.normalizedPmcid = normalized;
      }
    }
    
    target.title = title || target.title;
    target.authors = authors || target.authors;
    target.year = year || target.year;
    target.journal = journal || target.journal;
    target.publisher = publisher || target.publisher;
    target.url = url || target.url;
    target.pdfUrl = pdfUrl || target.pdfUrl;
    target.htmlUrl = htmlUrl || target.htmlUrl;

    if (resolvedMeta?.license && !target.license) {
      target.license = resolvedMeta.license;
    }
    if (resolvedMeta?.allowedUse && target.allowedUse === 'metadata_only') {
      target.allowedUse = resolvedMeta.allowedUse;
    }
    if (resolvedMeta?.copyrightStatus && target.copyrightStatus === 'paywalled') {
      target.copyrightStatus = resolvedMeta.copyrightStatus;
    }

    target.extractionStatus = 'completed';
    await target.save();
  } else {
    // Approved AcademicSource: do not add detectedIdentifiers field
    if (resolverInput.doi && !conflictDetected && resolvedMeta?.doi) {
      target.doi = resolvedMeta.doi;
      target.normalizedDoi = normalizeDoi(resolvedMeta.doi);
    }
    if (resolverInput.pmcid && !conflictDetected && resolvedMeta?.pmcid) {
      const normalized = normalizePmcid(resolvedMeta.pmcid);
      const duplicate = await AcademicSource.exists({
        _id: { $ne: target._id },
        normalizedPmcid: normalized
      });
      if (duplicate) {
        conflictDetected = true;
        warnings.push(`PMCID ${normalized} đã thuộc về một nguồn học thuật khác; giữ nguyên định danh hiện tại.`);
      } else {
        target.pmcid = resolvedMeta.pmcid;
        target.normalizedPmcid = normalized;
      }
    }

    // Only update canonical fields if weaker/empty
    if (!target.title || isFilenameFallback(target.title, originalFileName)) target.title = title;
    if (!target.authors || target.authors.length === 0) target.authors = authors;
    if (!target.year) target.year = year;
    if (!target.journal) target.journal = journal;
    if (!target.publisher) target.publisher = publisher;
    if (!target.url) target.url = url;
    if (!target.pdfUrl) target.pdfUrl = pdfUrl;
    if (!target.htmlUrl) target.htmlUrl = htmlUrl;

    await target.save();
  }

  // 7. Preferred source discovery signal
  let preferredSource: 'jats' | 'html' | 'pdf_text' = 'pdf_text';
  if (resolvedMeta?.xmlUrl) {
    preferredSource = 'jats';
  } else if (resolvedMeta?.htmlUrl || resolvedMeta?.openAccessStatus === 'gold') {
    preferredSource = 'html';
  }

  return {
    success: true,
    message: conflictDetected ? 'Đã tìm thấy thông tin nhưng có xung đột định danh.' : 'Trích xuất và đồng bộ thông tin định danh PDF thành công.',
    identifiers: {
      doi: target.doi || target.normalizedDoi || undefined,
      isbn: target.isbn || undefined,
      pmcid: target.pmcid || target.normalizedPmcid || undefined
    },
    preferredSource,
    metadataEnriched,
    conflictDetected,
    warnings
  };
}
