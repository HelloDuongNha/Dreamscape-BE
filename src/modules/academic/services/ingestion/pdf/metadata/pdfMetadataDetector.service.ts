import { ExtractedDocument } from '../../../types/extractedDocument.types';

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

interface ExistingPdfMetadata {
  title?: string;
  language?: string;
}

// Validate the ISBN-10 checksum before accepting a detected candidate.
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

// Validate the ISBN-13 checksum before accepting a detected candidate.
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

function cleanTrailingPunctuation(str: string): string {
  return str.replace(/[.,;:})\]]+$/, '');
}

// Scan representative PDF pages for validated DOI, PMCID and ISBN candidates.
export function detectPdfMetadata(
  extractedDocument: ExtractedDocument,
  existingMetadata?: ExistingPdfMetadata,
): PdfMetadataDetectionResult {
  const scannedPages: number[] = [];
  const rawDois: string[] = [];
  const rawIsbns: string[] = [];
  const rawPmcids: string[] = [];

  const pageCount = extractedDocument.pageCount;
  
  const targetPages = new Set<number>();
  const firstBound = Math.min(10, pageCount);
  for (let i = 1; i <= firstBound; i++) {
    targetPages.add(i);
  }
  
  const lastStart = Math.max(1, pageCount - 3);
  for (let i = lastStart; i <= pageCount; i++) {
    targetPages.add(i);
  }

  const sortedPages = Array.from(targetPages).sort((a, b) => a - b);

  const doiRegex = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi;
  const pmcidRegex = /\bPMC\d+/gi;
  const isbnRegex = /\b(?:ISBN(?:[-_ ]*(?:10|13))?:?\s*)?((?:[0-9Xx][-_ ]*){10,13})\b/gi;

  for (const pageNum of sortedPages) {
    const page = extractedDocument.pages[pageNum - 1];
    if (!page || page.characterCount === 0) continue;

    scannedPages.push(pageNum);
    const text = page.blocks.map(b => b.text).join('\n');

    let doiMatch;
    doiRegex.lastIndex = 0;
    while ((doiMatch = doiRegex.exec(text)) !== null) {
      const cleaned = cleanTrailingPunctuation(doiMatch[0]).toLowerCase();
      if (cleaned.startsWith('10.')) {
        rawDois.push(cleaned);
      }
    }

    let pmcidMatch;
    pmcidRegex.lastIndex = 0;
    while ((pmcidMatch = pmcidRegex.exec(text)) !== null) {
      const cleaned = pmcidMatch[0].toUpperCase();
      rawPmcids.push(cleaned);
    }

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

  const validDois = Array.from(new Set(rawDois));
  const validPmcids = Array.from(new Set(rawPmcids));
  const validIsbns = Array.from(new Set(rawIsbns));

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

  const metadataHints: PdfMetadataDetectionResult['metadataHints'] = {
    title: extractedDocument.title || existingMetadata?.title || undefined,
    language: extractedDocument.language || existingMetadata?.language || undefined
  };

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
