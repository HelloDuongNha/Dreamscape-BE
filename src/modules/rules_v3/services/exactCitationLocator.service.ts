import crypto from 'crypto';
import AcademicChunk from '../../models/AcademicChunk';

export interface ExactCitationLocationSuccess {
  success: true;
  chunkId: string;
  chunkContentHash: string;
  startOffset: number;
  endOffset: number;
  exactQuote: string;
  quoteHash: string;
  exactness: 'canonical_exact'; // Documented: source_exact or extraction_derived must be assigned by a future provenance-aware caller, not this locator.
  verificationStatus: 'verified';
}

export interface ExactCitationLocationFailure {
  success: false;
  rejectionReason:
    | 'missing'
    | 'ambiguous'
    | 'too_short'
    | 'too_long'
    | 'whitespace_only'
    | 'invalid_chunk'
    | 'validation_failed';
  errorDetails?: string;
}

export type ExactCitationLocationResult = ExactCitationLocationSuccess | ExactCitationLocationFailure;

function escapeRegex(text: string): string {
  return text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Pure deterministic function to search, verify, and slice the proposed quote in a text string.
 * This function performs no database connections.
 * 
 * Note on exactness: Slicing only returns 'canonical_exact' (for both direct exact matches
 * and whitespace-normalized matches). Provenance-aware exactness tags ('source_exact' or 
 * 'extraction_derived') must be assigned by a future provenance-aware caller, not this locator.
 */
export function locateCitationInText(
  chunkId: string,
  chunkText: string,
  proposedQuote: string
): ExactCitationLocationResult {
  const trimmedQuote = (proposedQuote || '').trim();
  if (!trimmedQuote) {
    return { success: false, rejectionReason: 'whitespace_only', errorDetails: 'Proposed quote is empty or whitespace-only.' };
  }
  if (trimmedQuote.length < 10) {
    return { success: false, rejectionReason: 'too_short', errorDetails: 'Proposed quote is too short (min 10 chars).' };
  }
  if (trimmedQuote.length > 1000) {
    return { success: false, rejectionReason: 'too_long', errorDetails: 'Proposed quote is too long (max 1000 chars).' };
  }

  if (!chunkText) {
    return { success: false, rejectionReason: 'missing', errorDetails: 'Target chunk text is empty.' };
  }

  // 1. Direct exact match (case-sensitive)
  const firstIndex = chunkText.indexOf(trimmedQuote);
  if (firstIndex >= 0) {
    const secondIndex = chunkText.indexOf(trimmedQuote, firstIndex + 1);
    if (secondIndex >= 0) {
      return {
        success: false,
        rejectionReason: 'ambiguous',
        errorDetails: 'Proposed quote matches multiple locations in the chunk text.'
      };
    }

    const startOffset = firstIndex;
    const endOffset = firstIndex + trimmedQuote.length;
    const exactQuote = chunkText.slice(startOffset, endOffset);
    const chunkContentHash = sha256(chunkText);
    const quoteHash = sha256(`${chunkContentHash}:${startOffset}:${endOffset}:${exactQuote}`);

    return {
      success: true,
      chunkId,
      chunkContentHash,
      startOffset,
      endOffset,
      exactQuote,
      quoteHash,
      exactness: 'canonical_exact',
      verificationStatus: 'verified'
    };
  }

  // 2. Whitespace-normalized matching (case-sensitive, regex flag 'g' only)
  const escapedTokens = trimmedQuote.split(/\s+/).map(escapeRegex);
  const regexStr = escapedTokens.join('\\s+');
  let regex: RegExp;
  try {
    regex = new RegExp(regexStr, 'g');
  } catch (err: any) {
    return { success: false, rejectionReason: 'validation_failed', errorDetails: `Failed to construct search regex: ${err.message}` };
  }

  const matches = [...chunkText.matchAll(regex)];

  if (matches.length === 0) {
    return { success: false, rejectionReason: 'missing', errorDetails: 'Proposed quote not found in chunk text.' };
  }

  if (matches.length > 1) {
    return {
      success: false,
      rejectionReason: 'ambiguous',
      errorDetails: 'Proposed quote matches multiple locations under whitespace-normalization.'
    };
  }

  const match = matches[0];
  const startOffset = match.index!;
  const endOffset = match.index! + match[0].length;
  const exactQuote = chunkText.slice(startOffset, endOffset);

  if (exactQuote !== match[0]) {
    return { success: false, rejectionReason: 'validation_failed', errorDetails: 'Internal offset slicing mismatch.' };
  }

  const chunkContentHash = sha256(chunkText);
  const quoteHash = sha256(`${chunkContentHash}:${startOffset}:${endOffset}:${exactQuote}`);

  return {
    success: true,
    chunkId,
    chunkContentHash,
    startOffset,
    endOffset,
    exactQuote,
    quoteHash,
    exactness: 'canonical_exact',
    verificationStatus: 'verified'
  };
}

/**
 * Thin production wrapper that loads AcademicChunk.text and delegates to locateCitationInText.
 */
export async function locateExactCitation(
  chunkId: string,
  proposedQuote: string
): Promise<ExactCitationLocationResult> {
  const chunk = await AcademicChunk.findById(chunkId).select('_id text').lean();
  if (!chunk || !chunk.text) {
    return { success: false, rejectionReason: 'invalid_chunk', errorDetails: 'Academic chunk not found or contains no text.' };
  }
  return locateCitationInText(String(chunk._id), chunk.text, proposedQuote);
}
