import assert from 'assert';
import mongoose from 'mongoose';
import AcademicSource from '../../models/AcademicSource';
import SourceContribution from '../../models/SourceContribution';
import AcademicDocument from '../../models/AcademicDocument';
import AcademicSection from '../../models/AcademicSection';
import AcademicChunk from '../../models/AcademicChunk';
import { buildRuleV3PlanPreviewRaw } from './ruleV3PlanPreview.service';

async function runTests() {
  console.log('=== RULE V3 PLAN RESOLVER TEST SUITE ===');

  const originalFindByIdSource = AcademicSource.findById;
  const originalFindByIdContribution = SourceContribution.findById;
  const originalFindOneDocument = AcademicDocument.findOne;
  const originalFindSection = AcademicSection.find;
  const originalFindChunk = AcademicChunk.find;

  const mockObjectId = new mongoose.Types.ObjectId();
  const mockContributionId = new mongoose.Types.ObjectId();
  const mockDocumentId = new mongoose.Types.ObjectId();
  const mockSectionId = new mongoose.Types.ObjectId();

  const mockDocument = {
    _id: mockDocumentId,
    parserEngine: 'docling',
    updatedAt: new Date().toISOString()
  };

  const mockSection = {
    _id: mockSectionId,
    heading: 'CHƯƠNG I: PHẦN MỞ ĐẦU',
    sectionType: 'introduction',
    sectionOrder: 1
  };

  const mockChunk = {
    _id: new mongoose.Types.ObjectId(),
    sectionId: mockSectionId,
    chunkOrder: 1,
    text: 'Đoạn văn bản trích dẫn mẫu thử nghiệm quy luật.',
    blockType: 'paragraph'
  };

  // Zero-write verification helper
  const writeCalled: string[] = [];
  const writeMethods = [
    'save',
    'create',
    'insertMany',
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'deleteOne',
    'deleteMany',
    'bulkWrite'
  ];

  // Intercept write methods on models and their prototypes
  for (const model of [AcademicSource, SourceContribution, AcademicDocument, AcademicSection, AcademicChunk]) {
    for (const method of writeMethods) {
      if ((model as any)[method]) {
        (model as any)[method] = (...args: any[]) => {
          writeCalled.push(method);
          throw new Error(`Forbidden database write call: ${method}`);
        };
      }
    }
    if (model.prototype) {
      for (const method of writeMethods) {
        if (model.prototype[method]) {
          model.prototype[method] = (...args: any[]) => {
            writeCalled.push(`prototype.${method}`);
            throw new Error(`Forbidden database write call: prototype.${method}`);
          };
        }
      }
    }
  }

  function resetState() {
    writeCalled.length = 0;

    AcademicSection.find = ((query: any) => {
      return {
        sort: () => ({
          lean: async () => [mockSection]
        })
      };
    }) as any;

    AcademicChunk.find = ((query: any) => {
      return {
        sort: () => ({
          lean: async () => [mockChunk]
        })
      };
    }) as any;
  }

  // Test 1: resolves pending SourceContribution ID through previewContributionId
  {
    resetState();
    let sourceQueryCalled = false;
    let contributionQueryId: any = null;
    let documentQuery: any = null;

    AcademicSource.findById = ((id: any) => {
      sourceQueryCalled = true;
      return { lean: async () => null };
    }) as any;

    SourceContribution.findById = ((id: any) => {
      contributionQueryId = id;
      return {
        lean: async () => ({
          _id: mockContributionId,
          title: 'Pending Contribution Title',
          detectedLanguage: 'vi'
        })
      };
    }) as any;

    AcademicDocument.findOne = ((query: any) => {
      documentQuery = query;
      return { lean: async () => mockDocument };
    }) as any;

    const result = await buildRuleV3PlanPreviewRaw(mockContributionId.toString());

    assert.ok(sourceQueryCalled);
    assert.strictEqual(String(contributionQueryId), mockContributionId.toString());
    assert.deepStrictEqual(documentQuery, { previewContributionId: mockContributionId });
    assert.strictEqual(result.document.parserEngine, 'docling');
    assert.strictEqual(writeCalled.length, 0);
    console.log('[PASS] Resolves pending SourceContribution ID through previewContributionId');
  }

  // Test 2: resolves approved AcademicSource ID through sourceId
  {
    resetState();
    let sourceQueryId: any = null;
    let contributionQueryId: any = null;
    let documentQuery: any = null;

    const mockSourceId = mockObjectId;

    AcademicSource.findById = ((id: any) => {
      sourceQueryId = id;
      return {
        lean: async () => ({
          _id: mockSourceId,
          sourceContributionId: mockContributionId,
          title: 'Approved Source Title',
          sourceQuality: 'high'
        })
      };
    }) as any;

    SourceContribution.findById = ((id: any) => {
      contributionQueryId = id;
      return {
        lean: async () => ({
          _id: mockContributionId,
          title: 'Contribution Title',
          detectedLanguage: 'vi'
        })
      };
    }) as any;

    AcademicDocument.findOne = ((query: any) => {
      documentQuery = query;
      return { lean: async () => mockDocument };
    }) as any;

    const result = await buildRuleV3PlanPreviewRaw(mockSourceId.toString());

    assert.strictEqual(String(sourceQueryId), mockSourceId.toString());
    assert.strictEqual(String(contributionQueryId), mockContributionId.toString());
    assert.deepStrictEqual(documentQuery, { sourceId: mockSourceId });
    assert.strictEqual(result.document.parserEngine, 'docling');
    assert.strictEqual(writeCalled.length, 0);
    console.log('[PASS] Resolves approved AcademicSource ID through sourceId');
  }

  // Restore original methods
  AcademicSource.findById = originalFindByIdSource;
  SourceContribution.findById = originalFindByIdContribution;
  AcademicDocument.findOne = originalFindOneDocument;
  AcademicSection.find = originalFindSection;
  AcademicChunk.find = originalFindChunk;

  console.log('================================================');
  console.log('RULE V3 PLAN RESOLVER: ALL PASSED, 0 FAILED');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
