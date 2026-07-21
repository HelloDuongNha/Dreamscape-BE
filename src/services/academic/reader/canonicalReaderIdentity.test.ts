import assert from 'node:assert';
import mongoose from 'mongoose';
import crypto from 'node:crypto';

// Import models to spy/block and mock
import AcademicSource from '../../../models/AcademicSource';
import SourceContribution from '../../../models/SourceContribution';
import AcademicDocument from '../../../models/AcademicDocument';
import AcademicSection from '../../../models/AcademicSection';
import AcademicChunk from '../../../models/AcademicChunk';
import KnowledgeRuleV3 from '../../../models/rulesV3/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../../models/rulesV3/KnowledgeRuleEvidence';

// Import service helpers
import {
  calculateCanonicalChunkContentHash,
  calculateSourceContentHash,
  normalizeLanguageCode,
  deriveDocumentIdFromChunks,
  mapChunkToBlock
} from './canonicalReaderIdentity.service';

// Import controllers to test
import { getApprovedSourceRead } from '../../../controllers/sourceController';
import { getSourcePreview } from '../../../controllers/moderationController';

async function runTests() {
  console.log('=== STARTING CANONICAL SMART READER IDENTITY CONTRACT TESTS ===');

  let testAssertions = 0;
  const assertTest = (msg: string, cond: boolean) => {
    testAssertions++;
    assert.ok(cond, msg);
    console.log(`[PASS] ${msg}`);
  };

  // Backups of all original Mongoose read/write methods
  const originals = {
    // Reads
    sourceFindById: AcademicSource.findById,
    contributionFindById: SourceContribution.findById,
    docFindOne: AcademicDocument.findOne,
    secFind: AcademicSection.find,
    chunkFind: AcademicChunk.find,
    chunkCount: AcademicChunk.countDocuments,

    // Writes
    sourceCreate: AcademicSource.create,
    sourceInsertMany: AcademicSource.insertMany,
    sourceUpdateOne: AcademicSource.updateOne,
    sourceUpdateMany: AcademicSource.updateMany,
    sourceFindOneAndUpdate: AcademicSource.findOneAndUpdate,
    sourceReplaceOne: AcademicSource.replaceOne,
    sourceBulkWrite: AcademicSource.bulkWrite,
    sourceDeleteOne: AcademicSource.deleteOne,
    sourceDeleteMany: AcademicSource.deleteMany,
    sourceFindOneAndDelete: AcademicSource.findOneAndDelete,
    sourceFindByIdAndUpdate: AcademicSource.findByIdAndUpdate,
    sourceFindByIdAndDelete: AcademicSource.findByIdAndDelete,

    contributionCreate: SourceContribution.create,
    contributionInsertMany: SourceContribution.insertMany,
    contributionUpdateOne: SourceContribution.updateOne,
    contributionUpdateMany: SourceContribution.updateMany,
    contributionFindOneAndUpdate: SourceContribution.findOneAndUpdate,
    contributionReplaceOne: SourceContribution.replaceOne,
    contributionBulkWrite: SourceContribution.bulkWrite,
    contributionDeleteOne: SourceContribution.deleteOne,
    contributionDeleteMany: SourceContribution.deleteMany,
    contributionFindOneAndDelete: SourceContribution.findOneAndDelete,
    contributionFindByIdAndUpdate: SourceContribution.findByIdAndUpdate,
    contributionFindByIdAndDelete: SourceContribution.findByIdAndDelete,

    docCreate: AcademicDocument.create,
    docInsertMany: AcademicDocument.insertMany,
    docUpdateOne: AcademicDocument.updateOne,
    docUpdateMany: AcademicDocument.updateMany,
    docFindOneAndUpdate: AcademicDocument.findOneAndUpdate,
    docReplaceOne: AcademicDocument.replaceOne,
    docBulkWrite: AcademicDocument.bulkWrite,
    docDeleteOne: AcademicDocument.deleteOne,
    docDeleteMany: AcademicDocument.deleteMany,
    docFindOneAndDelete: AcademicDocument.findOneAndDelete,
    docFindByIdAndUpdate: AcademicDocument.findByIdAndUpdate,
    docFindByIdAndDelete: AcademicDocument.findByIdAndDelete,

    secCreate: AcademicSection.create,
    secInsertMany: AcademicSection.insertMany,
    secUpdateOne: AcademicSection.updateOne,
    secUpdateMany: AcademicSection.updateMany,
    secFindOneAndUpdate: AcademicSection.findOneAndUpdate,
    secReplaceOne: AcademicSection.replaceOne,
    secBulkWrite: AcademicSection.bulkWrite,
    secDeleteOne: AcademicSection.deleteOne,
    secDeleteMany: AcademicSection.deleteMany,
    secFindOneAndDelete: AcademicSection.findOneAndDelete,
    secFindByIdAndUpdate: AcademicSection.findByIdAndUpdate,
    secFindByIdAndDelete: AcademicSection.findByIdAndDelete,

    chunkCreate: AcademicChunk.create,
    chunkInsertMany: AcademicChunk.insertMany,
    chunkUpdateOne: AcademicChunk.updateOne,
    chunkUpdateMany: AcademicChunk.updateMany,
    chunkFindOneAndUpdate: AcademicChunk.findOneAndUpdate,
    chunkReplaceOne: AcademicChunk.replaceOne,
    chunkBulkWrite: AcademicChunk.bulkWrite,
    chunkDeleteOne: AcademicChunk.deleteOne,
    chunkDeleteMany: AcademicChunk.deleteMany,
    chunkFindOneAndDelete: AcademicChunk.findOneAndDelete,
    chunkFindByIdAndUpdate: AcademicChunk.findByIdAndUpdate,
    chunkFindByIdAndDelete: AcademicChunk.findByIdAndDelete,

    protoSave: mongoose.Model.prototype.save
  };

  const blockWrites = () => {
    const throwWrite = () => {
      throw new Error('DATABASE_WRITE_FORBIDDEN_IN_READER');
    };

    const models = [AcademicSource, SourceContribution, AcademicDocument, AcademicSection, AcademicChunk, KnowledgeRuleV3, KnowledgeRuleEvidenceV3];
    for (const m of models) {
      m.create = throwWrite as any;
      m.insertMany = throwWrite as any;
      m.updateOne = throwWrite as any;
      m.updateMany = throwWrite as any;
      m.findOneAndUpdate = throwWrite as any;
      m.replaceOne = throwWrite as any;
      m.bulkWrite = throwWrite as any;
      m.deleteOne = throwWrite as any;
      m.deleteMany = throwWrite as any;
      m.findOneAndDelete = throwWrite as any;
      m.findByIdAndUpdate = throwWrite as any;
      m.findByIdAndDelete = throwWrite as any;
    }
    mongoose.Model.prototype.save = throwWrite as any;
  };

  const restoreAll = () => {
    AcademicSource.findById = originals.sourceFindById;
    SourceContribution.findById = originals.contributionFindById;
    AcademicDocument.findOne = originals.docFindOne;
    AcademicSection.find = originals.secFind;
    AcademicChunk.find = originals.chunkFind;
    AcademicChunk.countDocuments = originals.chunkCount;

    const models = [AcademicSource, SourceContribution, AcademicDocument, AcademicSection, AcademicChunk, KnowledgeRuleV3, KnowledgeRuleEvidenceV3];
    const keys = [
      'create', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate',
      'replaceOne', 'bulkWrite', 'deleteOne', 'deleteMany', 'findOneAndDelete',
      'findByIdAndUpdate', 'findByIdAndDelete'
    ];
    for (const m of models) {
      const prefix = m.modelName === 'AcademicSource' ? 'source' :
                     m.modelName === 'SourceContribution' ? 'contribution' :
                     m.modelName === 'AcademicDocument' ? 'doc' :
                     m.modelName === 'AcademicSection' ? 'sec' : 'chunk';
      for (const k of keys) {
        const origKey = (prefix + k.charAt(0).toUpperCase() + k.slice(1)) as keyof typeof originals;
        if (originals[origKey]) {
          (m as any)[k] = originals[origKey];
        }
      }
    }
    mongoose.Model.prototype.save = originals.protoSave;
  };

  try {
    // 1. Language Normalization Tests
    assertTest('normalizeLanguageCode handles vi lowercase', normalizeLanguageCode('vi') === 'vi');
    assertTest('normalizeLanguageCode handles vi-VN regional', normalizeLanguageCode('vi-VN') === 'vi');
    assertTest('normalizeLanguageCode handles vi_VN regional', normalizeLanguageCode('vi_VN') === 'vi');
    assertTest('normalizeLanguageCode handles en uppercase/spaces', normalizeLanguageCode('  EN-US  ') === 'en');
    assertTest('normalizeLanguageCode returns null for unknown', normalizeLanguageCode('unknown') === null);
    assertTest('normalizeLanguageCode returns null for und', normalizeLanguageCode('und') === null);
    assertTest('normalizeLanguageCode returns null for empty', normalizeLanguageCode('') === null);
    assertTest('normalizeLanguageCode returns null for unsupported', normalizeLanguageCode('fr') === null);
    assertTest('normalizeLanguageCode returns null for null', normalizeLanguageCode(null) === null);

    // 2. Hash Formula and Determinism Tests
    const chunk1 = { _id: new mongoose.Types.ObjectId(), text: 'Bản đọc mẫu Tiếng Việt.', chunkOrder: 1 };
    const chunk2 = { _id: new mongoose.Types.ObjectId(), text: 'Sample text English with \n newlines.', chunkOrder: 2 };
    const chunk3 = { _id: new mongoose.Types.ObjectId(), text: '  Leading and trailing whitespace  ', chunkOrder: 3 };

    const hash1 = calculateCanonicalChunkContentHash(chunk1.text);
    const expectedHash1 = crypto.createHash('sha256').update(chunk1.text, 'utf8').digest('hex');
    assertTest('calculateCanonicalChunkContentHash equals direct sha256', hash1 === expectedHash1);

    const sourceHash = calculateSourceContentHash([chunk2, chunk1, chunk3]); // Out of order inputs
    const expectedSourceHash = crypto.createHash('sha256').update(
      [chunk1, chunk2, chunk3].map(c => `${c._id.toString()}:${c.text}`).join('\n'),
      'utf8'
    ).digest('hex');
    assertTest('calculateSourceContentHash matches sorted order and Rule V3 fingerprint format', sourceHash === expectedSourceHash);

    // Verify changing text changes hash
    const chunk1Modified = { ...chunk1, text: 'Bản đọc mẫu Tiếng Việt đã sửa.' };
    const hash1Modified = calculateCanonicalChunkContentHash(chunk1Modified.text);
    assertTest('Changing chunk text changes contentHash', hash1 !== hash1Modified);

    const sourceHashModified = calculateSourceContentHash([chunk1Modified, chunk2, chunk3]);
    assertTest('Changing chunk text changes sourceContentHash', sourceHash !== sourceHashModified);

    // Verify changing HTML or non-text labels does not affect hashes
    const chunk1WithHtml = { ...chunk1, html: '<p>Bản đọc mẫu Tiếng Việt.</p>' };
    const sourceHashWithHtml = calculateSourceContentHash([chunk1WithHtml, chunk2, chunk3]);
    assertTest('Changing HTML does not change sourceContentHash', sourceHash === sourceHashWithHtml);

    // 3. Document ID Derivation Fallback
    const docId = new mongoose.Types.ObjectId();
    const mockChunksWithSameDocId = [
      { documentId: docId },
      { documentId: docId }
    ];
    assertTest('deriveDocumentIdFromChunks resolves unique ID', deriveDocumentIdFromChunks(mockChunksWithSameDocId) === docId.toString());

    const mockChunksWithMultipleDocIds = [
      { documentId: docId },
      { documentId: new mongoose.Types.ObjectId() }
    ];
    let threwDerivation = false;
    try {
      deriveDocumentIdFromChunks(mockChunksWithMultipleDocIds);
    } catch (e: any) {
      threwDerivation = e.message === 'AMBIGUOUS_DOCUMENT_ID';
    }
    assertTest('deriveDocumentIdFromChunks throws AMBIGUOUS_DOCUMENT_ID on ambiguity', threwDerivation);

    let threwEmpty = false;
    try {
      deriveDocumentIdFromChunks([]);
    } catch (e: any) {
      threwEmpty = e.message === 'DOCUMENT_ID_UNAVAILABLE';
    }
    assertTest('deriveDocumentIdFromChunks throws DOCUMENT_ID_UNAVAILABLE on empty list', threwEmpty);

    // 4. Missing-Section Fallback mapping tests
    const chunkWithMissingSection = {
      _id: new mongoose.Types.ObjectId(),
      sectionId: new mongoose.Types.ObjectId(),
      chunkOrder: 4,
      text: 'No section text.',
      blockType: 'heading'
    };
    const emptySectionMap = new Map<string, any>();
    const mappedBlock = mapChunkToBlock(chunkWithMissingSection, emptySectionMap, 0, 0);
    assertTest('mapChunkToBlock works with missing section', mappedBlock.sectionType === 'heading');
    assertTest('mapChunkToBlock preserves canonical sectionId', mappedBlock.blockIdentity.sectionId === chunkWithMissingSection.sectionId.toString());
    assertTest('mapChunkToBlock keeps sectionIdentity sectionId canonical', mappedBlock.sectionIdentity?.sectionId === chunkWithMissingSection.sectionId.toString());
    assertTest('mapChunkToBlock nullifies sectionOrder for missing section', mappedBlock.sectionIdentity?.sectionOrder === null);
    assertTest('mapChunkToBlock nullifies heading for missing section', mappedBlock.sectionIdentity?.heading === null);
    assertTest('mapChunkToBlock nullifies sectionType for missing section', mappedBlock.sectionIdentity?.sectionType === null);

    // 5. Zero-Write and Endpoint Controller Integration Tests
    blockWrites();

    const mockSourceId = new mongoose.Types.ObjectId();
    const mockContributionId = new mongoose.Types.ObjectId();
    const mockDocId = new mongoose.Types.ObjectId();
    const mockSecId = new mongoose.Types.ObjectId();

    const mockSource = {
      _id: mockSourceId,
      title: 'Khảo sát Giấc mơ Việt',
      authors: ['Nguyễn Văn A'],
      year: 2026,
      journal: 'Tạp chí Tâm lý học',
      doi: '10.5678/dream.vn',
      license: 'CC-BY',
      readableInApp: true,
      fullTextStatus: 'imported',
      allowedUse: 'open_access_fulltext',
      detectedLanguage: 'vi-VN',
      originalFile: { fileHash: 'bin_hash_123' }
    };

    const mockContribution = {
      _id: mockContributionId,
      title: 'Khảo sát Giấc mơ Việt (Contribution)',
      authors: ['Nguyễn Văn A'],
      year: 2026,
      journal: 'Tạp chí Tâm lý học',
      doi: '10.5678/dream.vn',
      allowedUse: 'open_access_fulltext',
      detectedLanguage: 'vi-VN',
      reviewStatus: 'approved',
      originalFile: { fileHash: 'bin_hash_123' }
    };

    const mockDoc = {
      _id: mockDocId,
      sourceId: mockSourceId,
      previewContributionId: mockContributionId,
      parserEngine: 'docling',
      parserVersion: 1,
      updatedAt: new Date(),
      createdAt: new Date()
    };

    const mockSec = {
      _id: mockSecId,
      documentId: mockDocId,
      heading: '1. Mở đầu',
      sectionType: 'introduction',
      sectionOrder: 1
    };

    const mockChunks = [
      {
        _id: new mongoose.Types.ObjectId(),
        documentId: mockDocId,
        sectionId: mockSecId,
        chunkPurpose: 'reader',
        chunkOrder: 10,
        text: 'Nội dung đoạn số 1.',
        blockType: 'paragraph'
      },
      {
        _id: new mongoose.Types.ObjectId(),
        documentId: mockDocId,
        sectionId: mockSecId,
        chunkPurpose: 'reader',
        chunkOrder: 20,
        text: 'Nội dung đoạn số 2.',
        blockType: 'paragraph'
      }
    ];

    const mockQuery = (data: any) => {
      const q = Promise.resolve(data) as any;
      q.sort = function() { return this; };
      q.skip = function() { return this; };
      q.limit = function() { return this; };
      q.lean = function() { return this; };
      return q;
    };

    // Mock read queries
    AcademicSource.findById = (async (id: any) => id.toString() === mockSourceId.toString() ? mockSource : null) as any;
    SourceContribution.findById = (async (id: any) => id.toString() === mockContributionId.toString() ? mockContribution : null) as any;
    AcademicDocument.findOne = (() => mockQuery(mockDoc)) as any;
    AcademicSection.find = (() => mockQuery([mockSec])) as any;
    AcademicChunk.find = (() => mockQuery(mockChunks)) as any;
    AcademicChunk.countDocuments = (async () => mockChunks.length) as any;

    // Test Approved Library Read Endpoint
    const reqApproved = {
      params: { id: mockSourceId.toString() },
      query: { page: '1', limit: '2' }
    } as any;
    const resApproved = {
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { this.jsonBody = body; return this; },
      statusCode: 200,
      jsonBody: null
    } as any;

    await getApprovedSourceRead(reqApproved, resApproved);

    if (resApproved.statusCode !== 200) {
      console.log('resApproved failed status:', resApproved.statusCode, 'body:', resApproved.jsonBody);
    }

    assertTest('Approved endpoint returns 200', resApproved.statusCode === 200);
    const approvedData = resApproved.jsonBody.data;
    assertTest('Approved endpoint returns readerIdentity top-level', !!approvedData.readerIdentity);
    assertTest('Approved endpoint does not duplicate readerIdentity in fullText', !approvedData.fullText.readerIdentity);
    assertTest('Approved readerIdentity.documentId is correct', approvedData.readerIdentity.documentId === mockDocId.toString());
    assertTest('Approved readerIdentity.sourceLanguage is normalized', approvedData.readerIdentity.sourceLanguage === 'vi');
    assertTest('Approved readerIdentity.parserEngine is correct', approvedData.readerIdentity.parserEngine === 'docling');
    assertTest('Approved readerIdentity.parserVersion is string type', approvedData.readerIdentity.parserVersion === '1');
    assertTest('Approved sections blockIdentity contains chunkIndex matching chunkOrder', approvedData.sections[0].blockIdentity.chunkIndex === 10);
    assertTest('Approved sections blockIdentity contains chunkId matching chunk _id', approvedData.sections[0].blockIdentity.chunkId === mockChunks[0]._id.toString());
    assertTest('Approved sections blockIdentity contains contentHash', !!approvedData.sections[0].blockIdentity.contentHash);
    assertTest('Approved sections sectionIdentity contains heading', approvedData.sections[0].sectionIdentity.heading === '1. Mở đầu');

    // Test Pagination Hash Equality
    const reqApprovedPage2 = {
      params: { id: mockSourceId.toString() },
      query: { page: '2', limit: '1' }
    } as any;
    const resApprovedPage2 = {
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { this.jsonBody = body; return this; },
      statusCode: 200,
      jsonBody: null
    } as any;

    // Simulate paginated response builder chunk query
    AcademicChunk.find = ((query: any) => {
      // If it's a paginated find, return single item, if it's the global identity hash query, return all
      if (query.documentId && query.chunkPurpose && (Object.keys(query).length === 2 || query.hasOwnProperty('$projection'))) {
        return mockQuery(mockChunks); // global hash query uses all
      }
      return mockQuery([mockChunks[1]]); // page 2 query
    }) as any;

    await getApprovedSourceRead(reqApprovedPage2, resApprovedPage2);
    assertTest('Page 2 endpoint returns 200', resApprovedPage2.statusCode === 200);
    assertTest('sourceContentHash is identical across page 1 and page 2', approvedData.readerIdentity.sourceContentHash === resApprovedPage2.jsonBody.data.readerIdentity.sourceContentHash);

    // Test Moderation Preview Endpoint
    AcademicChunk.find = (() => mockQuery(mockChunks)) as any;
    const reqModeration = {
      params: { id: mockContributionId.toString() }
    } as any;
    const resModeration = {
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { this.jsonBody = body; return this; },
      statusCode: 200,
      jsonBody: null
    } as any;

    await getSourcePreview(reqModeration, resModeration);
    if (resModeration.statusCode !== 200) {
      console.log('resModeration failed status:', resModeration.statusCode, 'body:', resModeration.jsonBody);
    }
    assertTest('Moderation endpoint returns 200', resModeration.statusCode === 200);
    const moderationData = resModeration.jsonBody.data;
    assertTest('Moderation endpoint returns readerIdentity', !!moderationData.readerIdentity);
    assertTest('Moderation readerIdentity matches approved readerIdentity', JSON.stringify(moderationData.readerIdentity) === JSON.stringify(approvedData.readerIdentity));

    // Test Moderation Fallback where Document is missing but chunks exist
    AcademicDocument.findOne = (async () => null) as any;
    const resModerationFallback = {
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { this.jsonBody = body; return this; },
      statusCode: 200,
      jsonBody: null
    } as any;

    await getSourcePreview(reqModeration, resModerationFallback);
    assertTest('Moderation fallback returns 200', resModerationFallback.statusCode === 200);
    const fallbackData = resModerationFallback.jsonBody.data;
    assertTest('Moderation fallback derives correct documentId from chunks', fallbackData.readerIdentity.documentId === mockDocId.toString());
    assertTest('Moderation fallback sets parserEngine to null', fallbackData.readerIdentity.parserEngine === null);
    assertTest('Moderation fallback sets parserVersion to null', fallbackData.readerIdentity.parserVersion === null);
    assertTest('Moderation fallback sets updatedAt to null', fallbackData.readerIdentity.updatedAt === null);

    // Test Moderation with no chunks returns readerIdentity: null
    AcademicChunk.find = (() => mockQuery([])) as any;
    const resModerationNoChunks = {
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { this.jsonBody = body; return this; },
      statusCode: 200,
      jsonBody: null
    } as any;

    await getSourcePreview(reqModeration, resModerationNoChunks);
    assertTest('Moderation no chunks returns 200', resModerationNoChunks.statusCode === 200);
    assertTest('Moderation no chunks sets readerIdentity to null', resModerationNoChunks.jsonBody.data.readerIdentity === null);

    // Test Moderation ambiguous document IDs fails safely
    const ambiguousChunks = [
      { _id: new mongoose.Types.ObjectId(), documentId: new mongoose.Types.ObjectId(), chunkOrder: 1, text: 'Text A' },
      { _id: new mongoose.Types.ObjectId(), documentId: new mongoose.Types.ObjectId(), chunkOrder: 2, text: 'Text B' }
    ];
    AcademicChunk.find = (() => mockQuery(ambiguousChunks)) as any;
    const resModerationAmbiguous = {
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { this.jsonBody = body; return this; },
      statusCode: 200,
      jsonBody: null
    } as any;

    await getSourcePreview(reqModeration, resModerationAmbiguous);
    assertTest('Moderation ambiguous document IDs returns 400', resModerationAmbiguous.statusCode === 400);
    assertTest('Moderation ambiguous document IDs returns sanitized message', resModerationAmbiguous.jsonBody.message === 'Ambiguous document reference in reader chunks.');
    assertTest('Moderation ambiguous document IDs does not leak stack traces or internal IDs', !resModerationAmbiguous.jsonBody.error && !JSON.stringify(resModerationAmbiguous.jsonBody).includes('AMBIGUOUS_DOCUMENT_ID'));

  } finally {
    restoreAll();
  }

  console.log(`================================================`);
  console.log(`CANONICAL READER IDENTITY SUITE: ${testAssertions} ASSERTIONS PASSED`);
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
