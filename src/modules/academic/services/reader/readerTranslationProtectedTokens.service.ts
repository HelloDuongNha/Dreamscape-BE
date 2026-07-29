/**
 * Phase I18N-3B.2A — Protected Token Extraction and Validation
 *
 * Extracts deterministic protected tokens from source text and verifies that
 * each token is preserved byte-identically in the translated output.
 *
 * Avoids broad substring checks (e.g., bare "SD"/"SE"/"CI") that would match
 * ordinary words.
 */

// ─── Known safe explicit unit strings (all lowercase) ────────────────────────
// These units are protected even when not preceded by a number (e.g. in column headers).
// Only short, unambiguous medical/scientific units are listed here to avoid
// false positives on slash-separated prose or URLs.

const SAFE_STANDALONE_UNITS = new Set([
  'mg/dl', 'mg/l', 'g/dl', 'g/l', 'g/kg',
  'mmol/l', 'umol/l', 'nmol/l', 'pmol/l',
  'μmol/l', 'μg/l', 'μg/dl', 'μg/ml',
  'iu/l', 'u/l', 'mu/l',
  'km/h', 'ml/min', 'ml/kg', 'l/min',
  'mg/kg', 'μg/kg', 'ng/ml', 'pg/ml',
  'mmhg', 'bpm',
]);

// ─── Token Extraction ─────────────────────────────────────────────────────────

/**
 * Extracts protected tokens from a canonical text string.
 * Returns an array of unique token strings that must appear unchanged in translation.
 *
 * Protected tokens:
 * - Decimal and integer numbers (standalone)
 * - Percentages
 * - DOI strings
 * - Bracket citation markers [1], [2–4], [1,3]
 * - Parenthetical author-year citations
 * - Statistical expressions: p < 0.001, p = .04, r = 0.82, etc.
 * - 95% CI patterns
 * - LaTeX-like tokens
 * - Numeric+unit patterns (e.g. 42.5 mg/dL)
 * - Standalone safe explicit units (e.g. mg/dL in column headers)
 */
export function extractProtectedTokens(text: string): string[] {
  const tokens = new Set<string>();

  // DOI strings (full URL or doi: prefix)
  const doiRe = /(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*:\s*)10\.\d{4,9}\/\S+/gi;
  for (const m of text.matchAll(doiRe)) tokens.add(m[0]);

  // Bracket citation markers: [1], [2–4], [1, 3], [1-3,5]
  const citeBracketRe = /\[[\d,\s\–\-–—]+\]/g;
  for (const m of text.matchAll(citeBracketRe)) tokens.add(m[0]);

  // Parenthetical author-year: (Smith et al., 2019a)
  const citeParenRe = /\([A-Z][a-zA-Z\s]+ et al\.,?\s*\d{4}[a-z]?\)/g;
  for (const m of text.matchAll(citeParenRe)) tokens.add(m[0]);
  // Simple: (Smith, 2022)
  const citeSimpleRe = /\([A-Z][a-zA-Z]+,\s*\d{4}[a-z]?\)/g;
  for (const m of text.matchAll(citeSimpleRe)) tokens.add(m[0]);

  // Statistical expressions with comparison operators
  // Anchored to avoid matching mid-word: p, r, β, χ², F, t, z
  const statRe = /\b(?:p|r|β|χ²?|F|t|z)\s*[=<>≤≥]\s*[\d.]+/g;
  for (const m of text.matchAll(statRe)) tokens.add(m[0]);

  // 95% CI with optional range
  const ciRe = /95\s*%\s*CI\s*(?:\[[\d.,\s\-–—]+\])?/g;
  for (const m of text.matchAll(ciRe)) tokens.add(m[0]);

  // LaTeX-like tokens
  const latexRe = /\\[a-zA-Z]+(?:\{[^}]*\})*/g;
  for (const m of text.matchAll(latexRe)) tokens.add(m[0]);

  // Numeric + unit patterns (number immediately or with whitespace before unit)
  // Matches: "42.5 mg/dL", "3.14 km/h", "50 μmol/L", "100mg/dL"
  const numUnitRe = /\d+(?:\.\d+)?\s*[a-zA-Zμ]+\/[a-zA-Zμ]+/g;
  for (const m of text.matchAll(numUnitRe)) tokens.add(m[0]);

  // Standalone safe explicit units (even without preceding number)
  // e.g. "Mean blood glucose (mg/dL)"
  // Uses word boundary on left side to avoid partial matches
  // Detects known unit forms in their parenthetical / standalone context
  const standaloneUnitRe = /\b([a-zA-Zμ]+\/[a-zA-Zμ]+)\b/g;
  for (const m of text.matchAll(standaloneUnitRe)) {
    const unitLower = m[1].toLowerCase();
    if (SAFE_STANDALONE_UNITS.has(unitLower)) {
      tokens.add(m[1]); // add original-case form as it appears in text
    }
  }

  // Standalone percentages: 42.5%, 95%
  const pctRe = /\d+(?:\.\d+)?\s*%/g;
  for (const m of text.matchAll(pctRe)) tokens.add(m[0]);

  // Standalone numbers (integers and decimals)
  const numRe = /\b\d+(?:[.,]\d+)*\b/g;
  for (const m of text.matchAll(numRe)) tokens.add(m[0]);

  return [...tokens];
}

// ─── Token Validation ─────────────────────────────────────────────────────────

export interface TokenValidationResult {
  valid: true;
}

export interface TokenValidationFailure {
  valid: false;
  missingToken: string;
}

/**
 * Verifies that every protected token extracted from sourceText appears
 * unchanged (by exact substring match) in translatedText.
 *
 * Returns { valid: true } if all tokens are present.
 * Returns { valid: false, missingToken } for the first missing/altered token.
 *
 * Never repairs or invents tokens. Caller must mark the result as provider_failed
 * with translation_schema_invalid if validation fails.
 */
export function validateProtectedTokensPreserved(
  sourceText: string,
  translatedText: string
): TokenValidationResult | TokenValidationFailure {
  const tokens = extractProtectedTokens(sourceText);

  for (const token of tokens) {
    if (!translatedText.includes(token)) {
      return { valid: false, missingToken: token };
    }
  }

  return { valid: true };
}
