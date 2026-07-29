import { SourceImportResolverInput } from '../../../../dto/sourceImport.dto';
import { normalizeDoi } from '../../../source/openAccess.service';
import { PdfMetadataDetectionResult } from './pdfMetadataDetector.service';

type IdentifierKey = 'doi' | 'pmcid' | 'isbn';

interface ExistingIdentifiers {
  doi?: string;
  pmcid?: string;
  isbn?: string;
}

interface IdentifierReconciliationInput {
  existing: ExistingIdentifiers;
  detected: PdfMetadataDetectionResult['identifiers'];
  metadataIncomplete: boolean;
}

export interface IdentifierReconciliationResult {
  existing: ExistingIdentifiers;
  resolverInput: SourceImportResolverInput;
  conflictDetected: boolean;
  warnings: string[];
}

const IDENTIFIER_LABELS: Record<IdentifierKey, string> = {
  doi: 'DOI',
  pmcid: 'PMCID',
  isbn: 'ISBN',
};

const IDENTIFIER_NORMALIZERS: Record<IdentifierKey, (value: string) => string> = {
  doi: normalizeDoi,
  pmcid: normalizePmcid,
  isbn: normalizeIsbn,
};

// Reconcile stored and detected identifiers before any external lookup is attempted.
export function reconcilePdfIdentifiers(
  input: IdentifierReconciliationInput,
): IdentifierReconciliationResult {
  const resolverInput: SourceImportResolverInput = {};
  const warnings: string[] = [];
  let conflictDetected = false;

  for (const key of Object.keys(IDENTIFIER_LABELS) as IdentifierKey[]) {
    const existing = normalizeOptionalIdentifier(key, input.existing[key]);
    const detected = normalizeOptionalIdentifier(key, input.detected[key]);

    if (existing && detected && existing !== detected) {
      conflictDetected = true;
      warnings.push(
        `${IDENTIFIER_LABELS[key]} phát hiện được (${detected}) xung đột với ${IDENTIFIER_LABELS[key]} hiện có (${existing}).`,
      );
      continue;
    }

    const valueForResolver = existing || detected;
    if (valueForResolver && (!existing || input.metadataIncomplete)) {
      resolverInput[key] = valueForResolver;
    }
  }

  return {
    existing: {
      doi: normalizeOptionalIdentifier('doi', input.existing.doi),
      pmcid: normalizeOptionalIdentifier('pmcid', input.existing.pmcid),
      isbn: normalizeOptionalIdentifier('isbn', input.existing.isbn),
    },
    resolverInput,
    conflictDetected,
    warnings,
  };
}

export function normalizePmcid(pmcid: string): string {
  const clean = pmcid.toUpperCase().trim();
  return /^\d+$/.test(clean) ? `PMC${clean}` : clean;
}

export function normalizeIsbn(isbn: string): string {
  return isbn.replace(/[^0-9Xx]/g, '').trim();
}

function normalizeOptionalIdentifier(
  key: IdentifierKey,
  value: string | undefined,
): string | undefined {
  if (!value?.trim()) return undefined;
  return IDENTIFIER_NORMALIZERS[key](value);
}
