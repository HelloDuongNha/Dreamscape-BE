/**
 * canonicalReaderIdentity.test.ts
 * Phase I18N-3B.1.3 — Global Canonical Hash Validation Cleanup
 *
 * Standalone contract test suite. Run with:
 *   npx tsx src/services/academic/reader/canonicalReaderIdentity.test.ts
 */
import assert from 'node:assert';
import mongoose from 'mongoose';
import crypto from 'node:crypto';

// ── Model imports (for spy/block) ─────────────────────────────────────────────
import AcademicSource from '../../../models/AcademicSource';
import SourceContribution from '../../../models/SourceContribution';
import AcademicDocument from '../../../models/AcademicDocument';
import AcademicSection from '../../../models/AcademicSection';
import AcademicChunk from '../../../models/AcademicChunk';
import KnowledgeRuleV3 from '../../../models/rulesV3/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../../models/rulesV3/KnowledgeRuleEvidence';

// ── Service helpers ───────────────────────────────────────────────────────────
import {
  calculateCanonicalChunkContentHash,
  calculateSourceContentHash,
  normalizeLanguageCode,
  deriveDocumentIdFromChunks,
  mapChunkToBlock,
  CanonicalBlockIdentityError
} from './canonicalReaderIdentity.service';

// ── Controller endpoints under test ──────────────────────────────────────────
import { getApprovedSourceRead } from '../../../controllers/sourceController';
import { getSourcePreview } from '../../../controllers/moderationController';

// ── Write method names that must never be called by reader endpoints ──────────
const WRITE_METHODS = [
  'create', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate',
  'replaceOne', 'bulkWrite', 'deleteOne', 'deleteMany',
  'findOneAndDelete', 'findByIdAndUpdate', 'findByIdAndDelete'
] as const;

type WriteMethods = typeof WRITE_METHODS[number];

// ── Per-model backup map strategy ─────────────────────────────────────────────
function createModelWriteBackup(model: any): Map<WriteMethods, any> {
  const backup = new Map<WriteMethods, any>();
  for (const m of WRITE_METHODS) {
    backup.set(m, model[m]);
  }
  return backup;
}

function blockModelWrites(model: any): void {
  const throwWrite = () => { throw new Error('DATABASE_WRITE_FORBIDDEN_IN_READER'); };
  for (const m of WRITE_METHODS) {
    model[m] = throwWrite;
  }
}

function restoreModelWriteBackup(model: any, backup: Map<WriteMethods, any>): void {
  for (const [method, original] of backup) {
    model[method] = original;
  }
}

// ── Chainable query mock factory ──────────────────────────────────────────────
// Implements real skip/limit semantics on the provided data array so pagination
// is actually exercised, not silently bypassed.
function createMockQuery(dataFactory: () => any[], sortKey?: string) {
  let _skip = 0;
  let _limit: number | null = null;

  const proxy: any = {
    sort(_: any) { return proxy; },
    skip(n: number) { _skip = n; return proxy; },
    limit(n: number) { _limit = n; return proxy; },
    lean() { return proxy; },
    then(resolve: (value: any) => any, reject?: (reason?: any) => any) {
      return Promise.resolve().then(() => {
        let data = dataFactory();
        if (sortKey) {
          data = [...data].sort((a, b) => a[sortKey] - b[sortKey]);
        }
        data = data.slice(_skip);
        if (_limit !== null) data = data.slice(0, _limit);
        return data;
      }).then(resolve, reject);
    }
  };
  return proxy;
}

// Simple one-shot mock (no pagination)
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

// ── Test harness ──────────────────────────────────────────────────────────────
async function runTests() {
  console.log('=== CANONICAL SMART READER IDENTITY CONTRACT TESTS — I18N-3B.1.3 ===\n');

  let behavioralAssertions = 0;
  let restorationAssertions = 0;

  const assertTest = (msg: string, cond: boolean) => {
    behavioralAssertions++;
    assert.ok(cond, msg);
    console.log(`  [PASS] ${msg}`);
  };

  const assertRestoration = (msg: string, cond: boolean) => {
    restorationAssertions++;
    assert.ok(cond, msg);
    console.log(`  [PASS] ${msg}`);
  };

  // ── Per-model write backups (exact, non-cross-pollinating) ─────────────────
  const backups: Array<[any, Map<WriteMethods, any>]> = [
    [AcademicSource,          createModelWriteBackup(AcademicSource)],
    [SourceContribution,      createModelWriteBackup(SourceContribution)],
    [AcademicDocument,        createModelWriteBackup(AcademicDocument)],
    [AcademicSection,         createModelWriteBackup(AcademicSection)],
    [AcademicChunk,           createModelWriteBackup(AcademicChunk)],
    [KnowledgeRuleV3,         createModelWriteBackup(KnowledgeRuleV3)],
    [KnowledgeRuleEvidenceV3, createModelWriteBackup(KnowledgeRuleEvidenceV3)],
  ];
  const originalProtoSave = mongoose.Model.prototype.save;

  let restoreCallCount = 0;
  const restoreAll = () => {
    restoreCallCount++;
    for (const [model, backup] of backups) {
      restoreModelWriteBackup(model, backup);
    }
    mongoose.Model.prototype.save = originalProtoSave;
  };

  try {
    // ════════════════════════════════════════════════════════════════════════
    // §1. normalizeLanguageCode — accepted forms
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n§1. normalizeLanguageCode — accepted forms');
    assertTest('vi -> vi', normalizeLanguageCode('vi') === 'vi');
    assertTest('vi-VN -> vi', normalizeLanguageCode('vi-VN') === 'vi');
    assertTest('vi_VN -> vi', normalizeLanguageCode('vi_VN') === 'vi');
    assertTest('en -> en', normalizeLanguageCode('en') === 'en');
    assertTest('en-US -> en', normalizeLanguageCode('en-US') === 'en');
    assertTest('en_GB -> en', normalizeLanguageCode('en_GB') === 'en');
    assertTest('  EN-US  (with whitespace) -> en', normalizeLanguageCode('  EN-US  ') === 'en');
    assertTest('VI-VN (uppercase) -> vi', normalizeLanguageCode('VI-VN') === 'vi');

    // ────────────────────────────────────────────────────────────────────────
    // §1b. normalizeLanguageCode — malformed & rejected forms
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n§1b. normalizeLanguageCode — rejected / malformed forms');
    assertTest('unknown -> null', normalizeLanguageCode('unknown') === null);
    assertTest('und -> null', normalizeLanguageCode('und') === null);
    assertTest('"" -> null', normalizeLanguageCode('') === null);
    assertTest('null -> null', normalizeLanguageCode(null) === null);
    assertTest('undefined -> null', normalizeLanguageCode(undefined) === null);
    assertTest('fr (unsupported) -> null', normalizeLanguageCode('fr') === null);
    assertTest('zh-CN -> null', normalizeLanguageCode('zh-CN') === null);
    assertTest('vi-??? -> null', normalizeLanguageCode('vi-???') === null);
    assertTest('en-123 -> null', normalizeLanguageCode('en-123') === null);
    assertTest('vi-extra-long -> null', normalizeLanguageCode('vi-extra-long') === null);
    assertTest('vi--VN (double dash) -> null', normalizeLanguageCode('vi--VN') === null);
    assertTest('arbitrary prose -> null', normalizeLanguageCode('some language name') === null);

    // ════════════════════════════════════════════════════════════════════════
    // §2. Hash formula and determinism
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n§2. Hash formula and determinism');
    const id1 = new mongoose.Types.ObjectId('65a100000000000000000001');
    const id2 = new mongoose.Types.ObjectId('65a100000000000000000002');
    const id3 = new mongoose.Types.ObjectId('65a100000000000000000003');

    const chunk1 = { _id: id1, text: 'Bản đọc mẫu Tiếng Việt.', chunkOrder: 10 };
    const chunk2 = { _id: id2, text: 'Sample text English with \n newlines.', chunkOrder: 20 };
    const chunk3 = { _id: id3, text: '  Leading and trailing whitespace  ', chunkOrder: 30 };

    const directHash1 = crypto.createHash('sha256').update(chunk1.text, 'utf8').digest('hex');
    assertTest(
      `calculateCanonicalChunkContentHash == sha256("${chunk1.text}")`,
      calculateCanonicalChunkContentHash(chunk1.text) === directHash1
    );

    const EXPECTED_3_CHUNK_LITERAL_HASH = '39ac124971e93b2d4ca2b9acede2255a1c00631561d53cc668d93357af7e8e31';

    const sortedChunks = [chunk1, chunk2, chunk3];
    const canonicalJoin = sortedChunks.map(c => `${c._id}:${c.text}`).join('\n');
    const cryptoHash = crypto.createHash('sha256').update(canonicalJoin, 'utf8').digest('hex');

    const originalInputArray = [chunk3, chunk1, chunk2];
    const originalInputSnapshot = [...originalInputArray];
    const actualSourceHash = calculateSourceContentHash(originalInputArray);

    // Check 1: calculateSourceContentHash(fixture) equals exact literal value
    assertTest(
      'calculateSourceContentHash equals literal SHA-256 string',
      calculateSourceContentHash(sortedChunks) === EXPECTED_3_CHUNK_LITERAL_HASH
    );

    // Check 2: independently constructed canonical join hashed with node:crypto equals exact literal value
    assertTest(
      'independently constructed canonical join hashed with node:crypto equals literal SHA-256 string',
      cryptoHash === EXPECTED_3_CHUNK_LITERAL_HASH
    );

    // Check 3: out-of-order input still equals exact literal value
    assertTest(
      'calculateSourceContentHash out-of-order input equals literal SHA-256 string',
      actualSourceHash === EXPECTED_3_CHUNK_LITERAL_HASH
    );

    assertTest(
      'input array is not mutated by defensive sorting',
      originalInputArray[0] === originalInputSnapshot[0] &&
      originalInputArray[1] === originalInputSnapshot[1] &&
      originalInputArray[2] === originalInputSnapshot[2]
    );

    console.log(`    [HASH INFO] Fixture text: "${chunk1.text}"`);
    console.log(`    [HASH INFO] chunk1 contentHash (actual):     ${calculateCanonicalChunkContentHash(chunk1.text)}`);
    console.log(`    [HASH INFO] sourceContentHash (3 chunks, literal): ${EXPECTED_3_CHUNK_LITERAL_HASH}`);

    // Text change must change hash
    const chunk1Mod = { ...chunk1, text: 'Bản đọc mẫu Tiếng Việt đã sửa.' };
    assertTest('Changing chunk text changes contentHash', calculateCanonicalChunkContentHash(chunk1.text) !== calculateCanonicalChunkContentHash(chunk1Mod.text));
    assertTest('Changing chunk text changes sourceContentHash', actualSourceHash !== calculateSourceContentHash([chunk1Mod, chunk2, chunk3]));

    // HTML field must not participate in hash
    const chunk1WithHtml = { ...chunk1, html: '<p>Bản đọc mẫu.</p>' };
    assertTest('HTML field excluded from sourceContentHash', actualSourceHash === calculateSourceContentHash([chunk1WithHtml, chunk2, chunk3]));

    // Whitespace is NOT trimmed (canonical contract)
    const hashWithSpaces = calculateCanonicalChunkContentHash('  leading  ');
    const hashNoSpaces   = calculateCanonicalChunkContentHash('leading');
    assertTest('Canonical text whitespace is NOT normalized', hashWithSpaces !== hashNoSpaces);

    // Empty array behavior preserved
    const emptyHash = calculateSourceContentHash([]);
    const expectedEmptyHash = crypto.createHash('sha256').update('', 'utf8').digest('hex');
    assertTest('Empty chunk array produces sha256("") for Rule V3 compatibility', emptyHash === expectedEmptyHash);

    // ────────────────────────────────────────────────────────────────────────
    // §2b. calculateSourceContentHash — invalid inputs validation
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n  §2b. calculateSourceContentHash — invalid inputs');
    const validChunkFixture = { _id: new mongoose.Types.ObjectId(), text: 'Valid text', chunkOrder: 1 };

    function expectHashError(label: string, badChunks: any[]) {
      let caught: any = null;
      try { calculateSourceContentHash(badChunks); } catch (e) { caught = e; }
      assertTest(`calculateSourceContentHash ${label} -> throws CanonicalBlockIdentityError`, caught instanceof CanonicalBlockIdentityError);
      assertTest(`calculateSourceContentHash ${label} -> code is reader_block_identity_invalid`, (caught as any)?.code === 'reader_block_identity_invalid');
    }

    expectHashError('missing _id (null)', [{ ...validChunkFixture, _id: null }]);
    expectHashError('missing _id (undefined)', [{ ...validChunkFixture, _id: undefined }]);
    expectHashError('empty _id string', [{ ...validChunkFixture, _id: '' }]);
    expectHashError('numeric text (42)', [{ ...validChunkFixture, text: 42 }]);
    expectHashError('null text', [{ ...validChunkFixture, text: null }]);
    expectHashError('NaN chunkOrder', [{ ...validChunkFixture, chunkOrder: NaN }]);
    expectHashError('Infinity chunkOrder', [{ ...validChunkFixture, chunkOrder: Infinity }]);

    // ════════════════════════════════════════════════════════════════════════
    // §3. deriveDocumentIdFromChunks
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n§3. deriveDocumentIdFromChunks');
    const docId = new mongoose.Types.ObjectId();
    assertTest(
      'all chunks same documentId -> returns it',
      deriveDocumentIdFromChunks([{ documentId: docId }, { documentId: docId }]) === docId.toString()
    );

    // Empty input
    let threw: string | null = null;
    try { deriveDocumentIdFromChunks([]); } catch (e: any) { threw = e.message; }
    assertTest('empty input -> DOCUMENT_ID_UNAVAILABLE', threw === 'DOCUMENT_ID_UNAVAILABLE');

    // Two distinct IDs -> AMBIGUOUS
    threw = null;
    try {
      deriveDocumentIdFromChunks([{ documentId: docId }, { documentId: new mongoose.Types.ObjectId() }]);
    } catch (e: any) { threw = e.message; }
    assertTest('two distinct IDs -> AMBIGUOUS_DOCUMENT_ID', threw === 'AMBIGUOUS_DOCUMENT_ID');

    // Missing documentId
    threw = null;
    try {
      deriveDocumentIdFromChunks([{ documentId: docId }, { documentId: null }]);
    } catch (e: any) { threw = e.message; }
    assertTest('one valid + one null documentId -> DOCUMENT_ID_UNAVAILABLE', threw === 'DOCUMENT_ID_UNAVAILABLE');

    threw = null;
    try {
      deriveDocumentIdFromChunks([{ documentId: undefined }]);
    } catch (e: any) { threw = e.message; }
    assertTest('all chunks missing documentId -> DOCUMENT_ID_UNAVAILABLE', threw === 'DOCUMENT_ID_UNAVAILABLE');

    // ════════════════════════════════════════════════════════════════════════
    // §4. mapChunkToBlock — valid chunk
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n§4. mapChunkToBlock — valid chunk');
    const secId = new mongoose.Types.ObjectId();
    const validChunk = {
      _id: new mongoose.Types.ObjectId(),
      sectionId: secId,
      chunkOrder: 4,
      text: 'No section text.',
      blockType: 'heading'
    };
    const emptyMap = new Map<string, any>();
    const mapped = mapChunkToBlock(validChunk, emptyMap, 0, 0);
    assertTest('blockIdentity.chunkId == chunk._id', mapped.blockIdentity.chunkId === validChunk._id.toString());
    assertTest('blockIdentity.sectionId == chunk.sectionId', mapped.blockIdentity.sectionId === secId.toString());
    assertTest('blockIdentity.chunkIndex == chunkOrder (not idx)', mapped.blockIdentity.chunkIndex === 4);
    assertTest('sectionIdentity.sectionId == chunk.sectionId (missing metadata allowed)', mapped.sectionIdentity?.sectionId === secId.toString());
    assertTest('sectionIdentity.sectionOrder is null for missing section', mapped.sectionIdentity?.sectionOrder === null);
    assertTest('sectionIdentity.heading is null for missing section', mapped.sectionIdentity?.heading === null);
    assertTest('sectionIdentity.sectionType is null for missing section', mapped.sectionIdentity?.sectionType === null);

    // ════════════════════════════════════════════════════════════════════════
    // §5. mapChunkToBlock — negative / invalid identity cases
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n§5. mapChunkToBlock — negative / invalid identity (must throw CanonicalBlockIdentityError)');

    const valid = { _id: new mongoose.Types.ObjectId(), sectionId: secId, chunkOrder: 1, text: 'ok', blockType: 'paragraph' };

    function expectBlockError(label: string, badChunk: any) {
      let caught: any = null;
      try { mapChunkToBlock(badChunk, emptyMap, 0, 0); } catch (e) { caught = e; }
      assertTest(`${label} -> throws CanonicalBlockIdentityError`, caught instanceof CanonicalBlockIdentityError);
      assertTest(`${label} -> error code is reader_block_identity_invalid`, (caught as any)?.code === 'reader_block_identity_invalid');
    }

    expectBlockError('missing chunk._id', { ...valid, _id: null });
    expectBlockError('empty chunk._id string', { ...valid, _id: '' });
    expectBlockError('missing chunk.sectionId', { ...valid, sectionId: null });
    expectBlockError('empty chunk.sectionId string', { ...valid, sectionId: '' });
    expectBlockError('non-finite chunkOrder (NaN)', { ...valid, chunkOrder: NaN });
    expectBlockError('non-finite chunkOrder (Infinity)', { ...valid, chunkOrder: Infinity });
    expectBlockError('non-string text (number)', { ...valid, text: 42 });
    expectBlockError('non-string text (null)', { ...valid, text: null });

    // ════════════════════════════════════════════════════════════════════════
    // §6. Controller integration (zero-write guard active)
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n§6. Controller integration (zero-write guard active)');
    for (const [model] of backups) {
      blockModelWrites(model);
    }
    mongoose.Model.prototype.save = (() => { throw new Error('DATABASE_WRITE_FORBIDDEN_IN_READER'); }) as any;

    const mockSourceId  = new mongoose.Types.ObjectId('65a200000000000000000001');
    const mockContribId = new mongoose.Types.ObjectId('65a200000000000000000002');
    const mockDocId     = new mongoose.Types.ObjectId('65a200000000000000000003');
    const mockSecId     = new mongoose.Types.ObjectId('65a200000000000000000004');
    const chunk1Id      = new mongoose.Types.ObjectId('65a200000000000000000005');
    const chunk2Id      = new mongoose.Types.ObjectId('65a200000000000000000006');

    const mockSource = {
      _id: mockSourceId, title: 'Khảo sát Giấc mơ Việt', authors: ['Nguyễn Văn A'],
      year: 2026, journal: 'Tạp chí Tâm lý học', doi: '10.5678/dream.vn', license: 'CC-BY',
      readableInApp: true, fullTextStatus: 'imported', allowedUse: 'open_access_fulltext',
      detectedLanguage: 'vi-VN', originalFile: { fileHash: 'bin_hash_123' }
    };
    const mockContrib = {
      _id: mockContribId, title: 'Khảo sát Giấc mơ Việt (Contribution)',
      authors: ['Nguyễn Văn A'], year: 2026, journal: 'Tạp chí Tâm lý học',
      doi: '10.5678/dream.vn', allowedUse: 'open_access_fulltext',
      detectedLanguage: 'vi-VN', reviewStatus: 'approved',
      originalFile: { fileHash: 'bin_hash_123' }
    };
    const mockDoc = {
      _id: mockDocId, sourceId: mockSourceId, previewContributionId: mockContribId,
      parserEngine: 'docling', parserVersion: 1,
      updatedAt: new Date('2026-01-01T00:00:00Z'), createdAt: new Date('2026-01-01T00:00:00Z')
    };
    const mockSec = {
      _id: mockSecId, documentId: mockDocId,
      heading: '1. Mở đầu', sectionType: 'introduction', sectionOrder: 1
    };
    const chunkA = {
      _id: chunk1Id, documentId: mockDocId, sectionId: mockSecId,
      chunkPurpose: 'reader', chunkOrder: 10, text: 'Nội dung đoạn A.', blockType: 'paragraph'
    };
    const chunkB = {
      _id: chunk2Id, documentId: mockDocId, sectionId: mockSecId,
      chunkPurpose: 'reader', chunkOrder: 20, text: 'Nội dung đoạn B.', blockType: 'paragraph'
    };
    const allChunks = [chunkA, chunkB];

    const EXPECTED_2_CHUNK_LITERAL_HASH = '5461f3a43217972748f6a57814d16e68650415420acf140ce8276651396a9da8';

    const actual2ChunkHash = calculateSourceContentHash(allChunks);
    const crypto2ChunkHash = crypto.createHash('sha256').update(
      `${chunk1Id.toString()}:${chunkA.text}\n${chunk2Id.toString()}:${chunkB.text}`,
      'utf8'
    ).digest('hex');

    // Check 1: calculateSourceContentHash(allChunks) equals exact literal value
    assertTest(
      'calculateSourceContentHash(allChunks) equals literal SHA-256 string',
      actual2ChunkHash === EXPECTED_2_CHUNK_LITERAL_HASH
    );

    // Check 2: independently constructed 2-chunk canonical join hashed with node:crypto equals exact literal value
    assertTest(
      'independently constructed 2-chunk canonical join hashed with node:crypto equals literal SHA-256 string',
      crypto2ChunkHash === EXPECTED_2_CHUNK_LITERAL_HASH
    );

    // Check 3: out-of-order input still equals exact literal value
    assertTest(
      'calculateSourceContentHash 2-chunk out-of-order input equals literal SHA-256 string',
      calculateSourceContentHash([chunkB, chunkA]) === EXPECTED_2_CHUNK_LITERAL_HASH
    );

    const expectedSourceHashFromFixture = actual2ChunkHash;
    console.log(`    [HASH INFO] Full sourceContentHash for fixture (2 chunks, literal): ${EXPECTED_2_CHUNK_LITERAL_HASH}`);
    console.log(`    [HASH INFO] chunk A text: "${chunkA.text}", chunkOrder: ${chunkA.chunkOrder}`);
    console.log(`    [HASH INFO] chunk B text: "${chunkB.text}", chunkOrder: ${chunkB.chunkOrder}`);

    // ── Default read mocks (all-chunks mode) ──────────────────────────────
    AcademicSource.findById    = (async (id: any) => id.toString() === mockSourceId.toString() ? mockSource : null) as any;
    SourceContribution.findById = (async (id: any) => id.toString() === mockContribId.toString() ? mockContrib : null) as any;
    AcademicDocument.findOne   = (() => mockQuery(mockDoc)) as any;
    AcademicSection.find       = (() => mockQuery([mockSec])) as any;
    AcademicChunk.countDocuments = (async () => allChunks.length) as any;

    // ── §6a. Page 1 (limit=1) — returns chunk A ──────────────────────────
    console.log('\n  §6a. Approved — page 1 returns chunk A');
    AcademicChunk.find = (() => createMockQuery(() => allChunks, 'chunkOrder')) as any;

    const resPage1 = { statusCode: 200, jsonBody: null as any,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.jsonBody = b; return this; }
    };
    await getApprovedSourceRead({ params: { id: mockSourceId.toString() }, query: { page: '1', limit: '1' } } as any, resPage1 as any);

    if (resPage1.statusCode !== 200) console.log('  Page 1 failed:', resPage1.jsonBody);
    assertTest('Page 1 returns 200', resPage1.statusCode === 200);
    const p1 = resPage1.jsonBody.data;
    assertTest('Page 1 readerIdentity present', !!p1.readerIdentity);
    assertTest('Page 1 sections has 1 block', p1.sections.length === 1);
    assertTest('Page 1 section[0].blockIdentity.chunkId == chunkA._id', p1.sections[0].blockIdentity.chunkId === chunk1Id.toString());
    assertTest('Page 1 section[0].blockIdentity.chunkIndex == 10 (persisted chunkOrder)', p1.sections[0].blockIdentity.chunkIndex === 10);
    assertTest('Page 1 section[0].sectionIndex == 0', p1.sections[0].sectionIndex === 0);
    assertTest('Page 1 readerIdentity.sourceLanguage == vi', p1.readerIdentity.sourceLanguage === 'vi');
    assertTest('Page 1 readerIdentity.parserEngine == docling', p1.readerIdentity.parserEngine === 'docling');
    assertTest('Page 1 readerIdentity.parserVersion == "1" (string)', p1.readerIdentity.parserVersion === '1');
    assertTest('Page 1 sourceContentHash matches fixture', p1.readerIdentity.sourceContentHash === expectedSourceHashFromFixture);

    // ── §6b. Page 2 (limit=1) — returns chunk B ──────────────────────────
    console.log('\n  §6b. Approved — page 2 returns chunk B');
    AcademicChunk.find = (() => createMockQuery(() => allChunks, 'chunkOrder')) as any;

    const resPage2 = { statusCode: 200, jsonBody: null as any,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.jsonBody = b; return this; }
    };
    await getApprovedSourceRead({ params: { id: mockSourceId.toString() }, query: { page: '2', limit: '1' } } as any, resPage2 as any);

    if (resPage2.statusCode !== 200) console.log('  Page 2 failed:', resPage2.jsonBody);
    assertTest('Page 2 returns 200', resPage2.statusCode === 200);
    const p2 = resPage2.jsonBody.data;
    assertTest('Page 2 sections has 1 block', p2.sections.length === 1);
    assertTest('Page 2 section[0].blockIdentity.chunkId == chunkB._id', p2.sections[0].blockIdentity.chunkId === chunk2Id.toString());
    assertTest('Page 2 section[0].blockIdentity.chunkIndex == 20 (persisted chunkOrder)', p2.sections[0].blockIdentity.chunkIndex === 20);
    assertTest('Page 2 section[0].sectionIndex == 1 (skip=1, idx=0 -> 1)', p2.sections[0].sectionIndex === 1);
    assertTest('Page 1 and Page 2 sourceContentHash are identical', p1.readerIdentity.sourceContentHash === p2.readerIdentity.sourceContentHash);

    // ── §6c. Moderation preview — full doc path ───────────────────────────
    console.log('\n  §6c. Moderation — standard path (doc found)');
    AcademicDocument.findOne = (() => mockQuery(mockDoc)) as any;
    AcademicChunk.find = (() => mockQuery(allChunks)) as any;
    AcademicSection.find = (() => mockQuery([mockSec])) as any;

    const resMod = { statusCode: 200, jsonBody: null as any,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.jsonBody = b; return this; }
    };
    await getSourcePreview({ params: { id: mockContribId.toString() } } as any, resMod as any);
    if (resMod.statusCode !== 200) console.log('  Moderation failed:', resMod.jsonBody);
    assertTest('Moderation returns 200', resMod.statusCode === 200);
    assertTest('Moderation readerIdentity present', !!resMod.jsonBody.data.readerIdentity);
    assertTest('Moderation readerIdentity.sourceContentHash matches fixture', resMod.jsonBody.data.readerIdentity.sourceContentHash === expectedSourceHashFromFixture);
    assertTest('Moderation and approved sourceContentHash are identical', resMod.jsonBody.data.readerIdentity.sourceContentHash === p1.readerIdentity.sourceContentHash);

    // ── §6d. Moderation fallback — no doc, derive from chunks ─────────────
    console.log('\n  §6d. Moderation — fallback path (no doc, derives from chunks)');
    AcademicDocument.findOne = (() => mockQuery(null)) as any;
    AcademicChunk.find = (() => mockQuery(allChunks)) as any;
    AcademicSection.find = (() => mockQuery([mockSec])) as any;

    const resFallback = { statusCode: 200, jsonBody: null as any,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.jsonBody = b; return this; }
    };
    await getSourcePreview({ params: { id: mockContribId.toString() } } as any, resFallback as any);
    assertTest('Moderation fallback returns 200', resFallback.statusCode === 200);
    assertTest('Moderation fallback derivedDocumentId == mockDocId', resFallback.jsonBody.data.readerIdentity.documentId === mockDocId.toString());
    assertTest('Moderation fallback parserEngine is null', resFallback.jsonBody.data.readerIdentity.parserEngine === null);
    assertTest('Moderation fallback parserVersion is null', resFallback.jsonBody.data.readerIdentity.parserVersion === null);
    assertTest('Moderation fallback updatedAt is null', resFallback.jsonBody.data.readerIdentity.updatedAt === null);

    // ── §6e. Moderation — no chunks -> readerIdentity: null ───────────────
    console.log('\n  §6e. Moderation — no chunks');
    AcademicDocument.findOne = (() => mockQuery(mockDoc)) as any;
    AcademicChunk.find = (() => mockQuery([])) as any;
    AcademicSection.find = (() => mockQuery([mockSec])) as any;

    const resNoChunks = { statusCode: 200, jsonBody: null as any,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.jsonBody = b; return this; }
    };
    await getSourcePreview({ params: { id: mockContribId.toString() } } as any, resNoChunks as any);
    assertTest('No chunks returns 200', resNoChunks.statusCode === 200);
    assertTest('No chunks sets readerIdentity to null', resNoChunks.jsonBody.data.readerIdentity === null);

    // ── §6f. Moderation — ambiguous document IDs -> reader_identity_ambiguous ─
    console.log('\n  §6f. Moderation — ambiguous documentIds');
    AcademicDocument.findOne = (() => mockQuery(null)) as any;
    AcademicChunk.find = (() => mockQuery([
      { _id: new mongoose.Types.ObjectId(), documentId: new mongoose.Types.ObjectId(), chunkOrder: 1, text: 'A', sectionId: mockSecId },
      { _id: new mongoose.Types.ObjectId(), documentId: new mongoose.Types.ObjectId(), chunkOrder: 2, text: 'B', sectionId: mockSecId }
    ])) as any;

    const resAmbig = { statusCode: 200, jsonBody: null as any,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.jsonBody = b; return this; }
    };
    await getSourcePreview({ params: { id: mockContribId.toString() } } as any, resAmbig as any);
    assertTest('Ambiguous doc IDs returns 400', resAmbig.statusCode === 400);
    assertTest('Ambiguous doc IDs returns code reader_identity_ambiguous', resAmbig.jsonBody.code === 'reader_identity_ambiguous');
    assertTest('Ambiguous doc IDs does not leak internal error string', !JSON.stringify(resAmbig.jsonBody).includes('AMBIGUOUS_DOCUMENT_ID'));
    assertTest('Ambiguous doc IDs does not leak document IDs', !JSON.stringify(resAmbig.jsonBody).includes(mockDocId.toString()));

    // ── §6g. Moderation — missing documentId on a chunk -> reader_identity_unavailable ─
    console.log('\n  §6g. Moderation — chunk with missing documentId');
    AcademicDocument.findOne = (() => mockQuery(null)) as any;
    AcademicChunk.find = (() => mockQuery([
      { _id: new mongoose.Types.ObjectId(), documentId: mockDocId, chunkOrder: 1, text: 'A', sectionId: mockSecId },
      { _id: new mongoose.Types.ObjectId(), documentId: null, chunkOrder: 2, text: 'B', sectionId: mockSecId }
    ])) as any;

    const resUnavailable = { statusCode: 200, jsonBody: null as any,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.jsonBody = b; return this; }
    };
    await getSourcePreview({ params: { id: mockContribId.toString() } } as any, resUnavailable as any);
    assertTest('Missing documentId returns 400', resUnavailable.statusCode === 400);
    assertTest('Missing documentId returns code reader_identity_unavailable', resUnavailable.jsonBody.code === 'reader_identity_unavailable');
    assertTest('Missing documentId does not leak internal error string', !JSON.stringify(resUnavailable.jsonBody).includes('DOCUMENT_ID_UNAVAILABLE'));

    // ── §6h. Approved — chunk with invalid canonical identity on current page ─
    console.log('\n  §6h. Approved — chunk with invalid canonical identity on page 1');
    AcademicSource.findById = (async (id: any) => id.toString() === mockSourceId.toString() ? mockSource : null) as any;
    AcademicDocument.findOne = (() => mockQuery(mockDoc)) as any;
    AcademicChunk.countDocuments = (async () => 1) as any;
    const invalidChunkApproved = {
      _id: new mongoose.Types.ObjectId(),
      documentId: mockDocId,
      sectionId: null, // missing sectionId makes mapChunkToBlock throw CanonicalBlockIdentityError
      chunkOrder: 10,
      text: 'Text with invalid sectionId',
      blockType: 'paragraph'
    };
    AcademicChunk.find = (() => createMockQuery(() => [invalidChunkApproved])) as any;

    const resApprovedInvalid = { statusCode: 200, jsonBody: null as any,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.jsonBody = b; return this; }
    };
    await getApprovedSourceRead({ params: { id: mockSourceId.toString() }, query: { page: '1', limit: '1' } } as any, resApprovedInvalid as any);

    assertTest('Approved invalid chunk returns 400', resApprovedInvalid.statusCode === 400);
    assertTest('Approved invalid chunk returns code reader_block_identity_invalid', resApprovedInvalid.jsonBody.code === 'reader_block_identity_invalid');
    assertTest('Approved invalid chunk does not leak BLOCK_IDENTITY_INVALID string', !JSON.stringify(resApprovedInvalid.jsonBody).includes('BLOCK_IDENTITY_INVALID'));
    assertTest('Approved invalid chunk does not leak invalid chunk identity reason', !JSON.stringify(resApprovedInvalid.jsonBody).includes('sectionId is absent'));
    assertTest('Approved invalid chunk does not expose error or stack field', resApprovedInvalid.jsonBody.error === undefined && resApprovedInvalid.jsonBody.stack === undefined);

    // ── §6i. Approved — page 1 valid but off-page chunk invalid -> reader_block_identity_invalid ─
    console.log('\n  §6i. Approved — page 1 valid but off-page chunk invalid');
    AcademicSource.findById = (async (id: any) => id.toString() === mockSourceId.toString() ? mockSource : null) as any;
    AcademicDocument.findOne = (() => mockQuery(mockDoc)) as any;
    AcademicChunk.countDocuments = (async () => 2) as any;

    const validPage1Chunk = {
      _id: new mongoose.Types.ObjectId(),
      documentId: mockDocId,
      sectionId: mockSecId,
      chunkOrder: 10,
      text: 'Valid page 1 chunk text',
      blockType: 'paragraph'
    };
    const invalidOffPageChunk = {
      _id: new mongoose.Types.ObjectId(),
      documentId: mockDocId,
      sectionId: mockSecId,
      chunkOrder: 20,
      text: 12345, // invalid non-string text triggers calculateSourceContentHash validation
      blockType: 'paragraph'
    };

    const multiChunksFixture = [validPage1Chunk, invalidOffPageChunk];
    AcademicChunk.find = (() => createMockQuery(() => multiChunksFixture, 'chunkOrder')) as any;

    const resApprovedOffPageInvalid = { statusCode: 200, jsonBody: null as any,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.jsonBody = b; return this; }
    };
    await getApprovedSourceRead({ params: { id: mockSourceId.toString() }, query: { page: '1', limit: '1' } } as any, resApprovedOffPageInvalid as any);

    assertTest('Approved off-page invalid chunk returns 400', resApprovedOffPageInvalid.statusCode === 400);
    assertTest('Approved off-page invalid chunk returns code reader_block_identity_invalid', resApprovedOffPageInvalid.jsonBody.code === 'reader_block_identity_invalid');
    assertTest('Approved off-page invalid chunk does not leak BLOCK_IDENTITY_INVALID string', !JSON.stringify(resApprovedOffPageInvalid.jsonBody).includes('BLOCK_IDENTITY_INVALID'));
    assertTest('Approved off-page invalid chunk does not leak TypeError string', !JSON.stringify(resApprovedOffPageInvalid.jsonBody).includes('TypeError'));
    assertTest('Approved off-page invalid chunk does not leak internal reason', !JSON.stringify(resApprovedOffPageInvalid.jsonBody).includes('text is not a string'));
    assertTest('Approved off-page invalid chunk does not expose error or stack field', resApprovedOffPageInvalid.jsonBody.error === undefined && resApprovedOffPageInvalid.jsonBody.stack === undefined);
    assertTest('Approved off-page invalid chunk does not leak chunk IDs', !JSON.stringify(resApprovedOffPageInvalid.jsonBody).includes(validPage1Chunk._id.toString()));
    assertTest('Approved off-page invalid chunk does not leak section IDs', !JSON.stringify(resApprovedOffPageInvalid.jsonBody).includes(mockSecId.toString()));

    // ── §6j. TableData Projection — verified projection and hash stability ──────
    console.log('\n  §6j. TableData Projection — verified projection and hash stability');
    const tableChunkId = new mongoose.Types.ObjectId();
    const tableDataRaw = {
      version: 1,
      source: 'docling',
      reconstructionMethod: 'docling_native_v1',
      rowCount: 2,
      columnCount: 2,
      cells: [
        { row: 0, column: 0, rowSpan: 1, columnSpan: 1, text: 'A', role: 'header' },
        { row: 0, column: 1, rowSpan: 1, columnSpan: 1, text: 'B', role: 'header' },
        { row: 1, column: 0, rowSpan: 1, columnSpan: 1, text: 'C', role: 'data' },
        { row: 1, column: 1, rowSpan: 1, columnSpan: 1, text: 'D', role: 'data' }
      ],
      rawCells: [{ some: 'garbage' }],
      warnings: ['some warning']
    };
    const tableChunk = {
      _id: tableChunkId,
      documentId: mockDocId,
      chunkOrder: 1,
      text: 'Table caption',
      sectionId: mockSecId,
      blockType: 'table',
      tableData: tableDataRaw
    };

    const sectionMap = new Map();
    sectionMap.set(mockSecId.toString(), { _id: mockSecId, sectionOrder: 0, heading: 'S1', sectionType: 'body' });

    const mappedTable = mapChunkToBlock(tableChunk, sectionMap, 0, 0);
    const mappedTableData = mappedTable.tableData;
    assertTest('Projected tableData matches expected properties', mappedTableData !== null && mappedTableData !== undefined && mappedTableData.version === 1);
    assertTest('rowCount and columnCount mapped correctly', mappedTableData ? (mappedTableData.rowCount === 2 && mappedTableData.columnCount === 2) : false);
    assertTest('rawCells and warnings are omitted', mappedTableData ? ((mappedTableData as any).rawCells === undefined && (mappedTableData as any).warnings === undefined) : false);
    assertTest('Cells projected cleanly with spans', mappedTableData ? (mappedTableData.cells[0].row === 0 && mappedTableData.cells[0].rowSpan === 1) : false);
    assertTest('TableData inclusion does not affect chunk contentHash', mappedTable.blockIdentity.contentHash === calculateCanonicalChunkContentHash('Table caption'));

  } finally {
    restoreAll();
  }

  // ── Restoration assertions ───────────────────────────────────────────────
  assertRestoration('restoreAll was called exactly once (finally block ran)', restoreCallCount === 1);

  for (const [model, backup] of backups) {
    const modelName = model.modelName || 'Model';
    for (const m of WRITE_METHODS) {
      assertRestoration(`${modelName}.${m} is restored to original method`, model[m] === backup.get(m));
    }
  }
  assertRestoration('mongoose.Model.prototype.save is restored to original method', mongoose.Model.prototype.save === originalProtoSave);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`CANONICAL READER IDENTITY SUITE — I18N-3B.1.3`);
  console.log(`Behavioral Assertions Passed:  ${behavioralAssertions}`);
  console.log(`Restoration Assertions Passed: ${restorationAssertions}`);
  console.log(`Total Assertions Passed:       ${behavioralAssertions + restorationAssertions}`);
  console.log(`${'═'.repeat(60)}`);
}

runTests().catch(err => {
  console.error('\nTest suite FAILED:', err);
  process.exit(1);
});
