import mongoose from 'mongoose';
import {
  EnrichPdfMetadataInput,
  MetadataEnrichmentResult,
  ResolvedPdfMetadata,
} from '../../../../dto/pdfMetadataEnrichment.dto';
import { SourceImportResolverInput } from '../../../../dto/sourceImport.dto';
import { resolveSourceImport } from '../../../source/sourceImportResolver.service';
import { detectPdfMetadata } from './pdfMetadataDetector.service';
import { reconcilePdfIdentifiers } from './pdfMetadataIdentifier.service';
import {
  loadPdfMetadataTarget,
  PdfMetadataTargetDocument,
  persistPdfMetadata,
  setPdfMetadataTargetStatus,
} from './pdfMetadataPersistence.service';
import {
  metadataNeedsEnrichment,
  selectPdfMetadata,
  selectPreferredPdfMetadataSource,
} from './pdfMetadataSelection.service';

export type {
  EnrichPdfMetadataInput,
  MetadataEnrichmentResult,
} from '../../../../dto/pdfMetadataEnrichment.dto';

// Enrich one uploaded PDF without changing the canonical metadata priority.
export async function enrichPdfMetadata(
  input: EnrichPdfMetadataInput,
): Promise<MetadataEnrichmentResult> {
  requireValidTargetId(input.targetId);

  const target = await loadPdfMetadataTarget(input.targetType, input.targetId);
  await setPdfMetadataTargetStatus(input.targetType, target, 'resolving_identifiers');

  const detection = detectPdfMetadata(input.extractedDocument, {
    title: target.title,
    language: target.detectedLanguage,
  });
  const reconciliation = reconcilePdfIdentifiers({
    existing: {
      doi: target.doi || target.normalizedDoi,
      pmcid: target.pmcid || target.normalizedPmcid,
      isbn: target.isbn || target.metadata?.isbn,
    },
    detected: detection.identifiers,
    metadataIncomplete: metadataNeedsEnrichment(target),
  });

  const resolution = await resolveDetectedMetadata({
    request: input,
    target,
    resolverInput: reconciliation.resolverInput,
    conflictDetected: reconciliation.conflictDetected,
  });
  const selected = selectPdfMetadata({
    target,
    detection,
    resolved: resolution.metadata,
    identifiers: [
      reconciliation.existing.doi,
      detection.identifiers.doi,
      resolution.metadata?.doi,
      reconciliation.existing.pmcid,
      detection.identifiers.pmcid,
      resolution.metadata?.pmcid,
      reconciliation.existing.isbn,
      detection.identifiers.isbn,
      resolution.metadata?.isbn,
    ],
  });
  const persisted = await persistPdfMetadata({
    targetType: input.targetType,
    target,
    detection,
    resolverInput: reconciliation.resolverInput,
    resolved: resolution.metadata,
    selected,
    conflictDetected: reconciliation.conflictDetected,
    warnings: [...reconciliation.warnings, ...resolution.warnings],
  });

  return buildEnrichmentResult({
    target: persisted.target,
    resolved: resolution.metadata,
    metadataEnriched: Boolean(resolution.metadata),
    conflictDetected: persisted.conflictDetected,
    warnings: persisted.warnings,
  });
}

async function resolveDetectedMetadata(input: {
  request: EnrichPdfMetadataInput;
  target: PdfMetadataTargetDocument;
  resolverInput: SourceImportResolverInput;
  conflictDetected: boolean;
}): Promise<{ metadata?: ResolvedPdfMetadata; warnings: string[] }> {
  if (input.conflictDetected || !hasResolverIdentifier(input.resolverInput)) {
    return { warnings: [] };
  }

  await setPdfMetadataTargetStatus(
    input.request.targetType,
    input.target,
    'fetching_preferred_source',
  );
  try {
    const metadata = await resolveSourceImport(input.resolverInput, input.request.userId);
    return { metadata, warnings: [] };
  } catch (error: unknown) {
    return {
      warnings: [`Lỗi kết nối bộ phân giải định danh: ${errorMessage(error)}`],
    };
  }
}

function buildEnrichmentResult(input: {
  target: Awaited<ReturnType<typeof loadPdfMetadataTarget>>;
  resolved?: ResolvedPdfMetadata;
  metadataEnriched: boolean;
  conflictDetected: boolean;
  warnings: string[];
}): MetadataEnrichmentResult {
  return {
    success: true,
    message: input.conflictDetected
      ? 'Đã tìm thấy thông tin nhưng có xung đột định danh.'
      : 'Trích xuất và đồng bộ thông tin định danh PDF thành công.',
    identifiers: {
      doi: input.target.doi || input.target.normalizedDoi || undefined,
      isbn: input.target.isbn || undefined,
      pmcid: input.target.pmcid || input.target.normalizedPmcid || undefined,
    },
    preferredSource: selectPreferredPdfMetadataSource(input.resolved),
    metadataEnriched: input.metadataEnriched,
    conflictDetected: input.conflictDetected,
    warnings: input.warnings,
  };
}

function requireValidTargetId(targetId: string): void {
  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    throw new Error('ID tài liệu không hợp lệ.');
  }
}

function hasResolverIdentifier(input: SourceImportResolverInput): boolean {
  return Boolean(input.doi || input.pmcid || input.isbn);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
