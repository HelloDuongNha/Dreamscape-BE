import { Document, Types } from 'mongoose';
import AcademicSource from '../../../../models/AcademicSource';
import SourceContribution from '../../../../models/SourceContribution';
import {
  PdfMetadataTargetType,
  ResolvedPdfMetadata,
} from '../../../../dto/pdfMetadataEnrichment.dto';
import { SourceImportResolverInput } from '../../../../dto/sourceImport.dto';
import { normalizeDoi } from '../../../source/openAccess.service';
import { PdfMetadataDetectionResult } from './pdfMetadataDetector.service';
import { normalizePmcid } from './pdfMetadataIdentifier.service';
import {
  PdfMetadataTargetView,
  SelectedPdfMetadata,
} from './pdfMetadataSelection.service';

export interface PdfMetadataTargetDocument extends Document<Types.ObjectId>, PdfMetadataTargetView {
  doi?: string;
  normalizedDoi?: string;
  pmcid?: string;
  normalizedPmcid?: string;
  isbn?: string;
  metadata?: {
    isbn?: string;
    [key: string]: unknown;
  };
  detectedIdentifiers?: PdfMetadataDetectionResult['identifiers'];
  extractionStatus?: string;
  detectedLanguage?: string;
  license?: string;
  allowedUse?: string;
  copyrightStatus?: string;
}

interface PersistPdfMetadataInput {
  targetType: PdfMetadataTargetType;
  target: PdfMetadataTargetDocument;
  detection: PdfMetadataDetectionResult;
  resolverInput: SourceImportResolverInput;
  resolved?: ResolvedPdfMetadata;
  selected: SelectedPdfMetadata;
  conflictDetected: boolean;
  warnings: string[];
}

interface PersistPdfMetadataResult {
  target: PdfMetadataTargetDocument;
  conflictDetected: boolean;
  warnings: string[];
}

// Load the requested metadata target through its owning model.
export async function loadPdfMetadataTarget(
  targetType: PdfMetadataTargetType,
  targetId: string,
): Promise<PdfMetadataTargetDocument> {
  const document = targetType === 'contribution'
    ? await SourceContribution.findById(targetId)
    : await AcademicSource.findById(targetId);

  if (!document) {
    throw new Error(`Không tìm thấy tài liệu với ID: ${targetId}`);
  }
  return document as unknown as PdfMetadataTargetDocument;
}

export async function setPdfMetadataTargetStatus(
  targetType: PdfMetadataTargetType,
  target: PdfMetadataTargetDocument,
  status: 'resolving_identifiers' | 'fetching_preferred_source',
): Promise<void> {
  if (targetType !== 'contribution') return;
  target.extractionStatus = status;
  await target.save();
}

// Persist resolved metadata while preserving the stronger fields already stored.
export async function persistPdfMetadata(
  input: PersistPdfMetadataInput,
): Promise<PersistPdfMetadataResult> {
  let { conflictDetected } = input;
  const warnings = [...input.warnings];

  if (input.targetType === 'contribution') {
    input.target.detectedIdentifiers = {
      doi: input.detection.identifiers.doi || undefined,
      isbn: input.detection.identifiers.isbn || undefined,
      pmcid: input.detection.identifiers.pmcid || undefined,
    };
    if (input.selected.language && !input.target.detectedLanguage) {
      input.target.detectedLanguage = input.selected.language;
    }
  }

  applyResolvedDoi(input.target, input.resolverInput, input.resolved, conflictDetected);
  const pmcidResult = await applyResolvedPmcid({
    targetType: input.targetType,
    target: input.target,
    resolverInput: input.resolverInput,
    resolved: input.resolved,
    conflictDetected,
  });
  conflictDetected = pmcidResult.conflictDetected;
  warnings.push(...pmcidResult.warnings);

  if (input.targetType === 'contribution') {
    applyContributionMetadata(input.target, input.selected, input.resolved);
    input.target.extractionStatus = 'completed';
  } else {
    applyApprovedSourceMetadata(input.target, input.selected);
  }

  await input.target.save();
  return { target: input.target, conflictDetected, warnings };
}

function applyResolvedDoi(
  target: PdfMetadataTargetDocument,
  resolverInput: SourceImportResolverInput,
  resolved: ResolvedPdfMetadata | undefined,
  conflictDetected: boolean,
): void {
  if (!resolverInput.doi || conflictDetected || !resolved?.doi) return;
  target.doi = resolved.doi;
  target.normalizedDoi = normalizeDoi(resolved.doi);
}

async function applyResolvedPmcid(input: {
  targetType: PdfMetadataTargetType;
  target: PdfMetadataTargetDocument;
  resolverInput: SourceImportResolverInput;
  resolved?: ResolvedPdfMetadata;
  conflictDetected: boolean;
}): Promise<{ conflictDetected: boolean; warnings: string[] }> {
  if (!input.resolverInput.pmcid || input.conflictDetected || !input.resolved?.pmcid) {
    return { conflictDetected: input.conflictDetected, warnings: [] };
  }

  const normalized = normalizePmcid(input.resolved.pmcid);
  const duplicate = input.targetType === 'contribution'
    ? await SourceContribution.exists({
      _id: { $ne: input.target._id },
      normalizedPmcid: normalized,
    })
    : await AcademicSource.exists({
      _id: { $ne: input.target._id },
      normalizedPmcid: normalized,
    });
  if (duplicate) {
    const ownerLabel = input.targetType === 'contribution'
      ? 'một đóng góp nguồn khác'
      : 'một nguồn học thuật khác';
    return {
      conflictDetected: true,
      warnings: [`PMCID ${normalized} đã thuộc về ${ownerLabel}; giữ nguyên định danh hiện tại.`],
    };
  }

  input.target.pmcid = input.resolved.pmcid;
  input.target.normalizedPmcid = normalized;
  return { conflictDetected: false, warnings: [] };
}

function applyContributionMetadata(
  target: PdfMetadataTargetDocument,
  selected: SelectedPdfMetadata,
  resolved?: ResolvedPdfMetadata,
): void {
  target.title = selected.title || target.title;
  target.authors = selected.authors || target.authors;
  target.year = selected.year || target.year;
  target.journal = selected.journal || target.journal;
  target.publisher = selected.publisher || target.publisher;
  target.url = selected.url || target.url;
  target.pdfUrl = selected.pdfUrl || target.pdfUrl;
  target.htmlUrl = selected.htmlUrl || target.htmlUrl;

  if (resolved?.license && !target.license) target.license = resolved.license;
  if (resolved?.allowedUse && target.allowedUse === 'metadata_only') {
    target.allowedUse = resolved.allowedUse;
  }
  if (resolved?.copyrightStatus && target.copyrightStatus === 'paywalled') {
    target.copyrightStatus = resolved.copyrightStatus;
  }
}

function applyApprovedSourceMetadata(
  target: PdfMetadataTargetDocument,
  selected: SelectedPdfMetadata,
): void {
  if (!target.title || isFilenameFallback(target.title, target.originalFile?.originalFileName)) {
    target.title = selected.title;
  }
  if (!target.authors?.length) target.authors = selected.authors;
  if (!target.year) target.year = selected.year;
  if (!target.journal) target.journal = selected.journal;
  if (!target.publisher) target.publisher = selected.publisher;
  if (!target.url) target.url = selected.url;
  if (!target.pdfUrl) target.pdfUrl = selected.pdfUrl;
  if (!target.htmlUrl) target.htmlUrl = selected.htmlUrl;
}

function isFilenameFallback(title: string, originalFileName?: string): boolean {
  if (!originalFileName) return false;
  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[\s\-_.]+/g, ' ')
    .trim();
  return normalize(title) === normalize(originalFileName);
}
