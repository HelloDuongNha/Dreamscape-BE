/**
 * Phase I18N-3B.2A — Block Classifier & Target/BlockType Compatibility Matrix
 *
 * Pure functions: no I/O, no side effects, no database queries.
 * Applies classifier precedence in deterministic priority order.
 */
import crypto from 'node:crypto';
import {
  TranslationTargetRequest,
  ChunkForTranslation,
  AppLocale,
  NonTranslatedTarget,
} from './readerTranslation.types';

// ─── BlockType eligibility sets ──────────────────────────────────────────────

/** BlockTypes eligible for block_text targetType */
const BLOCK_TEXT_ELIGIBLE: ReadonlySet<string> = new Set([
  'title',
  'heading',
  'paragraph',
  'list_item',
]);

/** BlockTypes eligible for figure_caption targetType */
const FIGURE_CAPTION_ELIGIBLE: ReadonlySet<string> = new Set(['figure']);

/** BlockTypes eligible for table_cell targetType */
const TABLE_CELL_ELIGIBLE: ReadonlySet<string> = new Set(['table']);

/** BlockTypes that are always excluded_reference */
const REFERENCE_BLOCK_TYPES: ReadonlySet<string> = new Set(['reference']);

/** BlockTypes that are always excluded_structured_content */
const STRUCTURED_EXCLUDED_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'page_break',
  'metadata',
]);

// ─── Compatibility Validation ─────────────────────────────────────────────────

export interface CompatibilityError {
  code: 'reader_translation_target_invalid';
  reason: string;
}

/**
 * Validates that a target's targetType is compatible with the chunk's blockType.
 * Returns null if compatible, or a CompatibilityError if not.
 *
 * IMPORTANT: reference, metadata, page_break blocks are addressable via block_text.
 * The classifier (not the validator) returns their deterministic excluded status.
 * The validator only rejects structurally wrong combinations where no result is
 * ever possible (e.g. figure_caption on paragraph, table_cell on paragraph).
 */
export function validateTargetBlockTypeCompatibility(
  target: TranslationTargetRequest,
  chunk: ChunkForTranslation
): CompatibilityError | null {
  const bt = chunk.blockType ?? '';

  switch (target.targetType) {
    case 'block_text': {
      // Allowed for translatable prose AND deterministic-excluded blocks
      const BLOCK_TEXT_ALLOWED: ReadonlySet<string> = new Set([
        'title', 'heading', 'paragraph', 'list_item',
        // Excluded but addressable (classifier returns excluded status)
        'reference', 'metadata', 'page_break',
      ]);
      if (!BLOCK_TEXT_ALLOWED.has(bt)) {
        return {
          code: 'reader_translation_target_invalid',
          reason: `block_text targetType is not valid for blockType '${bt || '(unknown)'}'. Use figure_caption for figure, table_cell for table.`,
        };
      }
      return null;
    }

    case 'figure_caption': {
      if (!FIGURE_CAPTION_ELIGIBLE.has(bt)) {
        return {
          code: 'reader_translation_target_invalid',
          reason: `figure_caption targetType is not valid for blockType '${bt || '(unknown)'}'. Allowed: figure.`,
        };
      }
      return null;
    }

    case 'table_cell': {
      if (!TABLE_CELL_ELIGIBLE.has(bt)) {
        return {
          code: 'reader_translation_target_invalid',
          reason: `table_cell targetType is not valid for blockType '${bt || '(unknown)'}'. Allowed: table.`,
        };
      }
      return null;
    }

    default: {
      return {
        code: 'reader_translation_target_invalid',
        reason: `Unknown targetType.`,
      };
    }
  }
}

// ─── Numeric/Statistical/Formula/Citation Cell Heuristic ─────────────────────

/**
 * Returns true only when the entire cell text is purely numeric, statistical,
 * a formula, or a citation marker — so it must stay original without provider call.
 *
 * Mixed cells like "Mean blood glucose (mg/dL)" return false → eligible.
 * Avoids broad substring matches on SD, SE, CI that appear in ordinary words.
 */
export function isPurelyNonTranslatableCell(text: string): boolean {
  const t = text.trim();
  if (!t) return true; // empty cell — excluded_structured_content

  // Pure numeric: digits, decimal points, commas, minus, plus, × · ± % e E spaces parens
  if (/^[\d.,\-+×·±%eE()\s]+$/.test(t)) return true;

  // Pure citation marker: [1], [2], [2–4], [1,3], (Author, 2022), (Smith et al., 2019)
  if (/^\[[\d,\s\–\-–—]+\]$/.test(t)) return true;
  if (/^\([A-Z][a-zA-Z\s]+,?\s*\d{4}[a-z]?\)$/.test(t)) return true;

  // Pure DOI string
  if (/^https?:\/\/(?:dx\.)?doi\.org\/10\.\d{4,9}\/\S+$/i.test(t)) return true;
  if (/^doi\s*:\s*10\.\d{4,9}\/\S+$/i.test(t)) return true;

  // Pure statistical expression WITHOUT any surrounding prose words
  // p < 0.001, p = .04, p=0.05, r = 0.82, r=.5, β = -0.3, χ² = 12.4
  if (/^(?:p|r|β|χ²?|F|t|z)\s*[=<>≤≥]\s*[\d.]+\s*$/.test(t)) return true;

  // Pure "95% CI [x, y]" or "95%CI" with no surrounding words
  if (/^95\s*%\s*CI[\s\[\]0-9.,\-–—]*$/.test(t)) return true;

  // LaTeX-like expression: \word or \word{...}
  if (/^\\[a-zA-Z]+(\{[^}]*\})*$/.test(t)) return true;

  return false;
}

// ─── Content Hash Verification ────────────────────────────────────────────────

/** Computes SHA-256 of the given text in UTF-8 and returns 64-char hex */
export function computeContentHash(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ─── Priority-Ordered Classification ─────────────────────────────────────────

export type ClassifierDecision =
  | { eligible: true }
  | {
      eligible: false;
      nonTranslated: NonTranslatedTarget;
    };

/**
 * Applies classifier precedence rules to determine if a target is eligible
 * for provider translation or must return a deterministic non-translated status.
 *
 * Priority order as per plan:
 * 1. reference → excluded_reference
 * 2. page_break / metadata → excluded_structured_content
 * 3. table without tableData → excluded_structured_content
 * 4. table_cell with pure non-translatable cell text → excluded_structured_content
 * 5. figure with empty text → excluded_structured_content
 * 6. same_language → same_language
 * 7. sourceLanguage === null → source_language_unknown
 * 8+ → eligible
 *
 * Note: chunkPurpose and documentId checks are performed in the validator
 * (they reject the whole request, not per-target).
 * targetType/blockType compatibility is also checked in the validator.
 */
export function classifyTarget(
  target: TranslationTargetRequest,
  chunk: ChunkForTranslation,
  sourceLanguage: string | null,
  targetLocale: AppLocale
): ClassifierDecision {
  const bt = chunk.blockType ?? '';

  // Helpers to build identity tail for non-translated results
  function identityOf() {
    if (target.targetType === 'table_cell') {
      return {
        targetType: 'table_cell' as const,
        chunkId: chunk._id.toString(),
        row: target.row,
        column: target.column,
        contentHash: target.contentHash,
      };
    }
    return {
      targetType: target.targetType as 'block_text' | 'figure_caption',
      chunkId: chunk._id.toString(),
      contentHash: target.contentHash,
    };
  }

  function excluded(
    status: NonTranslatedTarget['status']
  ): ClassifierDecision {
    return {
      eligible: false,
      nonTranslated: { ...identityOf(), status },
    };
  }

  // Priority 1: reference
  if (REFERENCE_BLOCK_TYPES.has(bt)) {
    return excluded('excluded_reference');
  }

  // Priority 2: page_break / metadata
  if (STRUCTURED_EXCLUDED_BLOCK_TYPES.has(bt)) {
    return excluded('excluded_structured_content');
  }

  // Priority 3: table without tableData
  if (bt === 'table' && !chunk.tableData) {
    return excluded('excluded_structured_content');
  }

  // Priority 4: table_cell with pure non-translatable cell text
  if (target.targetType === 'table_cell' && chunk.tableData) {
    const cell = chunk.tableData.cells.find(
      (c) => c.row === target.row && c.column === target.column
    );
    const cellText = cell?.text ?? '';
    if (isPurelyNonTranslatableCell(cellText)) {
      return excluded('excluded_structured_content');
    }
  }

  // Priority 5: figure with empty text
  if (bt === 'figure' && !chunk.text.trim()) {
    return excluded('excluded_structured_content');
  }

  // Priority 6: same language
  if (sourceLanguage !== null && sourceLanguage === targetLocale) {
    return excluded('same_language');
  }

  // Priority 7: unknown source language
  if (sourceLanguage === null) {
    return excluded('source_language_unknown');
  }

  return { eligible: true };
}
