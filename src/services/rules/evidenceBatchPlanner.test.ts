import assert from 'assert';
import { planEvidenceBatches } from './evidenceBatchPlanner.service';
import { DocumentExtractionPlan } from './documentResearchProfile.types';

const plan: DocumentExtractionPlan = {
  documentId: 'doc-vi-500-pages',
  documentType: 'mixed',
  sourceLanguage: 'vi',
  hasTargets: true,
  allExcluded: false,
  sectionDecisions: [
    { sectionId: 'abstract', sectionRole: 'abstract', usage: 'context', strategy: 'mixed_section_routing', strategyReason: 'context', roleConfidence: 'high', roleReasonCodes: ['heading_exact_match'] },
    { sectionId: 'results', sectionRole: 'results', usage: 'target', strategy: 'quantitative_results', strategyReason: 'result', roleConfidence: 'high', roleReasonCodes: ['heading_exact_match'] },
    { sectionId: 'themes', sectionRole: 'qualitative_findings', usage: 'target', strategy: 'qualitative_themes', strategyReason: 'themes', roleConfidence: 'high', roleReasonCodes: ['qualitative_heading_pattern'] },
    { sectionId: 'refs', sectionRole: 'references', usage: 'skip', strategy: 'skip', strategyReason: 'furniture', roleConfidence: 'high', roleReasonCodes: ['references_heading'] },
  ],
};

const chunks = [
  { chunkId: 'a1', sectionId: 'abstract', chunkOrder: 0, text: 'Tóm tắt tài liệu.' },
  { chunkId: 'r1', sectionId: 'results', chunkOrder: 1, text: 'Kết quả định lượng '.repeat(80), pageStart: 20, pageEnd: 21 },
  { chunkId: 'r2', sectionId: 'results', chunkOrder: 2, text: 'Không tìm thấy khác biệt có ý nghĩa.', pageStart: 22, pageEnd: 22 },
  { chunkId: 't1', sectionId: 'themes', chunkOrder: 3, text: 'Chủ đề định tính được người tham gia mô tả.', pageStart: 30, pageEnd: 30 },
  { chunkId: 'x1', sectionId: 'refs', chunkOrder: 4, text: 'Tài liệu tham khảo.' },
  { chunkId: 'r2', sectionId: 'results', chunkOrder: 5, text: 'duplicate must not pass' },
  { chunkId: 'missing', sectionId: 'unknown-section', chunkOrder: 6, text: 'Không rõ section.' },
];

const output = planEvidenceBatches(plan, chunks, { maxCharactersPerBatch: 2000, maxChunksPerBatch: 2 });
assert.strictEqual(output.sourceLanguage, 'vi');
assert.strictEqual(output.diagnostics.inputChunkCount, 7);
assert.strictEqual(output.diagnostics.targetChunkCount, 3);
assert.strictEqual(output.diagnostics.duplicateChunkCount, 1);
assert.strictEqual(output.diagnostics.missingSectionChunkCount, 1);
assert.strictEqual(output.diagnostics.skippedChunkCount, 2);
assert.strictEqual(output.batches.length, 2);
assert.strictEqual(output.batches[0].strategy, 'quantitative_results');
assert.strictEqual(output.batches[1].strategy, 'qualitative_themes');
assert.ok(output.batches.every(batch => batch.chunks.every(chunk => chunk.text === chunks.find(item => item.chunkId === chunk.chunkId)?.text)));
assert.ok(output.batches.every(batch => /^evb_[a-f0-9]{20}$/.test(batch.batchId)));
assert.deepStrictEqual(output, planEvidenceBatches(plan, chunks, { maxCharactersPerBatch: 2000, maxChunksPerBatch: 2 }));

const huge = planEvidenceBatches(plan, [
  { chunkId: 'huge', sectionId: 'results', chunkOrder: 0, text: 'x'.repeat(2500) },
], { maxCharactersPerBatch: 2000 });
assert.strictEqual(huge.batches[0].oversizedSingleChunk, true);
assert.strictEqual(huge.batches[0].chunks[0].text.length, 2500);

console.log('EVIDENCE BATCH PLANNER: 15 PASSED, 0 FAILED');
