import { ExtractedDocument } from './types/extractedDocument.types';

export interface PdfMetadataDetectionResult {
  identifiers: {
    doi?: string;
    isbn?: string;
    pmcid?: string;
  };
  candidates: {
    doi: string[];
    isbn: string[];
    pmcid: string[];
  };
  metadataHints: {
    title?: string;
    authors?: string[];
    year?: number;
    publisher?: string;
    language?: string;
  };
  confidence: {
    identifiers: 'high' | 'medium' | 'low';
    metadata: 'high' | 'medium' | 'low';
  };
  scannedPages: number[];
}

/**
 * Validates ISBN-10 checksum.
 */
function isValidIsbn10(isbn: string): boolean {
  if (isbn.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const digit = parseInt(isbn[i], 10);
    if (isNaN(digit)) return false;
    sum += digit * (10 - i);
  }
  const lastChar = isbn[9].toUpperCase();
  if (lastChar === 'X') {
    sum += 10;
  } else {
    const digit = parseInt(lastChar, 10);
    if (isNaN(digit)) return false;
    sum += digit;
  }
  return sum % 11 === 0;
}

/**
 * Validates ISBN-13 checksum.
 */
function isValidIsbn13(isbn: string): boolean {
  if (isbn.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const digit = parseInt(isbn[i], 10);
    if (isNaN(digit)) return false;
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}

/**
 * Strips trailing punctuation from matched identifiers.
 */
function cleanTrailingPunctuation(str: string): string {
  return str.replace(/[.,;:})\]]+$/, '');
}

/**
 * Scans the extracted pages of a document to discover and validate DOI, ISBN, and PMCID identifiers.
 */
export function detectPdfMetadata(
  extractedDocument: ExtractedDocument,
  existingMetadata?: any
): PdfMetadataDetectionResult {
  const scannedPages: number[] = [];
  const rawDois: string[] = [];
  const rawIsbns: string[] = [];
  const rawPmcids: string[] = [];

  const pageCount = extractedDocument.pageCount;
  
  // Collect target physical page numbers (1-based)
  const targetPages = new Set<number>();
  
  // First 8-12 pages (we'll do min of 10 pages and pageCount)
  const firstBound = Math.min(10, pageCount);
  for (let i = 1; i <= firstBound; i++) {
    targetPages.add(i);
  }
  
  // Last 3-5 pages (we'll do last 4 pages)
  const lastStart = Math.max(1, pageCount - 3);
  for (let i = lastStart; i <= pageCount; i++) {
    targetPages.add(i);
  }

  const sortedPages = Array.from(targetPages).sort((a, b) => a - b);

  // Regex patterns
  const doiRegex = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi;
  const pmcidRegex = /\bPMC\d+/gi;
  const isbnRegex = /\b(?:ISBN(?:[-_ ]*(?:10|13))?:?\s*)?((?:[0-9Xx][-_ ]*){10,13})\b/gi;

  for (const pageNum of sortedPages) {
    const page = extractedDocument.pages[pageNum - 1];
    if (!page || page.characterCount === 0) continue;

    scannedPages.push(pageNum);
    const text = page.blocks.map(b => b.text).join('\n');

    // 1. Scan DOIs
    let doiMatch;
    doiRegex.lastIndex = 0;
    while ((doiMatch = doiRegex.exec(text)) !== null) {
      const cleaned = cleanTrailingPunctuation(doiMatch[0]).toLowerCase();
      if (cleaned.startsWith('10.')) {
        rawDois.push(cleaned);
      }
    }

    // 2. Scan PMCIDs
    let pmcidMatch;
    pmcidRegex.lastIndex = 0;
    while ((pmcidMatch = pmcidRegex.exec(text)) !== null) {
      const cleaned = pmcidMatch[0].toUpperCase();
      rawPmcids.push(cleaned);
    }

    // 3. Scan ISBNs
    let isbnMatch;
    isbnRegex.lastIndex = 0;
    while ((isbnMatch = isbnRegex.exec(text)) !== null) {
      const rawDigits = isbnMatch[1].replace(/[^0-9Xx]/g, '');
      if (rawDigits.length === 10 && isValidIsbn10(rawDigits)) {
        rawIsbns.push(rawDigits.toUpperCase());
      } else if (rawDigits.length === 13 && isValidIsbn13(rawDigits)) {
        rawIsbns.push(rawDigits);
      }
    }
  }

  // Deduplicate results
  const validDois = Array.from(new Set(rawDois));
  const validPmcids = Array.from(new Set(rawPmcids));
  const validIsbns = Array.from(new Set(rawIsbns));

  // Determine final validated identifier candidates
  const identifiers: PdfMetadataDetectionResult['identifiers'] = {};
  if (validPmcids.length > 0) {
    identifiers.pmcid = validPmcids[0];
  }
  if (validDois.length > 0) {
    identifiers.doi = validDois[0];
  }
  if (validIsbns.length > 0) {
    identifiers.isbn = validIsbns[0];
  }

  // Populate metadata hints
  const metadataHints: PdfMetadataDetectionResult['metadataHints'] = {
    title: extractedDocument.title || existingMetadata?.title || undefined,
    language: extractedDocument.language || existingMetadata?.language || undefined
  };

  // Determine Confidence levels
  let identifiersConfidence: 'high' | 'medium' | 'low' = 'low';
  if (validDois.length > 0 || validPmcids.length > 0) {
    identifiersConfidence = 'high';
  } else if (validIsbns.length > 0) {
    identifiersConfidence = 'medium';
  }

  let metadataConfidence: 'high' | 'medium' | 'low' = 'low';
  if (metadataHints.title) {
    metadataConfidence = identifiersConfidence === 'high' ? 'high' : 'medium';
  }

  return {
    identifiers,
    candidates: {
      doi: validDois,
      isbn: validIsbns,
      pmcid: validPmcids
    },
    metadataHints,
    confidence: {
      identifiers: identifiersConfidence,
      metadata: metadataConfidence
    },
    scannedPages
  };
}
