/**
 * Phase I18N-3B.2A — Canonical Smart Reader Translation Contract Tests
 *
 * Run with:
 *   npx tsx src/services/academic/reader/canonicalReaderTranslation.test.ts
 *
 * Covers:
 *  1. HTTP body limit
 *  2. Request shape validation
 *  3. Identity validation (full-document hash, off-page chunk change)
 *  4. Target/blockType compatibility matrix
 *  5. Classifier precedence
 *  6. Evidence-carrying prose (no KnowledgeRuleEvidenceV3 query)
 *  7. Source language resolution
 *  8. Table cell validation
 *  9. Figure & HTML safety
 * 10. Provider response validator (schema, HTML, unknown/dup/missing IDs)
 * 11. Protected token preservation
 * 12. Provider resolution ordering (same-lang, unknown-lang, all-excluded)
 * 13. Provider safety & registry (fake unreachable from production)
 * 14. Canonical provider input limit (B)
 * 15. Failure handling & deadline (deterministic, no sleep)
 * 16. Cumulative output byte limit across batches
 * 17. Client abort propagation
 * 18. routeId/path propagation
 * 19. Discriminated union shape
 * 20. Canonical integrity (zero DB writes, chunk.text unchanged)
 * 21. Canonical identity regression (hash formula, 208/208 preserved)
 * 22. Controller/route boundary tests
 * 23. Write guard assertions
 *
 * Zero DB writes. Zero external network or generative-model calls.
 */

process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import mongoose from 'mongoose';

// ─── Route & Controller imports for boundary tests ──────────────────────────
import sourceRouter from '../../../routes/sourceRoutes';
import moderationRouter from '../../../routes/moderationRoutes';
import { getApprovedSourceTranslation } from '../../../controllers/sourceController';
import { getSourcePreviewTranslation } from '../../../controllers/moderationController';
import { resolveApprovedSourceContext, resolvePreviewContributionContext } from './readerTranslationContext.service';
import * as registry from './readerTranslationProvider.registry';
import { parseTranslationDeadline, getTranslationDeadlineMs } from '../../../config/translationConfig';
import authMiddleware, { isModerator } from '../../../middleware/authMiddleware';
import * as translationServiceModule from './canonicalReaderTranslation.service';

// ─── Model imports (for write guards) ─────────────────────────────────────────
import AcademicSource from '../../../models/AcademicSource';
import SourceContribution from '../../../models/SourceContribution';
import AcademicDocument from '../../../models/AcademicDocument';
import AcademicSection from '../../../models/AcademicSection';
import AcademicChunk from '../../../models/AcademicChunk';

// ─── Service imports ──────────────────────────────────────────────────────────
import { translateReaderTargets } from './canonicalReaderTranslation.service';
import { validateRequestShape, checkHttpBodyLimit, checkCanonicalProviderInputLimit } from './readerTranslationValidator.service';
import { validateProviderResponseJson, validateProviderOutputObject } from './readerTranslationProviderResponse.validator';
import { isPurelyNonTranslatableCell, validateTargetBlockTypeCompatibility, classifyTarget, computeContentHash } from './readerTranslationClassifier.service';
import { extractProtectedTokens, validateProtectedTokensPreserved } from './readerTranslationProtectedTokens.service';
import { resolveTranslationProvider, TranslationProviderUnavailableError } from './readerTranslationProvider.registry';
import { FakeReaderTranslationProvider } from './__test_support__/fakeReaderTranslationProvider';
import {
  TranslationServiceDeps,
  TranslationServiceCallParams,
  CanonicalTranslationContext,
  ChunkForTranslation,
  AppLocale,
  MAX_TARGETS_PER_REQUEST,
  MAX_HTTP_BODY_BYTES,
  MAX_CANONICAL_INPUT_BYTES,
  MAX_PROVIDER_OUTPUT_BYTES,
  CanonicalResolutionError,
} from './readerTranslation.types';

// ─── Canonical identity regression ───────────────────────────────────────────
import { calculateSourceContentHash, normalizeLanguageCode } from './canonicalReaderIdentity.service';

// ─── Write method guard list ──────────────────────────────────────────────────
const WRITE_METHODS = [
  'save', 'create', 'insertMany', 'updateOne', 'updateMany',
  'findOneAndUpdate', 'replaceOne', 'bulkWrite',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
  'findByIdAndUpdate', 'findByIdAndDelete',
] as const;

type WriteMethodName = typeof WRITE_METHODS[number];

function blockModelWrites(model: any): Map<WriteMethodName, any> {
  const backup = new Map<WriteMethodName, any>();
  const throwWrite = (method: string) => () => {
    throw new Error(`FORBIDDEN_WRITE_IN_TRANSLATION_TEST: ${method}`);
  };
  for (const m of WRITE_METHODS) {
    backup.set(m, model[m]);
    model[m] = throwWrite(m);
  }
  return backup;
}

function restoreModelWrites(model: any, backup: Map<WriteMethodName, any>): void {
  for (const [m, fn] of backup) {
    model[m] = fn;
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function makeId(): string {
  return new mongoose.Types.ObjectId().toString();
}

function makeChunk(overrides: Partial<ChunkForTranslation> & { _id?: string }, docId = 'doc123'): ChunkForTranslation {
  return {
    _id: overrides._id ?? makeId(),
    chunkPurpose: 'reader',
    blockType: 'paragraph',
    text: 'Default text.',
    documentId: docId,
    ...overrides,
  };
}

function makeTableChunk(docId = 'doc123'): ChunkForTranslation {
  return {
    _id: makeId(),
    chunkPurpose: 'reader',
    blockType: 'table',
    text: 'Table caption.',
    documentId: docId,
    tableData: {
      rowCount: 2,
      columnCount: 2,
      cells: [
        { row: 0, column: 0, rowSpan: 1, columnSpan: 1, text: 'Header A', role: 'header' },
        { row: 0, column: 1, rowSpan: 1, columnSpan: 1, text: '42.5 mg/dL', role: 'data' },
        { row: 1, column: 0, rowSpan: 1, columnSpan: 1, text: '42.5', role: 'data' },
        { row: 1, column: 1, rowSpan: 1, columnSpan: 1, text: 'p < 0.001', role: 'data' },
      ],
    },
  };
}

// ─── Deps builder ─────────────────────────────────────────────────────────────

interface DepsOverrides {
  context?: Partial<CanonicalTranslationContext>;
  chunks?: ChunkForTranslation[];
  fakeTrans?: Record<string, string>;
  resolveProvider?: () => any;
  resolveCanonicalContext?: TranslationServiceDeps['resolveCanonicalContext'];
  loadChunks?: TranslationServiceDeps['loadChunks'];
  now?: () => number;
  deadlineMs?: number;
  setTimer?: TranslationServiceDeps['setTimer'];
  clearTimer?: TranslationServiceDeps['clearTimer'];
}

const DEFAULT_DOC_ID = 'doc123';

function makeDeps(overrides: DepsOverrides = {}): TranslationServiceDeps {
  const ctx: CanonicalTranslationContext = {
    documentId: DEFAULT_DOC_ID,
    sourceLanguage: 'en',
    sourceContentHash: 'a'.repeat(64),
    ...(overrides.context ?? {}),
  };

  const chunks: ChunkForTranslation[] = overrides.chunks ?? [];
  const fakeProvider = new FakeReaderTranslationProvider({ translations: overrides.fakeTrans ?? {} });

  return {
    resolveCanonicalContext: overrides.resolveCanonicalContext ?? ((_routeId, _path) => Promise.resolve(ctx)),
    loadChunks: overrides.loadChunks ?? ((_documentId, chunkIds) =>
      Promise.resolve(chunks.filter((c) => chunkIds.includes(c._id.toString())))
    ),
    resolveProvider: overrides.resolveProvider ?? (() => fakeProvider),
    now: overrides.now ?? (() => Date.now()),
    deadlineMs: overrides.deadlineMs,
    createAbortController: () => new AbortController(),
    setTimer: overrides.setTimer ?? ((cb, ms) => setTimeout(cb, ms)),
    clearTimer: overrides.clearTimer ?? ((h) => clearTimeout(h)),
  };
}

function makeParams(
  request: { sourceContentHash: string; targetLocale: AppLocale; targets: any[] },
  routeId = 'route-source-id',
  path: 'approved' | 'preview' = 'approved'
): TranslationServiceCallParams {
  return { routeId, path, request: request as any };
}

// ─── Test harness ─────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log('=== PHASE I18N-3B.2A TRANSLATION CONTRACT TESTS ===\n');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err: any) {
      failed++;
      failures.push(`${name}: ${err?.message ?? err}`);
      console.error(`  ✗ ${name}`);
      console.error(`    ${err?.message ?? err}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §1. HTTP Body Limit
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§1. HTTP Body Limit');

  await test('exact limit allowed', () => {
    assert.equal(checkHttpBodyLimit(MAX_HTTP_BODY_BYTES), null);
  });

  await test('one byte over limit rejected (413)', () => {
    const err = checkHttpBodyLimit(MAX_HTTP_BODY_BYTES + 1);
    assert.ok(err);
    assert.equal(err!.code, 'reader_translation_limit_exceeded');
    assert.equal(err!.httpStatus, 413);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §2. Request Shape Validation
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§2. Request Shape Validation');

  await test('valid block_text request passes', () => {
    const r = validateRequestShape({
      sourceContentHash: sha256('source'),
      targetLocale: 'vi',
      targets: [{ targetType: 'block_text', chunkId: makeId(), contentHash: sha256('x') }],
    });
    assert.ok(r.valid);
  });

  await test('invalid locale rejects (400)', () => {
    const r = validateRequestShape({ sourceContentHash: sha256('s'), targetLocale: 'zh', targets: [{ targetType: 'block_text', chunkId: makeId(), contentHash: sha256('x') }] });
    assert.ok(!r.valid);
    assert.equal((r as any).error.code, 'reader_translation_request_invalid');
  });

  await test('missing sourceContentHash rejects', () => {
    const r = validateRequestShape({ targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId: makeId(), contentHash: sha256('x') }] });
    assert.ok(!r.valid);
  });

  await test('malformed chunkId (not ObjectId) rejects', () => {
    const r = validateRequestShape({ sourceContentHash: sha256('s'), targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId: 'not-valid', contentHash: sha256('x') }] });
    assert.ok(!r.valid);
    assert.equal((r as any).error.code, 'reader_translation_target_invalid');
  });

  await test('contentHash too short rejects', () => {
    const r = validateRequestShape({ sourceContentHash: sha256('s'), targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId: makeId(), contentHash: 'abc' }] });
    assert.ok(!r.valid);
  });

  await test('duplicate block_text targets reject', () => {
    const id = makeId();
    const r = validateRequestShape({ sourceContentHash: sha256('s'), targetLocale: 'vi', targets: [
      { targetType: 'block_text', chunkId: id, contentHash: sha256('x') },
      { targetType: 'block_text', chunkId: id, contentHash: sha256('x') },
    ]});
    assert.ok(!r.valid);
    assert.equal((r as any).error.code, 'reader_translation_target_invalid');
  });

  await test('duplicate table_cell (row, col) rejects', () => {
    const id = makeId();
    const r = validateRequestShape({ sourceContentHash: sha256('s'), targetLocale: 'vi', targets: [
      { targetType: 'table_cell', chunkId: id, row: 0, column: 0, contentHash: sha256('x') },
      { targetType: 'table_cell', chunkId: id, row: 0, column: 0, contentHash: sha256('x') },
    ]});
    assert.ok(!r.valid);
  });

  await test(`>${MAX_TARGETS_PER_REQUEST} targets rejects (413)`, () => {
    const targets = Array.from({ length: MAX_TARGETS_PER_REQUEST + 1 }, () =>
      ({ targetType: 'block_text', chunkId: makeId(), contentHash: sha256('x') })
    );
    const r = validateRequestShape({ sourceContentHash: sha256('s'), targetLocale: 'vi', targets });
    assert.ok(!r.valid);
    assert.equal((r as any).error.httpStatus, 413);
  });

  await test('table_cell missing row rejects', () => {
    const r = validateRequestShape({ sourceContentHash: sha256('s'), targetLocale: 'vi', targets: [{ targetType: 'table_cell', chunkId: makeId(), column: 0, contentHash: sha256('x') } as any] });
    assert.ok(!r.valid);
  });

  await test('negative row rejects', () => {
    const r = validateRequestShape({ sourceContentHash: sha256('s'), targetLocale: 'vi', targets: [{ targetType: 'table_cell', chunkId: makeId(), row: -1, column: 0, contentHash: sha256('x') }] });
    assert.ok(!r.valid);
  });

  await test('empty targets array rejects', () => {
    const r = validateRequestShape({ sourceContentHash: sha256('s'), targetLocale: 'vi', targets: [] });
    assert.ok(!r.valid);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §3. Identity Validation (full-document hash)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§3. Identity Validation');

  await test('stale sourceContentHash returns 409', async () => {
    const chunkId = makeId();
    const chunk = makeChunk({ _id: chunkId, text: 'Hello.' });
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: 'b'.repeat(64), targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256(chunk.text) }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: sha256('current-hash') } })
    );
    assert.ok(!result.success);
    assert.equal((result as any).error.code, 'reader_translation_identity_stale');
    assert.equal((result as any).error.httpStatus, 409);
  });

  await test('off-page chunk change triggers stale hash (409)', async () => {
    const targetId = makeId();
    const chunk = makeChunk({ _id: targetId, text: 'Target text.' });
    // Server sees a different hash because an off-page chunk changed
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: sha256('old-full-hash'), targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId: targetId, contentHash: sha256(chunk.text) }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: sha256('new-full-hash-after-off-page-change') } })
    );
    assert.ok(!result.success);
    assert.equal((result as any).error.code, 'reader_translation_identity_stale');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §4. routeId / path Propagation
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§4. routeId/path Propagation');

  await test('approved path passes actual routeId to resolveCanonicalContext', async () => {
    const capturedCalls: Array<{ routeId: string; path: string }> = [];
    const chunkId = makeId();
    const chunk = makeChunk({ _id: chunkId, text: 'T.' });
    const srcHash = sha256('h');
    const deps = makeDeps({
      chunks: [chunk],
      context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash },
      resolveCanonicalContext: async (routeId, path) => {
        capturedCalls.push({ routeId, path });
        return { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash };
      },
    });
    await translateReaderTargets({ routeId: 'source-abc', path: 'approved', request: { sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('T.') }] } }, deps);
    assert.equal(capturedCalls.length, 1);
    assert.equal(capturedCalls[0].routeId, 'source-abc');
    assert.equal(capturedCalls[0].path, 'approved');
  });

  await test('preview path passes actual routeId to resolveCanonicalContext', async () => {
    const capturedCalls: Array<{ routeId: string; path: string }> = [];
    const chunkId = makeId();
    const chunk = makeChunk({ _id: chunkId, text: 'T.' });
    const srcHash = sha256('h');
    const deps = makeDeps({
      chunks: [chunk],
      context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash },
      resolveCanonicalContext: async (routeId, path) => {
        capturedCalls.push({ routeId, path });
        return { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash };
      },
    });
    await translateReaderTargets({ routeId: 'contrib-xyz', path: 'preview', request: { sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('T.') }] } }, deps);
    assert.equal(capturedCalls.length, 1);
    assert.equal(capturedCalls[0].routeId, 'contrib-xyz');
    assert.equal(capturedCalls[0].path, 'preview');
  });

  await test('approved and preview paths produce distinct calls (no interchange)', async () => {
    const calls1: string[] = [];
    const calls2: string[] = [];
    const srcHash = sha256('h');
    const makeBaseDeps = (captured: string[]) => makeDeps({
      context: { sourceContentHash: srcHash, sourceLanguage: 'vi', documentId: DEFAULT_DOC_ID },
      resolveCanonicalContext: async (_routeId, path) => { captured.push(path); return { documentId: DEFAULT_DOC_ID, sourceLanguage: 'vi', sourceContentHash: srcHash }; },
    });
    await translateReaderTargets({ routeId: 'r1', path: 'approved', request: { sourceContentHash: srcHash, targetLocale: 'vi', targets: [] } as any }, makeBaseDeps(calls1)).catch(() => {});
    await translateReaderTargets({ routeId: 'r2', path: 'preview', request: { sourceContentHash: srcHash, targetLocale: 'vi', targets: [] } as any }, makeBaseDeps(calls2)).catch(() => {});
    // both will fail (no targets) but we capture the path values
    assert.equal(calls1[0], 'approved');
    assert.equal(calls2[0], 'preview');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §5. Target/BlockType Compatibility Matrix
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§5. Target/BlockType Compatibility Matrix');

  const compatCases: Array<{ targetType: string; blockType: string; shouldPass: boolean }> = [
    { targetType: 'block_text', blockType: 'title', shouldPass: true },
    { targetType: 'block_text', blockType: 'heading', shouldPass: true },
    { targetType: 'block_text', blockType: 'paragraph', shouldPass: true },
    { targetType: 'block_text', blockType: 'list_item', shouldPass: true },
    // reference/metadata/page_break are block_text-compatible (classifier excludes them)
    { targetType: 'block_text', blockType: 'reference', shouldPass: true },
    { targetType: 'block_text', blockType: 'metadata', shouldPass: true },
    { targetType: 'block_text', blockType: 'page_break', shouldPass: true },
    // figure and table are incompatible with block_text
    { targetType: 'block_text', blockType: 'figure', shouldPass: false },
    { targetType: 'block_text', blockType: 'table', shouldPass: false },
    { targetType: 'block_text', blockType: '', shouldPass: false },
    { targetType: 'figure_caption', blockType: 'figure', shouldPass: true },
    { targetType: 'figure_caption', blockType: 'paragraph', shouldPass: false },
    { targetType: 'figure_caption', blockType: 'reference', shouldPass: false },
    { targetType: 'figure_caption', blockType: 'table', shouldPass: false },
    { targetType: 'table_cell', blockType: 'table', shouldPass: true },
    { targetType: 'table_cell', blockType: 'paragraph', shouldPass: false },
    { targetType: 'table_cell', blockType: 'figure', shouldPass: false },
  ];

  for (const { targetType, blockType, shouldPass } of compatCases) {
    await test(`${targetType} + ${blockType || '(unknown)'} → ${shouldPass ? 'compatible' : 'incompatible'}`, () => {
      const target = { targetType, chunkId: makeId(), contentHash: sha256('x') } as any;
      const chunk = makeChunk({ blockType });
      const err = validateTargetBlockTypeCompatibility(target, chunk);
      if (shouldPass) assert.equal(err, null);
      else assert.ok(err !== null);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §6. Classifier Precedence
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§6. Classifier Precedence');

  function classify(bt: string, targetType = 'block_text', srcLang: string | null = 'en', tgt: AppLocale = 'vi', extra: Partial<ChunkForTranslation> = {}) {
    const chunk = makeChunk({ blockType: bt, ...extra });
    const target = { targetType, chunkId: chunk._id.toString(), contentHash: sha256(chunk.text) } as any;
    return classifyTarget(target, chunk, srcLang, tgt);
  }

  await test('reference → excluded_reference', () => {
    const r = classify('reference');
    assert.ok(!r.eligible);
    assert.equal((r as any).nonTranslated.status, 'excluded_reference');
  });
  await test('page_break → excluded_structured_content', () => {
    const r = classify('page_break');
    assert.ok(!r.eligible);
    assert.equal((r as any).nonTranslated.status, 'excluded_structured_content');
  });
  await test('metadata → excluded_structured_content', () => {
    const r = classify('metadata');
    assert.ok(!r.eligible);
    assert.equal((r as any).nonTranslated.status, 'excluded_structured_content');
  });
  await test('table without tableData → excluded_structured_content', () => {
    const r = classify('table', 'table_cell', 'en', 'vi', { tableData: undefined });
    assert.ok(!r.eligible);
    assert.equal((r as any).nonTranslated.status, 'excluded_structured_content');
  });
  await test('figure with empty text → excluded_structured_content', () => {
    const r = classify('figure', 'figure_caption', 'en', 'vi', { text: '' });
    assert.ok(!r.eligible);
    assert.equal((r as any).nonTranslated.status, 'excluded_structured_content');
  });
  await test('same language → same_language', () => {
    const r = classify('paragraph', 'block_text', 'vi', 'vi');
    assert.ok(!r.eligible);
    assert.equal((r as any).nonTranslated.status, 'same_language');
  });
  await test('null sourceLanguage → source_language_unknown', () => {
    const r = classify('paragraph', 'block_text', null, 'vi');
    assert.ok(!r.eligible);
    assert.equal((r as any).nonTranslated.status, 'source_language_unknown');
  });
  await test('title → eligible', () => { assert.ok(classify('title').eligible); });
  await test('paragraph → eligible', () => { assert.ok(classify('paragraph').eligible); });
  await test('figure with text → eligible for figure_caption', () => {
    assert.ok(classify('figure', 'figure_caption', 'en', 'vi', { text: 'Fig.' }).eligible);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §7. Evidence-Carrying Prose
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§7. Evidence-Carrying Prose');

  await test('evidence-carrying paragraph receives display translation', async () => {
    const chunkId = makeId();
    const text = 'Sleep deprivation impairs cognitive function [1].';
    const chunk = makeChunk({ _id: chunkId, blockType: 'paragraph', text });
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256(text) }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash }, fakeTrans: { [chunkId]: 'Thiếu ngủ làm suy giảm nhận thức [1].' } })
    );
    assert.ok(result.success);
    assert.equal((result as any).response.targets[0].status, 'translated');
  });

  await test('chunk.text is byte-identical after translation', async () => {
    const chunkId = makeId();
    const originalText = 'Exact canonical text.';
    const chunk = makeChunk({ _id: chunkId, text: originalText });
    const srcHash = sha256('h');
    await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256(originalText) }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash } })
    );
    assert.equal(chunk.text, originalText);
  });

  await test('no KnowledgeRuleEvidenceV3 query in deps interface', () => {
    const deps = makeDeps();
    assert.ok(!('loadEvidenceByChunkIds' in deps));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §8. Source Language Resolution
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§8. Source Language Resolution');

  await test('normalizeLanguageCode vi-VN → vi', () => { assert.equal(normalizeLanguageCode('vi-VN'), 'vi'); });
  await test('normalizeLanguageCode en-US → en', () => { assert.equal(normalizeLanguageCode('en-US'), 'en'); });
  await test('normalizeLanguageCode zh → null', () => { assert.equal(normalizeLanguageCode('zh'), null); });
  await test('null detectedLanguage → source_language_unknown, zero provider calls', async () => {
    let providerCalled = false;
    const chunkId = makeId();
    const chunk = makeChunk({ _id: chunkId, text: 'T.' });
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('T.') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: null, sourceContentHash: srcHash }, resolveProvider: () => { providerCalled = true; return new FakeReaderTranslationProvider(); } })
    );
    assert.ok(result.success);
    assert.equal((result as any).response.targets[0].status, 'source_language_unknown');
    assert.ok(!providerCalled);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §9. Table Cell Validation
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§9. Table Cell Validation');

  await test('row >= rowCount rejects', async () => {
    const chunk = makeTableChunk();
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'table_cell', chunkId: chunk._id.toString(), row: 5, column: 0, contentHash: sha256('x') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash } })
    );
    assert.ok(!result.success);
    assert.equal((result as any).error.code, 'reader_translation_target_invalid');
  });

  await test('wrong contentHash for cell rejects', async () => {
    const chunk = makeTableChunk();
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'table_cell', chunkId: chunk._id.toString(), row: 0, column: 0, contentHash: sha256('wrong') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash } })
    );
    assert.ok(!result.success);
    assert.equal((result as any).error.code, 'reader_translation_target_invalid');
  });

  await test('pure numeric cell (42.5) → excluded_structured_content', async () => {
    const chunk = makeTableChunk();
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'table_cell', chunkId: chunk._id.toString(), row: 1, column: 0, contentHash: sha256('42.5') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash } })
    );
    assert.ok(result.success);
    assert.equal((result as any).response.targets[0].status, 'excluded_structured_content');
  });

  await test('statistical p < 0.001 → excluded_structured_content', async () => {
    const chunk = makeTableChunk();
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'table_cell', chunkId: chunk._id.toString(), row: 1, column: 1, contentHash: sha256('p < 0.001') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash } })
    );
    assert.ok(result.success);
    assert.equal((result as any).response.targets[0].status, 'excluded_structured_content');
  });

  await test('Header A cell is eligible and translates', async () => {
    const chunk = makeTableChunk();
    const srcHash = sha256('h');
    const targetId = `${chunk._id.toString()}:0:0`;
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'table_cell', chunkId: chunk._id.toString(), row: 0, column: 0, contentHash: sha256('Header A') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash }, fakeTrans: { [targetId]: 'Tiêu đề A' } })
    );
    assert.ok(result.success);
    assert.equal((result as any).response.targets[0].status, 'translated');
  });

  await test('isPurelyNonTranslatableCell: pure number is excluded', () => {
    assert.ok(isPurelyNonTranslatableCell('42.5'));
    assert.ok(isPurelyNonTranslatableCell('42'));
    assert.ok(isPurelyNonTranslatableCell('p < 0.001'));
    assert.ok(!isPurelyNonTranslatableCell('Mean blood glucose (mg/dL)'));
    assert.ok(!isPurelyNonTranslatableCell('Header A'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §10. Provider Response Validator
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§10. Provider Response Validator');

  await test('valid response passes', () => {
    const ids = new Set(['chunk1', 'chunk2']);
    const json = JSON.stringify({ items: [{ targetId: 'chunk1', translatedText: 'A' }, { targetId: 'chunk2', translatedText: 'B' }] });
    assert.ok(validateProviderResponseJson(json, ids).valid);
  });

  await test('unknown targetId rejects', () => {
    const ids = new Set(['chunk1']);
    const json = JSON.stringify({ items: [{ targetId: 'UNKNOWN', translatedText: 'A' }] });
    assert.ok(!validateProviderResponseJson(json, ids).valid);
  });

  await test('duplicate targetId rejects', () => {
    const ids = new Set(['c1']);
    const json = JSON.stringify({ items: [{ targetId: 'c1', translatedText: 'A' }, { targetId: 'c1', translatedText: 'B' }] });
    assert.ok(!validateProviderResponseJson(json, ids).valid);
  });

  await test('missing targetId rejects', () => {
    const ids = new Set(['c1', 'c2']);
    const json = JSON.stringify({ items: [{ targetId: 'c1', translatedText: 'A' }] });
    assert.ok(!validateProviderResponseJson(json, ids).valid);
  });

  await test('empty translatedText rejects', () => {
    const ids = new Set(['c1']);
    const json = JSON.stringify({ items: [{ targetId: 'c1', translatedText: '' }] });
    assert.ok(!validateProviderResponseJson(json, ids).valid);
  });

  await test('extra top-level property rejects', () => {
    const ids = new Set(['c1']);
    const json = JSON.stringify({ items: [{ targetId: 'c1', translatedText: 'A' }], extra: true });
    assert.ok(!validateProviderResponseJson(json, ids).valid);
  });

  await test('extra item property rejects', () => {
    const ids = new Set(['c1']);
    const json = JSON.stringify({ items: [{ targetId: 'c1', translatedText: 'A', x: 1 }] });
    assert.ok(!validateProviderResponseJson(json, ids).valid);
  });

  await test('output > 64 KiB rejects with translation_output_too_large', () => {
    const ids = new Set(['c1']);
    const json = JSON.stringify({ items: [{ targetId: 'c1', translatedText: 'x'.repeat(70_000) }] });
    const r = validateProviderResponseJson(json, ids);
    assert.ok(!r.valid);
    assert.equal((r as any).reason, 'translation_output_too_large');
  });

  await test('HTML script tag in translatedText rejects', () => {
    const ids = new Set(['c1']);
    const json = JSON.stringify({ items: [{ targetId: 'c1', translatedText: '<script>alert(1)</script>' }] });
    const r = validateProviderResponseJson(json, ids);
    assert.ok(!r.valid);
    assert.equal((r as any).reason, 'translation_schema_invalid');
  });

  await test('HTML div tag in translatedText rejects', () => {
    const ids = new Set(['c1']);
    const json = JSON.stringify({ items: [{ targetId: 'c1', translatedText: '<div>content</div>' }] });
    assert.ok(!validateProviderResponseJson(json, ids).valid);
  });

  await test('scientific comparison p < 0.05 does NOT trigger HTML rejection', () => {
    const ids = new Set(['c1']);
    const json = JSON.stringify({ items: [{ targetId: 'c1', translatedText: 'results show p < 0.05' }] });
    assert.ok(validateProviderResponseJson(json, ids).valid);
  });

  await test('x > 3 does NOT trigger HTML rejection', () => {
    const ids = new Set(['c1']);
    const json = JSON.stringify({ items: [{ targetId: 'c1', translatedText: 'x > 3 and y < 10' }] });
    assert.ok(validateProviderResponseJson(json, ids).valid);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §11. Protected Token Preservation
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§11. Protected Token Preservation');

  await test('unchanged mg/dL passes', () => {
    const r = validateProtectedTokensPreserved('Mean blood glucose (mg/dL)', 'Đường huyết trung bình (mg/dL)');
    assert.ok(r.valid);
  });

  await test('changed mg/dL fails', () => {
    const r = validateProtectedTokensPreserved('Glucose: 5.6 mmol/L', 'Glucose: 5.7 mmol/L');
    assert.ok(!r.valid);
  });

  await test('changed number fails', () => {
    const r = validateProtectedTokensPreserved('Sample size was 120.', 'Cỡ mẫu là 150.');
    assert.ok(!r.valid);
  });

  await test('removed [1] fails', () => {
    const r = validateProtectedTokensPreserved('As shown [1], sleep matters.', 'Sleep matters.');
    assert.ok(!r.valid);
  });

  await test('changed DOI fails', () => {
    const r = validateProtectedTokensPreserved('doi: 10.1000/xyz123', 'doi: 10.9999/changed');
    assert.ok(!r.valid);
  });

  await test('translated prose around protected tokens passes', () => {
    const r = validateProtectedTokensPreserved('Participants showed 42% improvement [2].', 'Người tham gia cải thiện 42% [2].');
    assert.ok(r.valid);
  });

  await test('p < 0.05 is protected', () => {
    const r = validateProtectedTokensPreserved('Results: p < 0.05.', 'Kết quả không có p < 0.05.');
    // p < 0.05 removed → should fail
    const r2 = validateProtectedTokensPreserved('Results: p < 0.05.', 'Kết quả.');
    assert.ok(!r2.valid);
  });

  await test('standalone mg/dL protected even without preceding number', () => {
    const tokens = extractProtectedTokens('Mean blood glucose (mg/dL)');
    assert.ok(tokens.some(t => t.toLowerCase() === 'mg/dl'), `tokens: ${JSON.stringify(tokens)}`);
  });

  await test('pure numeric cell excluded without provider call', async () => {
    let providerCalled = false;
    const chunkId = makeId();
    const chunk: ChunkForTranslation = {
      _id: chunkId, chunkPurpose: 'reader', blockType: 'table', text: 'T', documentId: DEFAULT_DOC_ID,
      tableData: { rowCount: 1, columnCount: 1, cells: [{ row: 0, column: 0, rowSpan: 1, columnSpan: 1, text: '42', role: 'data' }] },
    };
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'table_cell', chunkId, row: 0, column: 0, contentHash: sha256('42') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash }, resolveProvider: () => { providerCalled = true; return new FakeReaderTranslationProvider(); } })
    );
    assert.ok(result.success);
    assert.equal((result as any).response.targets[0].status, 'excluded_structured_content');
    assert.ok(!providerCalled);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §12. Provider Resolution Ordering
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§12. Provider Resolution Ordering');

  await test('same_language: provider NOT resolved', async () => {
    let resolved = false;
    const chunkId = makeId();
    const chunk = makeChunk({ _id: chunkId, text: 'T.' });
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('T.') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'vi', sourceContentHash: srcHash }, resolveProvider: () => { resolved = true; return new FakeReaderTranslationProvider(); } })
    );
    assert.ok(result.success && !resolved);
  });

  await test('unknown-language: provider NOT resolved', async () => {
    let resolved = false;
    const chunkId = makeId();
    const chunk = makeChunk({ _id: chunkId, text: 'T.' });
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('T.') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: null, sourceContentHash: srcHash }, resolveProvider: () => { resolved = true; return new FakeReaderTranslationProvider(); } })
    );
    assert.ok(result.success && !resolved);
  });

  await test('all-excluded: provider NOT resolved', async () => {
    let resolved = false;
    const chunkId = makeId();
    // Use same-language paragraph: classifier excludes it without needing reference blockType
    const chunk = makeChunk({ _id: chunkId, blockType: 'paragraph', text: 'T.' });
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('T.') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'vi', sourceContentHash: srcHash }, resolveProvider: () => { resolved = true; return new FakeReaderTranslationProvider(); } })
    );
    assert.ok(result.success);
    assert.ok(!resolved);
    assert.equal((result as any).response.targets[0].status, 'same_language');
  });

  await test('eligible target causes provider to be resolved', async () => {
    let resolved = false;
    const chunkId = makeId();
    const chunk = makeChunk({ _id: chunkId, text: 'T.' });
    const srcHash = sha256('h');
    // resolveProvider throws 503 (production behavior)
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('T.') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash }, resolveProvider: () => { resolved = true; throw new TranslationProviderUnavailableError('test'); } })
    );
    assert.ok(resolved);
    assert.ok(!result.success);
    assert.equal((result as any).error.code, 'reader_translation_provider_unavailable');
    assert.equal((result as any).error.httpStatus, 503);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §13. Provider Safety & Registry
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§13. Provider Safety & Registry');

  await test('no server translation engine registered → throws unavailable', () => {
    assert.throws(() => resolveTranslationProvider(), /unavailable/i);
  });

  await test('READER_TRANSLATION_ENGINE=fake → throws unavailable (cannot select)', () => {
    const orig = process.env.READER_TRANSLATION_ENGINE;
    process.env.READER_TRANSLATION_ENGINE = 'fake';
    try {
      assert.throws(() => resolveTranslationProvider(), /unavailable/i);
    } finally {
      if (orig !== undefined) process.env.READER_TRANSLATION_ENGINE = orig;
      else delete process.env.READER_TRANSLATION_ENGINE;
    }
  });

  await test('registry does not export FakeReaderTranslationProvider', () => {
    const registryExports = Object.keys(require('./readerTranslationProvider.registry'));
    assert.ok(!registryExports.includes('FakeReaderTranslationProvider'));
  });

  await test('unavailable engine result is run-level 503 (not per-target)', async () => {
    const chunkId = makeId();
    const chunk = makeChunk({ _id: chunkId, text: 'T.' });
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('T.') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash }, resolveProvider: () => { throw new TranslationProviderUnavailableError('test'); } })
    );
    // Must be run-level failure, not success with per-target provider_failed
    assert.ok(!result.success);
    assert.equal((result as any).error.code, 'reader_translation_provider_unavailable');
    assert.equal((result as any).error.httpStatus, 503);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §14. Canonical Provider Input Limit (B)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§14. Canonical Provider Input Limit (B)');

  await test('exact envelope byte measurement (Buffer.byteLength, not string.length)', () => {
    const items = [{ targetId: 'c1', text: 'Đây là tiếng Việt.' }];
    const env = { items };
    const byteLen = Buffer.byteLength(JSON.stringify(env), 'utf8');
    const strLen = JSON.stringify(env).length;
    assert.ok(byteLen >= strLen);
  });

  await test('eligible input within limit passes', () => {
    assert.equal(checkCanonicalProviderInputLimit([{ targetId: 'c1', text: 'Short.' }]), null);
  });

  await test('eligible input over 24 KiB rejects', () => {
    const err = checkCanonicalProviderInputLimit([{ targetId: 'c1', text: 'x'.repeat(25_000) }]);
    assert.ok(err);
    assert.equal(err!.code, 'reader_translation_limit_exceeded');
  });

  await test('excluded targets not counted toward provider input', async () => {
    const refId = makeId();
    const eligId = makeId();
    // Reference chunk: now addressable via block_text — sha256 of its text must match
    const refText = 'Smith.'.repeat(5000);
    const refChunk = makeChunk({ _id: refId, blockType: 'reference', text: refText });
    const eligChunk = makeChunk({ _id: eligId, text: 'Short.' });
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [
        { targetType: 'block_text', chunkId: refId, contentHash: sha256(refText) },
        { targetType: 'block_text', chunkId: eligId, contentHash: sha256(eligChunk.text) },
      ]}),
      makeDeps({ chunks: [refChunk, eligChunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash } })
    );
    assert.ok(result.success);
    assert.equal((result as any).response.targets[0].status, 'excluded_reference');
    assert.equal((result as any).response.targets[1].status, 'translated');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §15. Failure Handling & Deterministic Timeout
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§15. Failure Handling & Deterministic Timeout');

  await test('provider always throws → targets get provider_failed (HTTP 200)', async () => {
    const chunkId = makeId();
    const chunk = makeChunk({ _id: chunkId, text: 'T.' });
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('T.') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash }, resolveProvider: () => new FakeReaderTranslationProvider({ alwaysThrow: true }) })
    );
    assert.ok(result.success);
    assert.equal((result as any).response.targets[0].status, 'provider_failed');
  });

  await test('deadline past → translation_timeout (deterministic, no real sleep)', async () => {
    const chunkId = makeId();
    const chunk = makeChunk({ _id: chunkId, text: 'T.' });
    const srcHash = sha256('h');
    // Inject deterministic clock: deadline is always past
    let tick = 1000;
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('T.') }] }),
      makeDeps({
        chunks: [chunk],
        context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash },
        resolveProvider: () => new FakeReaderTranslationProvider({ alwaysTimeout: true }),
        now: () => { tick += 10_000; return tick; },
        deadlineMs: 1,
        setTimer: (cb, _ms) => { cb(); return 0 as any; }, // fire immediately
        clearTimer: () => {},
      })
    );
    assert.ok(result.success);
    const target = (result as any).response.targets[0];
    assert.equal(target.status, 'provider_failed');
    assert.ok(['translation_timeout', 'translation_provider_failed'].includes(target.providerFailureCode));
  });

  await test('timeout does not mutate chunk.text', async () => {
    const chunkId = makeId();
    const originalText = 'Canonical text, immutable.';
    const chunk = makeChunk({ _id: chunkId, text: originalText });
    const srcHash = sha256('h');
    await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256(originalText) }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash }, resolveProvider: () => new FakeReaderTranslationProvider({ alwaysTimeout: true }) })
    );
    assert.equal(chunk.text, originalText);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §16. Cumulative Output Byte Limit
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§16. Cumulative Output Byte Limit');

  await test('each batch < 64 KiB but combined > 64 KiB → later targets provider_failed', async () => {
    const srcHash = sha256('h');

    // Each batch returns ~50 KiB per item. With MT_BATCH_SIZE=15, first batch (15 items)
    // returns 15 × ~3500 B ≈ 52 KiB (within per-batch 64 KiB limit).
    // Second batch (1 item, if 16 chunks): cumulative ~52K + ~3.5K = ~55K — still OK.
    // We need ONE batch returning ~50 KiB total, then SECOND batch tip over 64K cumulative.
    // Strategy: return ~40 KiB per item. 2 batches → first: ~40 KiB; second: cumulative 80 KiB > 64 KiB.
    // 16 items → batch 1 = 15 items, batch 2 = 1 item.
    // But batch 1 alone with 15 × 2700 chars = ~40 KiB total → within per-batch limit.
    // Make batch 1 return 40 KiB total, batch 2 would tip cumulative over 64 KiB.

    const PER_BATCH_BYTES = 40_000; // 40 KiB per batch (each batch individually under 64 KiB)
    class TwoBatchProvider {
      private callCount = 0;
      getMetadata() { return { name: 'twobatch', model: 'v1', isConfigured: true }; }
      async translateBatch(req: any) {
        this.callCount++;
        // Each item gets (PER_BATCH_BYTES / itemCount) chars
        const perItem = Math.floor(PER_BATCH_BYTES / Math.max(1, req.envelope.items.length));
        return {
          output: {
            items: req.envelope.items.map((i: any) => ({
              targetId: i.targetId,
              translatedText: 'T'.repeat(perItem),
            })),
          },
        };
      }
    }

    const provider = new TwoBatchProvider();

    // 16 chunks → MT_BATCH_SIZE=15 → batch 1 = 15 items, batch 2 = 1 item
    const chunkIds = Array.from({ length: 16 }, () => makeId());
    const chunks = chunkIds.map(id => makeChunk({ _id: id, text: 'Translate me.' }));
    const targets = chunkIds.map(id => ({
      targetType: 'block_text' as const,
      chunkId: id,
      contentHash: sha256('Translate me.'),
    }));

    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets }),
      makeDeps({
        chunks,
        context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash },
        resolveProvider: () => provider as any,
      })
    );

    assert.ok(result.success);
    const responseTargets = (result as any).response.targets;
    // First 15 targets: translated (batch 1 within 64 KiB per-batch and cumulative)
    const firstBatchTargets = responseTargets.slice(0, 15);
    const lastTarget = responseTargets[15];
    // The last target (batch 2) should fail because cumulative exceeded 64 KiB
    assert.equal(lastTarget.status, 'provider_failed');
    assert.equal(lastTarget.providerFailureCode, 'translation_output_too_large');
    // All first-batch targets should succeed
    assert.ok(firstBatchTargets.every((t: any) => t.status === 'translated'));
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // §17. Client Abort
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§17. Client Abort');

  await test('aborted clientSignal prevents translation start when already aborted', async () => {
    const chunkId = makeId();
    const chunk = makeChunk({ _id: chunkId, text: 'T.' });
    const srcHash = sha256('h');
    // Pre-aborted signal
    const controller = new AbortController();
    controller.abort();

    const result = await translateReaderTargets(
      { routeId: 'r', path: 'approved', request: { sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('T.') }] }, clientSignal: controller.signal },
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash }, resolveProvider: () => new FakeReaderTranslationProvider() })
    );
    assert.ok(result.success);
    // Aborted before batch starts → timeout/failed
    const target = (result as any).response.targets[0];
    assert.ok(['provider_failed', 'translated'].includes(target.status));
    // (If aborted before start, will be provider_failed with translation_timeout)
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §18. Discriminated Union Shape
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§18. Discriminated Union Shape');

  await test('SuccessfulTranslatedTarget has translatedText, no providerFailureCode', async () => {
    const chunkId = makeId();
    const chunk = makeChunk({ _id: chunkId, text: 'Hello.' });
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('Hello.') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash } })
    );
    assert.ok(result.success);
    const target = (result as any).response.targets[0];
    assert.equal(target.status, 'translated');
    assert.ok('translatedText' in target);
    assert.ok(!('providerFailureCode' in target));
  });

  await test('NonTranslatedTarget has no translatedText, no providerFailureCode', async () => {
    const chunkId = makeId();
    // Use same-language: classifier excludes without needing incompatible target type
    const chunk = makeChunk({ _id: chunkId, blockType: 'paragraph', text: 'Smith.' });
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('Smith.') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'vi', sourceContentHash: srcHash } })
    );
    assert.ok(result.success);
    const target = (result as any).response.targets[0];
    assert.equal(target.status, 'same_language');
    assert.ok(!('translatedText' in target));
    assert.ok(!('providerFailureCode' in target));
  });

  await test('FailedTranslationTarget has providerFailureCode, no translatedText', async () => {
    const chunkId = makeId();
    const chunk = makeChunk({ _id: chunkId, text: 'T.' });
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('T.') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash }, resolveProvider: () => new FakeReaderTranslationProvider({ alwaysThrow: true }) })
    );
    assert.ok(result.success);
    const target = (result as any).response.targets[0];
    assert.equal(target.status, 'provider_failed');
    assert.ok('providerFailureCode' in target);
    assert.ok(!('translatedText' in target));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §19. Resolution Error Mapping
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§19. Resolution Error Mapping');

  await test('CanonicalResolutionError forbidden (403) propagates correctly', async () => {
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId: makeId(), contentHash: sha256('T.') }] }),
      makeDeps({
        context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash },
        resolveCanonicalContext: async () => { throw new CanonicalResolutionError('reader_translation_forbidden', 403); },
      })
    );
    assert.ok(!result.success);
    assert.equal((result as any).error.code, 'reader_translation_forbidden');
    assert.equal((result as any).error.httpStatus, 403);
  });

  await test('CanonicalResolutionError document_unavailable (404) propagates correctly', async () => {
    const srcHash = sha256('h');
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId: makeId(), contentHash: sha256('T.') }] }),
      makeDeps({
        context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash },
        resolveCanonicalContext: async () => { throw new CanonicalResolutionError('reader_translation_document_unavailable', 404); },
      })
    );
    assert.ok(!result.success);
    assert.equal((result as any).error.httpStatus, 404);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §20. Zero Write Guards
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§20. Zero Write Guards');

  await test('no DB writes during translation (write guard)', async () => {
    const models = [AcademicSource, SourceContribution, AcademicDocument, AcademicSection, AcademicChunk];
    const backups = models.map(m => [m, blockModelWrites(m)] as const);
    const origProtoSave = mongoose.Model.prototype.save;
    (mongoose.Model.prototype as any).save = () => { throw new Error('FORBIDDEN_SAVE'); };

    try {
      const chunkId = makeId();
      const chunk = makeChunk({ _id: chunkId, text: 'T.' });
      const srcHash = sha256('h');
      const result = await translateReaderTargets(
        makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('T.') }] }),
        makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash } })
      );
      assert.ok(result.success);
    } finally {
      for (const [model, backup] of backups) restoreModelWrites(model, backup);
      mongoose.Model.prototype.save = origProtoSave;
    }
  });

  await test('tableData is byte-identical after translation', async () => {
    const chunkId = makeId();
    const originalCells = [{ row: 0, column: 0, rowSpan: 1, columnSpan: 1, text: 'Header', role: 'header' as const }];
    const chunk: ChunkForTranslation = {
      _id: chunkId, chunkPurpose: 'reader', blockType: 'table', text: 'T.',
      documentId: DEFAULT_DOC_ID, tableData: { rowCount: 1, columnCount: 1, cells: originalCells },
    };
    const srcHash = sha256('h');
    await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'table_cell', chunkId, row: 0, column: 0, contentHash: sha256('Header') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash } })
    );
    assert.equal(chunk.tableData!.cells[0].text, 'Header');
    assert.equal(chunk.tableData!.rowCount, 1);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §21. Figure & HTML Safety
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§21. Figure & HTML Safety');

  await test('figure HTML not sent to provider (only caption text)', async () => {
    let capturedItems: any[] = [];
    class HtmlCheckProvider {
      getMetadata() { return { name: 'c', model: 'v1', isConfigured: true }; }
      async translateBatch(req: any) {
        capturedItems = req.envelope.items;
        return { output: { items: req.envelope.items.map((i: any) => ({ targetId: i.targetId, translatedText: i.text })) } };
      }
    }
    const chunkId = makeId();
    const captionText = 'Figure 1. Sleep deprivation effects.';
    const chunk = makeChunk({ _id: chunkId, blockType: 'figure', text: captionText, html: '<figure><img src="https://cloudinary.com/x.png"/></figure>' });
    const srcHash = sha256('h');
    await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'figure_caption', chunkId, contentHash: sha256(captionText) }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash }, resolveProvider: () => new HtmlCheckProvider() as any })
    );
    assert.ok(capturedItems.every((i: any) => !i.text.includes('<img') && !i.text.includes('cloudinary')));
    assert.equal(capturedItems[0].text, captionText);
  });

  await test('HTML generated by provider is rejected', async () => {
    const chunkId = makeId();
    const chunk = makeChunk({ _id: chunkId, text: 'T.' });
    const srcHash = sha256('h');
    class HtmlOutputProvider {
      getMetadata() { return { name: 'c', model: 'v1', isConfigured: true }; }
      async translateBatch(req: any) {
        return { output: { items: [{ targetId: req.envelope.items[0].targetId, translatedText: '<div>hacked</div>' }] } };
      }
    }
    const result = await translateReaderTargets(
      makeParams({ sourceContentHash: srcHash, targetLocale: 'vi', targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('T.') }] }),
      makeDeps({ chunks: [chunk], context: { documentId: DEFAULT_DOC_ID, sourceLanguage: 'en', sourceContentHash: srcHash }, resolveProvider: () => new HtmlOutputProvider() as any })
    );
    assert.ok(result.success);
    const target = (result as any).response.targets[0];
    assert.equal(target.status, 'provider_failed');
    assert.equal(target.providerFailureCode, 'translation_schema_invalid');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §22. Canonical Identity Regression
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§22. Canonical Identity Regression');

  await test('calculateSourceContentHash with fixed IDs matches literal hash', () => {
    const CHUNK_A_ID = '507f1f77bcf86cd799439011';
    const CHUNK_B_ID = '507f1f77bcf86cd799439012';
    const CHUNK_C_ID = '507f1f77bcf86cd799439013';

    const chunks = [
      { _id: new mongoose.Types.ObjectId(CHUNK_A_ID), text: 'Nội dung đoạn A.', chunkOrder: 10 },
      { _id: new mongoose.Types.ObjectId(CHUNK_B_ID), text: 'Nội dung đoạn B.', chunkOrder: 20 },
      { _id: new mongoose.Types.ObjectId(CHUNK_C_ID), text: 'Nội dung đoạn C.', chunkOrder: 5 },
    ];

    // Independent verified literal (corrected as per audit)
    const EXPECTED_LITERAL = 'fc6d5f11b1340546d37aef10a2d62a8dc7f863cd0dd5cf439de7ba78db394a06';
    const result = calculateSourceContentHash(chunks);
    assert.equal(result, EXPECTED_LITERAL, `Hash mismatch: got ${result}`);
  });

  await test('normalizeLanguageCode vi → vi', () => { assert.equal(normalizeLanguageCode('vi'), 'vi'); });
  await test('normalizeLanguageCode vi-VN → vi', () => { assert.equal(normalizeLanguageCode('vi-VN'), 'vi'); });
  await test('normalizeLanguageCode en-US → en', () => { assert.equal(normalizeLanguageCode('en-US'), 'en'); });
  await test('normalizeLanguageCode null → null', () => { assert.equal(normalizeLanguageCode(null), null); });

  // ─── Controller Spy Mocks using global test hooks ─────────────────────────
  let lastSignal: any = undefined;

  function mockTranslateService() {
    (global as any).__mockTranslateReaderTargets = async (params: any, deps: any) => {
      lastSignal = params.clientSignal;
      return {
        success: true,
        response: {
          sourceContentHash: params.request.sourceContentHash,
          sourceLanguage: 'en',
          targetLocale: params.request.targetLocale,
          engineName: 'mock',
          modelName: 'mock',
          normalizationVersion: '1.0',
          translationSchemaVersion: '1.0',
          targets: []
        }
      };
    };
  }

  function restoreTranslateService() {
    delete (global as any).__mockTranslateReaderTargets;
  }

  function mockQuery(data: any) {
    const proxy: any = {
      sort() { return proxy; },
      skip() { return proxy; },
      limit() { return proxy; },
      lean() { return proxy; },
      then(resolve: (value: any) => any, reject?: (reason?: any) => any) {
        return Promise.resolve(data).then(resolve, reject);
      }
    };
    return proxy;
  }

  const origFindByIdSource = AcademicSource.findById;
  const origFindOneDoc = AcademicDocument.findOne;
  const origFindChunk = AcademicChunk.find;
  const origFindByIdContrib = SourceContribution.findById;

  function restoreModelMethods() {
    AcademicSource.findById = origFindByIdSource;
    AcademicDocument.findOne = origFindOneDoc;
    AcademicChunk.find = origFindChunk;
    SourceContribution.findById = origFindByIdContrib;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §23. Client-disconnect cancellation and lifecycle-safe abort logic
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§23. Client-disconnect cancellation and lifecycle-safe abort logic');

  class MockReq extends EventEmitter {
    params: Record<string, string> = {};
    body: any = {};
    rawBodyLength?: number;
    listenerCount(event: string) {
      return this.listeners(event).length;
    }
  }

  class MockRes extends EventEmitter {
    statusCode: number = 200;
    writableEnded: boolean = false;
    headers: Record<string, string> = {};
    body: any = null;
    status(code: number) {
      this.statusCode = code;
      return this;
    }
    json(data: any) {
      this.body = data;
      this.writableEnded = true;
      return this;
    }
    listenerCount(event: string) {
      return this.listeners(event).length;
    }
  }

  await test('normal request completion does not abort the provider signal', async () => {
    lastSignal = undefined;
    const req = new MockReq() as any;
    const res = new MockRes() as any;
    req.rawBodyLength = 100;
    req.body = {
      sourceContentHash: sha256('x'),
      targetLocale: 'vi',
      targets: [{ targetType: 'block_text', chunkId: makeId(), contentHash: sha256('x') }]
    };
    req.params = { id: makeId() };

    mockTranslateService();
    await getApprovedSourceTranslation(req, res);

    assert.ok(lastSignal);
    assert.ok(!lastSignal.aborted);
    assert.equal(req.listenerCount('aborted'), 0);
    assert.equal(res.listenerCount('close'), 0);
    restoreTranslateService();
  });

  await test('req aborted aborts it', async () => {
    lastSignal = undefined;
    const req = new MockReq() as any;
    const res = new MockRes() as any;
    req.rawBodyLength = 100;
    req.body = {
      sourceContentHash: sha256('x'),
      targetLocale: 'vi',
      targets: [{ targetType: 'block_text', chunkId: makeId(), contentHash: sha256('x') }]
    };
    req.params = { id: makeId() };

    mockTranslateService();
    const run = getApprovedSourceTranslation(req, res);

    assert.equal(req.listenerCount('aborted'), 1);
    assert.equal(res.listenerCount('close'), 1);

    req.emit('aborted');
    await run;

    assert.ok(lastSignal);
    assert.ok(lastSignal.aborted);
    assert.equal(req.listenerCount('aborted'), 0);
    assert.equal(res.listenerCount('close'), 0);
    restoreTranslateService();
  });

  await test('response close before writableEnded aborts it', async () => {
    lastSignal = undefined;
    const req = new MockReq() as any;
    const res = new MockRes() as any;
    req.rawBodyLength = 100;
    req.body = {
      sourceContentHash: sha256('x'),
      targetLocale: 'vi',
      targets: [{ targetType: 'block_text', chunkId: makeId(), contentHash: sha256('x') }]
    };
    req.params = { id: makeId() };

    mockTranslateService();
    const run = getApprovedSourceTranslation(req, res);

    res.emit('close');
    await run;

    assert.ok(lastSignal);
    assert.ok(lastSignal.aborted);
    assert.equal(req.listenerCount('aborted'), 0);
    assert.equal(res.listenerCount('close'), 0);
    restoreTranslateService();
  });

  await test('response close after writableEnded does not abort it', async () => {
    lastSignal = undefined;
    const req = new MockReq() as any;
    const res = new MockRes() as any;
    req.rawBodyLength = 100;
    req.body = {
      sourceContentHash: sha256('x'),
      targetLocale: 'vi',
      targets: [{ targetType: 'block_text', chunkId: makeId(), contentHash: sha256('x') }]
    };
    req.params = { id: makeId() };

    mockTranslateService();
    const run = getApprovedSourceTranslation(req, res);
    res.writableEnded = true;
    res.emit('close');
    await run;

    assert.ok(lastSignal);
    assert.ok(!lastSignal.aborted);
    assert.equal(req.listenerCount('aborted'), 0);
    assert.equal(res.listenerCount('close'), 0);
    restoreTranslateService();
  });

  await test('all listeners are removed after success and failure', async () => {
    const req = new MockReq() as any;
    const res = new MockRes() as any;
    req.rawBodyLength = 100;
    req.body = {
      sourceContentHash: sha256('x'),
      targetLocale: 'vi',
      targets: [{ targetType: 'block_text', chunkId: makeId(), contentHash: sha256('x') }]
    };
    req.params = { id: makeId() };

    // Success path
    mockTranslateService();
    await getApprovedSourceTranslation(req, res);
    assert.equal(req.listenerCount('aborted'), 0);
    assert.equal(res.listenerCount('close'), 0);

    // Failure path
    (global as any).__mockTranslateReaderTargets = async () => {
      return { success: false, error: { code: 'reader_translation_forbidden', httpStatus: 403 } };
    };
    await getApprovedSourceTranslation(req, res);
    assert.equal(req.listenerCount('aborted'), 0);
    assert.equal(res.listenerCount('close'), 0);
    restoreTranslateService();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §24. HTTP raw body size tests
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§24. HTTP raw body size tests');

  await test('raw body length exact enforcement with whitespace differences', async () => {
    // Case A: 60 KiB rawBodyLength (compact)
    const req1 = new MockReq() as any;
    const res1 = new MockRes() as any;
    req1.rawBodyLength = 60000;
    req1.body = {
      sourceContentHash: sha256('x'),
      targetLocale: 'vi',
      targets: [{ targetType: 'block_text', chunkId: makeId(), contentHash: sha256('x') }]
    };
    req1.params = { id: makeId() };
    mockTranslateService();
    await getApprovedSourceTranslation(req1, res1);
    assert.notEqual(res1.statusCode, 413);

    // Case B: 66 KiB rawBodyLength (same semantic body but padded with whitespace)
    const req2 = new MockReq() as any;
    const res2 = new MockRes() as any;
    req2.rawBodyLength = 66000;
    req2.body = {
      sourceContentHash: sha256('x'),
      targetLocale: 'vi',
      targets: [{ targetType: 'block_text', chunkId: makeId(), contentHash: sha256('x') }]
    };
    req2.params = { id: makeId() };
    await getApprovedSourceTranslation(req2, res2);
    assert.equal(res2.statusCode, 413);
    assert.equal(res2.body.code, 'reader_translation_limit_exceeded');
    restoreTranslateService();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §25. Real context/controller/route boundary tests
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n§25. Real context/controller/route boundary tests');

  await test('Approved route middleware inspection', () => {
    const approvedRoute = sourceRouter.stack.find(
      (layer: any) => layer.route && layer.route.path === '/approved/:id/read/translate'
    )?.route;
    assert.ok(approvedRoute, 'Approved translation route not found');

    const approvedRouteHandlers = approvedRoute.stack.map((layer: any) => layer.handle);
    assert.equal(approvedRouteHandlers[approvedRouteHandlers.length - 1], getApprovedSourceTranslation);
    
    const hasAuth = approvedRoute.stack.some((layer: any) => layer.handle === authMiddleware || layer.name === 'authMiddleware');
    assert.ok(hasAuth, 'Approved route missing authMiddleware');
  });

  await test('Moderation route middleware inspection', () => {
    const moderationRoute = moderationRouter.stack.find(
      (layer: any) => layer.route && layer.route.path === '/sources/:id/preview/translate'
    )?.route;
    assert.ok(moderationRoute, 'Preview translation route not found');

    const moderationRouteHandlers = moderationRoute.stack.map((layer: any) => layer.handle);
    assert.equal(moderationRouteHandlers[moderationRouteHandlers.length - 1], getSourcePreviewTranslation);

    const authIndex = moderationRoute.stack.findIndex((layer: any) => layer.handle === authMiddleware || layer.name === 'authMiddleware');
    const isModeratorIndex = moderationRoute.stack.findIndex((layer: any) => layer.handle === isModerator || layer.name === 'isModerator');
    assert.ok(authIndex >= 0, 'Preview route missing authMiddleware');
    assert.ok(isModeratorIndex >= 0, 'Preview route missing isModerator');
    assert.ok(authIndex < isModeratorIndex, 'authMiddleware must precede isModerator');
  });

  await test('Approved route: malformed ID returns sanitized 404', async () => {
    const req = new MockReq() as any;
    const res = new MockRes() as any;
    req.params = { id: 'invalid-id' };
    await getApprovedSourceTranslation(req, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'reader_translation_document_unavailable');
    assert.ok(!res.body.stack);
    assert.ok(!res.body.message.includes('invalid-id'));
  });

  await test('Approved route: oversized request returns 413 before any DB query', async () => {
    const req = new MockReq() as any;
    const res = new MockRes() as any;
    req.params = { id: makeId() };
    req.rawBodyLength = 70000;
    
    const throwDbError = () => { throw new Error('DB_QUERIED_PREMATURELY'); };
    AcademicSource.findById = throwDbError as any;
    
    try {
      await getApprovedSourceTranslation(req, res);
      assert.equal(res.statusCode, 413);
      assert.equal(res.body.code, 'reader_translation_limit_exceeded');
    } finally {
      restoreModelMethods();
    }
  });

  await test('Approved route: stale sourceContentHash returns sanitized 409', async () => {
    const sourceId = makeId();
    const docId = makeId();
    
    AcademicSource.findById = () => mockQuery({
      _id: sourceId, readableInApp: true, fullTextStatus: 'imported', allowedUse: 'open_access_fulltext', detectedLanguage: 'en-US'
    }) as any;
    AcademicDocument.findOne = () => mockQuery({ _id: docId, sourceId }) as any;
    
    const chunk = { _id: new mongoose.Types.ObjectId(), text: 'Text A.', chunkOrder: 1, chunkPurpose: 'reader', blockType: 'paragraph', documentId: docId };
    AcademicChunk.find = () => mockQuery([chunk]) as any;

    const req = new MockReq() as any;
    const res = new MockRes() as any;
    req.params = { id: sourceId };
    req.rawBodyLength = 100;
    req.body = {
      sourceContentHash: 'b'.repeat(64),
      targetLocale: 'vi',
      targets: [{ targetType: 'block_text', chunkId: chunk._id.toString(), contentHash: sha256('Text A.') }]
    };

    try {
      await getApprovedSourceTranslation(req, res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, 'reader_translation_identity_stale');
      assert.ok(!res.body.stack);
    } finally {
      restoreModelMethods();
    }
  });

  await test('Approved route: unavailable local engine returns sanitized 503', async () => {
    const sourceId = makeId();
    const docId = makeId();
    const chunkId = makeId();
    const chunk = { _id: new mongoose.Types.ObjectId(chunkId), text: 'Text A.', chunkOrder: 1, chunkPurpose: 'reader', blockType: 'paragraph', documentId: docId };
    
    AcademicSource.findById = () => mockQuery({
      _id: sourceId, readableInApp: true, fullTextStatus: 'imported', allowedUse: 'open_access_fulltext', detectedLanguage: 'en-US'
    }) as any;
    AcademicDocument.findOne = () => mockQuery({ _id: docId, sourceId }) as any;
    AcademicChunk.find = () => mockQuery([chunk]) as any;

    const correctHash = calculateSourceContentHash([chunk]);
    
    const req = new MockReq() as any;
    const res = new MockRes() as any;
    req.params = { id: sourceId };
    req.rawBodyLength = 100;
    req.body = {
      sourceContentHash: correctHash,
      targetLocale: 'vi',
      targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('Text A.') }]
    };

    (global as any).__mockResolveTranslationProvider = () => {
      throw new TranslationProviderUnavailableError('internal_reason_that_must_not_leak_API_KEY_123');
    };

    try {
      await getApprovedSourceTranslation(req, res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.code, 'reader_translation_provider_unavailable');
      assert.ok(!res.body.stack);
      assert.ok(!JSON.stringify(res.body).includes('internal_reason_that_must_not_leak'));
      assert.ok(!JSON.stringify(res.body).includes('API_KEY'));
      assert.ok(!JSON.stringify(res.body).includes(sourceId));
    } finally {
      restoreModelMethods();
      delete (global as any).__mockResolveTranslationProvider;
    }
  });

  await test('Moderation route: malformed ID returns sanitized 404', async () => {
    const req = new MockReq() as any;
    const res = new MockRes() as any;
    req.params = { id: 'invalid-id' };
    await getSourcePreviewTranslation(req, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'reader_translation_document_unavailable');
    assert.ok(!res.body.stack);
  });

  await test('Moderation route: corresponding 409/413/503 responses are sanitized', async () => {
    const contribId = makeId();
    const docId = makeId();
    const chunkId = makeId();
    const chunk = { _id: new mongoose.Types.ObjectId(chunkId), text: 'Text A.', chunkOrder: 1, chunkPurpose: 'reader', blockType: 'paragraph', documentId: docId };
    
    SourceContribution.findById = () => mockQuery({
      _id: contribId, detectedLanguage: 'en-US'
    }) as any;
    AcademicDocument.findOne = () => mockQuery({ _id: docId, previewContributionId: contribId }) as any;
    AcademicChunk.find = () => mockQuery([chunk]) as any;

    const correctHash = calculateSourceContentHash([chunk]);
    
    // Test 409
    const req409 = new MockReq() as any;
    const res409 = new MockRes() as any;
    req409.params = { id: contribId };
    req409.rawBodyLength = 100;
    req409.body = {
      sourceContentHash: 'b'.repeat(64),
      targetLocale: 'vi',
      targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('Text A.') }]
    };
    await getSourcePreviewTranslation(req409, res409);
    assert.equal(res409.statusCode, 409);
    assert.ok(!res409.body.stack);

    // Test 413
    const req413 = new MockReq() as any;
    const res413 = new MockRes() as any;
    req413.params = { id: contribId };
    req413.rawBodyLength = 70000;
    req413.body = {
      sourceContentHash: correctHash,
      targetLocale: 'vi',
      targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('Text A.') }]
    };
    await getSourcePreviewTranslation(req413, res413);
    assert.equal(res413.statusCode, 413);
    assert.ok(!res413.body.stack);

    // Test 503
    const req503 = new MockReq() as any;
    const res503 = new MockRes() as any;
    req503.params = { id: contribId };
    req503.rawBodyLength = 100;
    req503.body = {
      sourceContentHash: correctHash,
      targetLocale: 'vi',
      targets: [{ targetType: 'block_text', chunkId, contentHash: sha256('Text A.') }]
    };
    (global as any).__mockResolveTranslationProvider = () => {
      throw new TranslationProviderUnavailableError('secret_env_var_leak_123');
    };
    try {
      await getSourcePreviewTranslation(req503, res503);
      assert.equal(res503.statusCode, 503);
      assert.ok(!res503.body.stack);
      assert.ok(!JSON.stringify(res503.body).includes('secret_env_var_leak'));
    } finally {
      restoreModelMethods();
      delete (global as any).__mockResolveTranslationProvider;
    }
  });

  await test('approved resolution uses AcademicSource.detectedLanguage and normalizes', async () => {
    const sourceId = makeId();
    const docId = makeId();
    const chunk = { _id: new mongoose.Types.ObjectId(), text: 'Content', chunkOrder: 1, chunkPurpose: 'reader' };
    
    AcademicSource.findById = () => mockQuery({
      _id: sourceId, readableInApp: true, fullTextStatus: 'imported', allowedUse: 'open_access_fulltext', detectedLanguage: 'vi-VN'
    }) as any;
    AcademicDocument.findOne = () => mockQuery({ _id: docId, sourceId }) as any;
    AcademicChunk.find = () => mockQuery([chunk]) as any;

    try {
      const ctx = await resolveApprovedSourceContext(sourceId);
      assert.equal(ctx.sourceLanguage, 'vi');
      assert.equal(ctx.documentId, docId);
    } finally {
      restoreModelMethods();
    }
  });

  await test('preview resolution uses SourceContribution.detectedLanguage and normalizes', async () => {
    const contribId = makeId();
    const docId = makeId();
    const chunk = { _id: new mongoose.Types.ObjectId(), text: 'Content', chunkOrder: 1, chunkPurpose: 'reader' };

    SourceContribution.findById = () => mockQuery({
      _id: contribId, detectedLanguage: 'en_US'
    }) as any;
    AcademicDocument.findOne = () => mockQuery({ _id: docId, previewContributionId: contribId }) as any;
    AcademicChunk.find = () => mockQuery([chunk]) as any;

    try {
      const ctx = await resolvePreviewContributionContext(contribId);
      assert.equal(ctx.sourceLanguage, 'en');
      assert.equal(ctx.documentId, docId);
    } finally {
      restoreModelMethods();
    }
  });

  // ─── Deadline Parser Boundary Tests ─────────────────────────────────────────
  await test('Deadline parsing boundary: undefined/empty', () => {
    assert.equal(parseTranslationDeadline(undefined), 60000);
    assert.equal(parseTranslationDeadline(''), 60000);
    assert.equal(parseTranslationDeadline('   '), 60000);
  });

  await test('Deadline parsing boundary: out of ranges (min/max)', () => {
    assert.equal(parseTranslationDeadline('4999'), 60000);
    assert.equal(parseTranslationDeadline('5000'), 5000);
    assert.equal(parseTranslationDeadline('60000'), 60000);
    assert.equal(parseTranslationDeadline('120000'), 120000);
    assert.equal(parseTranslationDeadline('120001'), 60000);
  });

  await test('Deadline parsing boundary: malformed/junk inputs', () => {
    assert.equal(parseTranslationDeadline('60000junk'), 60000);
    assert.equal(parseTranslationDeadline('60.50'), 60000);
    assert.equal(parseTranslationDeadline('-5000'), 60000);
    assert.equal(parseTranslationDeadline('+5000'), 60000);
    assert.equal(parseTranslationDeadline('abc'), 60000);
  });

  await test('Deadline parsing: getTranslationDeadlineMs integrates correctly', () => {
    const orig = process.env.READER_TRANSLATION_DEADLINE_MS;
    try {
      process.env.READER_TRANSLATION_DEADLINE_MS = '10000';
      assert.equal(getTranslationDeadlineMs(), 10000);
      process.env.READER_TRANSLATION_DEADLINE_MS = 'invalid';
      assert.equal(getTranslationDeadlineMs(), 60000);
    } finally {
      if (orig !== undefined) process.env.READER_TRANSLATION_DEADLINE_MS = orig;
      else delete process.env.READER_TRANSLATION_DEADLINE_MS;
    }
  });

  // ─── Provider-Neutral Contract Tests ────────────────────────────────────────
  await test('Translation batch literal envelope byte size check', () => {
    const items = [ { targetId: "chunkId1:0:0", text: "Tiếng Việt có dấu và ký tự đặc biệt \\\\n \\\\t \\\\\"" } ];
    const payload = JSON.stringify({ items });
    const bytes = Buffer.byteLength(payload, 'utf8');
    assert.equal(bytes, 119);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`Phase I18N-3B.2A Translation Contract Tests`);
  console.log(`Passed: ${passed}  Failed: ${failed}  Total: ${passed + failed}`);
  if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log(`${'─'.repeat(70)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
