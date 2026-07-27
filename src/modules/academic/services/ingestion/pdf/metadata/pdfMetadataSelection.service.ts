import {
  PreferredPdfMetadataSource,
  ResolvedPdfMetadata,
} from '../../../../dto/pdfMetadataEnrichment.dto';
import { PdfMetadataDetectionResult } from './pdfMetadataDetector.service';

export interface PdfMetadataTargetView {
  title?: string;
  authors?: string[];
  year?: number;
  journal?: string;
  publisher?: string;
  detectedLanguage?: string;
  url?: string;
  pdfUrl?: string;
  htmlUrl?: string;
  originalFile?: {
    originalFileName?: string;
  };
}

export interface SelectedPdfMetadata {
  title?: string;
  authors?: string[];
  year?: number;
  journal?: string;
  publisher?: string;
  language?: string;
  url?: string;
  pdfUrl?: string;
  htmlUrl?: string;
}

interface SelectPdfMetadataInput {
  target: PdfMetadataTargetView;
  detection: PdfMetadataDetectionResult;
  resolved?: ResolvedPdfMetadata;
  identifiers: Array<string | undefined>;
}

// Select metadata by preserving canonical fields before resolver and embedded PDF hints.
export function selectPdfMetadata(input: SelectPdfMetadataInput): SelectedPdfMetadata {
  const { target, detection, resolved } = input;
  const identifiers = cleanIdentifiers(input.identifiers);
  let title = target.title;

  if (!title || isFilenameFallback(title, target.originalFile?.originalFileName)) {
    if (isMeaningfulTitle(resolved?.title, identifiers)) {
      title = resolved?.title;
    } else if (isMeaningfulTitle(detection.metadataHints.title, identifiers)) {
      title = detection.metadataHints.title;
    }
  }

  return {
    title,
    authors: target.authors?.length
      ? target.authors
      : resolved?.authors || detection.metadataHints.authors,
    year: target.year || resolved?.year || detection.metadataHints.year,
    journal: target.journal || resolved?.journal || detection.metadataHints.publisher,
    publisher: target.publisher || resolved?.publisher || detection.metadataHints.publisher,
    language: target.detectedLanguage || resolved?.language || detection.metadataHints.language,
    url: selectExternalUrl(target.url, resolved?.sourceUrl),
    pdfUrl: selectExternalUrl(target.pdfUrl, resolved?.pdfUrl),
    htmlUrl: selectExternalUrl(target.htmlUrl, resolved?.htmlUrl),
  };
}

export function metadataNeedsEnrichment(target: PdfMetadataTargetView): boolean {
  return (
    !target.title
    || isFilenameFallback(target.title, target.originalFile?.originalFileName)
    || !target.authors?.length
    || !target.year
  );
}

export function selectPreferredPdfMetadataSource(
  resolved?: ResolvedPdfMetadata,
): PreferredPdfMetadataSource {
  if (resolved?.xmlUrl) return 'jats';
  if (resolved?.htmlUrl || resolved?.openAccessStatus === 'gold') return 'html';
  return 'pdf_text';
}

function selectExternalUrl(current?: string, resolved?: string): string | undefined {
  if (current) return current;
  return resolved && !resolved.includes('cloudinary.com') ? resolved : undefined;
}

function cleanIdentifiers(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map(stripIdentifier).filter(Boolean)));
}

function isMeaningfulTitle(title: string | undefined, identifiers: string[]): boolean {
  if (!title || isGenericPlaceholderTitle(title)) return false;
  const normalizedTitle = stripIdentifier(title);
  return Boolean(normalizedTitle) && !identifiers.includes(normalizedTitle);
}

function isFilenameFallback(title: string, originalFileName?: string): boolean {
  if (!title || !originalFileName) return false;
  return normalizeFileLabel(title) === normalizeFileLabel(originalFileName);
}

function normalizeFileLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[\s\-_.]+/g, ' ')
    .trim();
}

function isGenericPlaceholderTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return (
    !normalized
    || normalized === 'tài liệu pdf'
    || normalized === 'tài liệu học thuật'
    || normalized === 'untitled'
  );
}

function stripIdentifier(value: string | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '')
    .replace(/^(doi|pmcid|isbn)[:\s]*/i, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}
