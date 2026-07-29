import mongoose from 'mongoose';

/**
 * Utility function to defensively sanitize academic metadata fields to prevent CastErrors and format discrepancies.
 */
export function sanitizeAcademicSourceData(data: any): any {
  if (!data) return {};
  const clean: any = {};

  // Helpers to sanitize basic strings
  const cleanString = (val: any): string | undefined => {
    if (val === null || val === undefined) return undefined;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      return trimmed === '' ? undefined : trimmed;
    }
    // If it's an empty array or object, or anything else, return undefined
    if (Array.isArray(val) && val.length === 0) return undefined;
    if (typeof val === 'object' && Object.keys(val).length === 0) return undefined;
    
    // Otherwise stringify it safely
    const strVal = String(val).trim();
    return strVal === '' ? undefined : strVal;
  };

  // 1. Sanitize standard string fields
  clean.title = cleanString(data.title);
  clean.journal = cleanString(data.journal);
  clean.publisher = cleanString(data.publisher);
  clean.doi = cleanString(data.doi);
  if (clean.doi) {
    // If DOI exists, normalize trimming and lowercase
    clean.doi = clean.doi.trim().toLowerCase();
  }
  clean.isbn = cleanString(data.isbn);
  clean.url = cleanString(data.url || data.sourceUrl);
  clean.pdfUrl = cleanString(data.pdfUrl);
  clean.xmlUrl = cleanString(data.xmlUrl);
  clean.htmlUrl = cleanString(data.htmlUrl);
  clean.landingPageUrl = cleanString(data.landingPageUrl);

  // 2. Sanitize authors
  // If authors is string, convert to one-item array.
  // If authors is array, keep only valid non-empty string values.
  const rawAuthors = data.authors;
  if (rawAuthors !== null && rawAuthors !== undefined) {
    if (Array.isArray(rawAuthors)) {
      const cleanAuthors = rawAuthors
        .map(a => typeof a === 'string' ? a.trim() : String(a).trim())
        .filter(a => a !== '' && a !== 'null' && a !== 'undefined');
      clean.authors = cleanAuthors.length > 0 ? cleanAuthors : undefined;
    } else if (typeof rawAuthors === 'string') {
      const trimmed = rawAuthors.trim();
      clean.authors = trimmed !== '' ? [trimmed] : undefined;
    } else {
      const strVal = String(rawAuthors).trim();
      clean.authors = strVal !== '' ? [strVal] : undefined;
    }
  } else {
    clean.authors = undefined;
  }

  // 3. Sanitize year (number)
  // If year is string, parse number safely.
  const rawYear = data.year;
  if (rawYear !== null && rawYear !== undefined) {
    if (typeof rawYear === 'number') {
      clean.year = Number.isInteger(rawYear) ? rawYear : Math.floor(rawYear);
    } else {
      const parsed = parseInt(String(rawYear), 10);
      clean.year = isNaN(parsed) ? undefined : parsed;
    }
  } else {
    clean.year = undefined;
  }

  // 4. Sanitize and map Open Access Status
  // Supported OA values: hybrid, gold, green, bronze, open, closed, restricted, unknown
  const supportedOA = ['hybrid', 'gold', 'green', 'bronze', 'open', 'closed', 'restricted', 'unknown'];
  const rawOA = (data.openAccessStatus || data.oaStatus || '').toString().trim().toLowerCase();
  clean.openAccessStatus = supportedOA.includes(rawOA) ? rawOA : 'unknown';

  // Backwards compatibility for oaStatus
  clean.oaStatus = clean.openAccessStatus;

  // 5. Sanitize license & allowedUse
  clean.license = cleanString(data.license) || 'all-rights-reserved';
  
  const rawAllowedUse = cleanString(data.allowedUse);
  const supportedAllowedUse = ['metadata_only', 'abstract_only', 'open_access_fulltext'];
  clean.allowedUse = supportedAllowedUse.includes(rawAllowedUse || '') ? rawAllowedUse : 'metadata_only';

  return clean;
}
