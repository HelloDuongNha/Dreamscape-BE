import { planHierarchicalEvidence } from './hierarchicalEvidencePlanner.service';
import type { DocumentResearchProfile, DocumentExtractionPlan } from './documentResearchProfile.types';
import type { EvidenceBatchPlan, EvidenceBatch, PlannedEvidenceChunk } from './evidenceBatchPlanner.types';

let testPassCount = 0;
let testFailCount = 0;

function assert(name: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`[PASS] ${name}`);
    testPassCount++;
  } else {
    console.error(`[FAIL] ${name}${details ? ' — ' + details : ''}`);
    testFailCount++;
  }
}

// ─── Helpers to build test data ──────────────────────────────────────────────

function makeProfile(docId: string, docType: any, sections: { id: string; heading: string; role: any }[]): DocumentResearchProfile {
  return {
    documentId: docId,
    documentType: docType,
    typeConfidence: 'high',
    typeReasonCodes: [],
    sourceLanguage: 'en',
    typeEvidenceChannels: [],
    sectionProfiles: sections.map((s, idx) => ({
      sectionId: s.id,
      heading: s.heading,
      sectionOrder: idx,
      resolvedRole: s.role,
      roleConfidence: 'high',
      roleReasonCodes: [],
    })),
  };
}

function makePlan(docId: string, docType: any, sections: { id: string; role: any; usage: any; strategy: any }[]): DocumentExtractionPlan {
  return {
    documentId: docId,
    documentType: docType,
    sourceLanguage: 'en',
    hasTargets: sections.some(s => s.usage === 'target'),
    allExcluded: sections.every(s => s.usage === 'skip'),
    sectionDecisions: sections.map(s => ({
      sectionId: s.id,
      sectionRole: s.role,
      usage: s.usage,
      strategy: s.strategy,
      strategyReason: '',
      roleConfidence: 'high',
      roleReasonCodes: [],
    })),
  };
}

function makeBatch(batchId: string, strategy: any, chunks: { chunkId: string; sectionId: string; order: number; text: string }[]): EvidenceBatch {
  return {
    batchId,
    strategy,
    sourceLanguage: 'en',
    characterCount: chunks.reduce((sum, c) => sum + c.text.length, 0),
    oversizedSingleChunk: false,
    chunks: chunks.map(c => ({
      chunkId: c.chunkId,
      sectionId: c.sectionId,
      chunkOrder: c.order,
      text: c.text,
      sectionRole: 'body',
      strategy,
      contentHash: 'hash',
    })),
  };
}

// ─── RUNNING TESTS ────────────────────────────────────────────────────────────

console.log('=== HIERARCHICAL EVIDENCE WORK-UNIT PLANNER TEST SUITE ===\n');

// ════════════════════════════════════════════════════════════════════════════════
// 1. Theoretical Article: 16 target sections, 19 batches, 16 work units, coverage
// ════════════════════════════════════════════════════════════════════════════════
console.log('--- Test 1: Theoretical Article ---');
{
  const docId = 'art_001';
  const sections: { id: string; heading: string; role: any; usage: any; strategy: any }[] = [];
  const batches: EvidenceBatch[] = [];
  let chunkCounter = 1;

  for (let i = 1; i <= 16; i++) {
    const secId = `sec_${i}`;
    sections.push({
      id: secId,
      heading: `Theoretical Section ${i}`,
      role: 'body',
      usage: 'target',
      strategy: 'theoretical_framework',
    });

    // Create 1 or 2 chunks for this section, making 19 chunks total across 16 sections
    const numChunks = i <= 3 ? 2 : 1;
    const chunkList: any[] = [];
    for (let c = 1; c <= numChunks; c++) {
      chunkList.push({
        chunkId: `chk_${chunkCounter++}`,
        sectionId: secId,
        order: c,
        text: `Chunk content text for section ${i} chunk ${c}.`,
      });
    }

    // Each chunk gets its own technical batch (so 19 batches total)
    for (const ch of chunkList) {
      batches.push(makeBatch(`bat_${ch.chunkId}`, 'theoretical_framework', [ch]));
    }
  }

  const profile = makeProfile(docId, 'theoretical_or_conceptual', sections);
  const extractionPlan = makePlan(docId, 'theoretical_or_conceptual', sections);
  const evidenceBatchPlan: EvidenceBatchPlan = {
    documentId: docId,
    sourceLanguage: 'en',
    researchType: 'theoretical_or_conceptual',
    batches,
    diagnostics: {
      inputChunkCount: 19,
      targetChunkCount: 19,
      skippedChunkCount: 0,
      missingSectionChunkCount: 0,
      duplicateChunkCount: 0,
      oversizedChunkCount: 0,
      batchCount: 19,
    },
  };

  const plan = planHierarchicalEvidence(profile, extractionPlan, evidenceBatchPlan);

  assert('T1: organizationMode === article_sections', plan.organizationMode === 'article_sections');
  assert('T1: workUnits count is 16', plan.workUnits.length === 16, `got ${plan.workUnits.length}`);
  assert('T1: diagnostics.workUnitCount is 16', plan.diagnostics.workUnitCount === 16);
  assert('T1: diagnostics.targetSectionCount is 16', plan.diagnostics.targetSectionCount === 16);
  assert('T1: diagnostics.targetChunkCount is 19', plan.diagnostics.targetChunkCount === 19);
  assert('T1: diagnostics.assignedChunkCount is 19', plan.diagnostics.assignedChunkCount === 19);
  assert('T1: diagnostics.unassignedChunkCount is 0', plan.diagnostics.unassignedChunkCount === 0);
  assert('T1: diagnostics.duplicateAssignmentCount is 0', plan.diagnostics.duplicateAssignmentCount === 0);
  assert('T1: diagnostics.technicalBatchCount is 19', plan.diagnostics.technicalBatchCount === 19);

  // Check unique batch assignment: 19 batches distributed across 16 work units, no duplicate assignments
  const allBatchIds = plan.workUnits.flatMap(w => w.batchIds);
  assert('T1: all 19 batch IDs mapped', allBatchIds.length === 19);
  assert('T1: no duplicate batches across units', new Set(allBatchIds).size === 19);
}

// ════════════════════════════════════════════════════════════════════════════════
// 2. Vietnamese Book: 3 major chapters with subsections, front/back matter excluded
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Test 2: Vietnamese Book ---');
{
  const docId = 'book_vi';
  const sections = [
    // Front matter (excluded)
    { id: 'sec_toc', heading: 'Mục lục', role: 'metadata' as const, usage: 'skip' as const, strategy: 'skip' as const },
    { id: 'sec_pref', heading: 'Lời nói đầu', role: 'metadata' as const, usage: 'skip' as const, strategy: 'skip' as const },
    // Chapter 1
    { id: 'sec_ch1', heading: 'Chương 1: Cơ sở lý thuyết giấc mơ', role: 'body' as const, usage: 'target' as const, strategy: 'theoretical_framework' as const },
    { id: 'sec_ch1_1', heading: '1.1 Mô hình tự tổ chức', role: 'body' as const, usage: 'target' as const, strategy: 'theoretical_framework' as const },
    { id: 'sec_ch1_2', heading: '1.2 Các nghiên cứu liên quan', role: 'body' as const, usage: 'target' as const, strategy: 'theoretical_framework' as const },
    // Chapter 2
    { id: 'sec_ch2', heading: 'Chương 2: Phương pháp thực nghiệm', role: 'body' as const, usage: 'target' as const, strategy: 'quantitative_results' as const },
    { id: 'sec_ch2_1', heading: '2.1 Chọn mẫu và thiết kế', role: 'body' as const, usage: 'target' as const, strategy: 'quantitative_results' as const },
    // Chapter 3
    { id: 'sec_ch3', heading: 'Chương 3: Kết quả phân tích', role: 'body' as const, usage: 'target' as const, strategy: 'quantitative_results' as const },
    { id: 'sec_ch3_1', heading: '3.1 Số liệu thống kê', role: 'body' as const, usage: 'target' as const, strategy: 'quantitative_results' as const },
    // Back matter (excluded)
    { id: 'sec_bib', heading: 'Tài liệu tham khảo', role: 'references' as const, usage: 'skip' as const, strategy: 'skip' as const },
  ];

  // Batches
  const batches = [
    makeBatch('b_ch1', 'theoretical_framework', [
      { chunkId: 'c1', sectionId: 'sec_ch1', order: 1, text: 'Chương 1 nội dung.' },
      { chunkId: 'c2', sectionId: 'sec_ch1_1', order: 2, text: 'Chương 1.1 nội dung.' },
    ]),
    makeBatch('b_ch1_2', 'theoretical_framework', [
      { chunkId: 'c3', sectionId: 'sec_ch1_2', order: 3, text: 'Chương 1.2 nội dung.' },
    ]),
    makeBatch('b_ch2', 'quantitative_results', [
      { chunkId: 'c4', sectionId: 'sec_ch2', order: 4, text: 'Chương 2.' },
      { chunkId: 'c5', sectionId: 'sec_ch2_1', order: 5, text: 'Chương 2.1.' },
    ]),
    makeBatch('b_ch3', 'quantitative_results', [
      { chunkId: 'c6', sectionId: 'sec_ch3', order: 6, text: 'Chương 3.' },
      { chunkId: 'c7', sectionId: 'sec_ch3_1', order: 7, text: 'Chương 3.1.' },
    ]),
  ];

  const profile = makeProfile(docId, 'book_or_monograph', sections);
  const extractionPlan = makePlan(docId, 'book_or_monograph', sections);
  const evidenceBatchPlan: EvidenceBatchPlan = {
    documentId: docId,
    sourceLanguage: 'vi',
    researchType: 'book_or_monograph',
    batches,
    diagnostics: {
      inputChunkCount: 7,
      targetChunkCount: 7,
      skippedChunkCount: 0,
      missingSectionChunkCount: 0,
      duplicateChunkCount: 0,
      oversizedChunkCount: 0,
      batchCount: 4,
    },
  };

  const plan = planHierarchicalEvidence(profile, extractionPlan, evidenceBatchPlan);

  assert('T2: organizationMode === book_chapters', plan.organizationMode === 'book_chapters');
  assert('T2: workUnits count is 3', plan.workUnits.length === 3, `got ${plan.workUnits.length}`);
  assert('T2: work unit 1 label matches chapter 1 heading', plan.workUnits[0].label === 'Chương 1: Cơ sở lý thuyết giấc mơ');
  assert('T2: work unit 1 sectionIds count is 3', plan.workUnits[0].sectionIds.length === 3);
  assert('T2: work unit 1 chunkCount is 3', plan.workUnits[0].chunkCount === 3);
  assert('T2: work unit 1 targetChunkIds includes c1, c2, c3',
    plan.workUnits[0].targetChunkIds.includes('c1') &&
    plan.workUnits[0].targetChunkIds.includes('c2') &&
    plan.workUnits[0].targetChunkIds.includes('c3')
  );

  // Chapter 2
  assert('T2: work unit 2 label matches chapter 2 heading', plan.workUnits[1].label === 'Chương 2: Phương pháp thực nghiệm');
  assert('T2: work unit 2 chunkCount is 2', plan.workUnits[1].chunkCount === 2);

  // Excluded check
  const allSectionIdsInUnits = plan.workUnits.flatMap(wu => wu.sectionIds);
  assert('T2: front matter section NOT in units', !allSectionIdsInUnits.includes('sec_toc'));
  assert('T2: back matter section NOT in units', !allSectionIdsInUnits.includes('sec_bib'));

  // Coverage check
  assert('T2: diagnostics.targetChunkCount is 7', plan.diagnostics.targetChunkCount === 7);
  assert('T2: diagnostics.assignedChunkCount is 7', plan.diagnostics.assignedChunkCount === 7);
}

// ════════════════════════════════════════════════════════════════════════════════
// 3. Book Fallback: No major chapter heading
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Test 3: Book Fallback (No Major Chapter Headings) ---');
{
  const docId = 'book_fallback';
  const sections = [
    { id: 'sec_1', heading: 'Lý thuyết giấc mơ', role: 'body' as const, usage: 'target' as const, strategy: 'theoretical_framework' as const },
    { id: 'sec_2', heading: 'Thảo luận', role: 'discussion' as const, usage: 'target' as const, strategy: 'theoretical_framework' as const },
  ];

  const batches = [
    makeBatch('b1', 'theoretical_framework', [
      { chunkId: 'chk1', sectionId: 'sec_1', order: 1, text: 'Text 1' },
    ]),
    makeBatch('b2', 'theoretical_framework', [
      { chunkId: 'chk2', sectionId: 'sec_2', order: 2, text: 'Text 2' },
    ]),
  ];

  const profile = makeProfile(docId, 'book_or_monograph', sections);
  const extractionPlan = makePlan(docId, 'book_or_monograph', sections);
  const evidenceBatchPlan: EvidenceBatchPlan = {
    documentId: docId,
    sourceLanguage: 'en',
    researchType: 'book_or_monograph',
    batches,
    diagnostics: {
      inputChunkCount: 2,
      targetChunkCount: 2,
      skippedChunkCount: 0,
      missingSectionChunkCount: 0,
      duplicateChunkCount: 0,
      oversizedChunkCount: 0,
      batchCount: 2,
    },
  };

  const plan = planHierarchicalEvidence(profile, extractionPlan, evidenceBatchPlan);

  assert('T3: falls back to article_sections organizationMode', plan.organizationMode === 'article_sections');
  assert('T3: workUnits count is 2 (one per target section)', plan.workUnits.length === 2);
  assert('T3: work unit 1 label is section heading', plan.workUnits[0].label === 'Lý thuyết giấc mơ');
}

// ════════════════════════════════════════════════════════════════════════════════
// 4. Context-only / References-only: zero work units
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Test 4: Context / References Only ---');
{
  const docId = 'empty_doc';
  const sections = [
    { id: 'sec_abs', heading: 'Abstract', role: 'abstract' as const, usage: 'context' as const, strategy: 'skip' as const },
    { id: 'sec_ref', heading: 'References', role: 'references' as const, usage: 'skip' as const, strategy: 'skip' as const },
  ];

  const profile = makeProfile(docId, 'quantitative_empirical', sections);
  const extractionPlan = makePlan(docId, 'quantitative_empirical', sections);
  const evidenceBatchPlan: EvidenceBatchPlan = {
    documentId: docId,
    sourceLanguage: 'en',
    researchType: 'quantitative_empirical',
    batches: [],
    diagnostics: {
      inputChunkCount: 0,
      targetChunkCount: 0,
      skippedChunkCount: 0,
      missingSectionChunkCount: 0,
      duplicateChunkCount: 0,
      oversizedChunkCount: 0,
      batchCount: 0,
    },
  };

  const plan = planHierarchicalEvidence(profile, extractionPlan, evidenceBatchPlan);

  assert('T4: organizationMode === article_sections', plan.organizationMode === 'article_sections');
  assert('T4: zero work units created', plan.workUnits.length === 0);
  assert('T4: diagnostics.targetChunkCount is 0', plan.diagnostics.targetChunkCount === 0);
  assert('T4: diagnostics.assignedChunkCount is 0', plan.diagnostics.assignedChunkCount === 0);
}

// ════════════════════════════════════════════════════════════════════════════════
// 5. Determinism Check
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Test 5: Determinism ---');
{
  const docId = 'det_book';
  const sections = [
    { id: 'sec_ch1', heading: 'Chương 1: Cơ sở lý thuyết', role: 'body' as const, usage: 'target' as const, strategy: 'theoretical_framework' as const },
    { id: 'sec_ch1_1', heading: '1.1 Mô hình', role: 'body' as const, usage: 'target' as const, strategy: 'theoretical_framework' as const },
  ];
  const batches = [
    makeBatch('b1', 'theoretical_framework', [
      { chunkId: 'c1', sectionId: 'sec_ch1', order: 1, text: 'Chương 1' },
      { chunkId: 'c2', sectionId: 'sec_ch1_1', order: 2, text: 'Chương 1.1' },
    ]),
  ];

  const profile = makeProfile(docId, 'book_or_monograph', sections);
  const extractionPlan = makePlan(docId, 'book_or_monograph', sections);
  const evidenceBatchPlan: EvidenceBatchPlan = {
    documentId: docId,
    sourceLanguage: 'en',
    researchType: 'book_or_monograph',
    batches,
    diagnostics: {
      inputChunkCount: 2,
      targetChunkCount: 2,
      skippedChunkCount: 0,
      missingSectionChunkCount: 0,
      duplicateChunkCount: 0,
      oversizedChunkCount: 0,
      batchCount: 1,
    },
  };

  const plan1 = planHierarchicalEvidence(profile, extractionPlan, evidenceBatchPlan);
  const plan2 = planHierarchicalEvidence(profile, extractionPlan, evidenceBatchPlan);

  const json1 = JSON.stringify(plan1);
  const json2 = JSON.stringify(plan2);

  assert('T5: two runs produce identical JSON outputs', json1 === json2);
}

// ════════════════════════════════════════════════════════════════════════════════
// 6. Mixed Strategies in Chapter: strategy boundary split
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Test 6: Mixed Strategies in Book Chapter ---');
{
  const docId = 'mixed_book';
  const sections = [
    { id: 'sec_ch1', heading: 'Chương 1: Phân tích hỗn hợp', role: 'body' as const, usage: 'target' as const, strategy: 'theoretical_framework' as const },
    { id: 'sec_ch1_1', heading: '1.1 Khung lý thuyết', role: 'body' as const, usage: 'target' as const, strategy: 'theoretical_framework' as const },
    { id: 'sec_ch1_2', heading: '1.2 Kết quả khảo sát định lượng', role: 'body' as const, usage: 'target' as const, strategy: 'quantitative_results' as const },
  ];

  const batches = [
    makeBatch('b_theo', 'theoretical_framework', [
      { chunkId: 'c1', sectionId: 'sec_ch1', order: 1, text: 'Chương 1 lý thuyết' },
      { chunkId: 'c2', sectionId: 'sec_ch1_1', order: 2, text: 'Chương 1.1 khung' },
    ]),
    makeBatch('b_quant', 'quantitative_results', [
      { chunkId: 'c3', sectionId: 'sec_ch1_2', order: 3, text: 'Chương 1.2 kết quả định lượng' },
    ]),
  ];

  const profile = makeProfile(docId, 'book_or_monograph', sections);
  const extractionPlan = makePlan(docId, 'book_or_monograph', sections);
  const evidenceBatchPlan: EvidenceBatchPlan = {
    documentId: docId,
    sourceLanguage: 'en',
    researchType: 'book_or_monograph',
    batches,
    diagnostics: {
      inputChunkCount: 3,
      targetChunkCount: 3,
      skippedChunkCount: 0,
      missingSectionChunkCount: 0,
      duplicateChunkCount: 0,
      oversizedChunkCount: 0,
      batchCount: 2,
    },
  };

  const plan = planHierarchicalEvidence(profile, extractionPlan, evidenceBatchPlan);

  assert('T6: split into 2 work units due to strategy change within chapter 1', plan.workUnits.length === 2);
  assert('T6: work unit 1 label has strategy theoretical_framework', plan.workUnits[0].label === 'Chương 1: Phân tích hỗn hợp (theoretical_framework)');
  assert('T6: work unit 2 label has strategy quantitative_results', plan.workUnits[1].label === 'Chương 1: Phân tích hỗn hợp (quantitative_results)');
  assert('T6: work unit 1 chunkCount is 2', plan.workUnits[0].chunkCount === 2);
  assert('T6: work unit 2 chunkCount is 1', plan.workUnits[1].chunkCount === 1);
}

// ════════════════════════════════════════════════════════════════════════════════
// 7. Batch Invariants & Cross-Work-Unit Rejection
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Test 7: Batch Invariants & Cross-Work-Unit Rejection ---');
{
  const docId = 'invariants_doc';
  const sections = [
    { id: 'secA', heading: 'Section A', role: 'results' as const, usage: 'target' as const, strategy: 'quantitative_results' as const },
    { id: 'secB', heading: 'Section B', role: 'results' as const, usage: 'target' as const, strategy: 'quantitative_results' as const },
  ];

  const profile = makeProfile(docId, 'quantitative_empirical', sections);
  const extractionPlan = makePlan(docId, 'quantitative_empirical', sections);

  // Valid scenario: each section has its own batch
  const validBatches = [
    makeBatch('b_secA', 'quantitative_results', [
      { chunkId: 'c1', sectionId: 'secA', order: 1, text: 'A text' },
    ]),
    makeBatch('b_secB', 'quantitative_results', [
      { chunkId: 'c2', sectionId: 'secB', order: 2, text: 'B text' },
    ]),
  ];

  const validEvidenceBatchPlan: EvidenceBatchPlan = {
    documentId: docId,
    sourceLanguage: 'en',
    researchType: 'quantitative_empirical',
    batches: validBatches,
    diagnostics: {
      inputChunkCount: 2,
      targetChunkCount: 2,
      skippedChunkCount: 0,
      missingSectionChunkCount: 0,
      duplicateChunkCount: 0,
      oversizedChunkCount: 0,
      batchCount: 2,
    },
  };

  const plan = planHierarchicalEvidence(profile, extractionPlan, validEvidenceBatchPlan);
  assert('T7: every non-empty work unit has at least one batch', plan.workUnits.every(wu => wu.chunkCount === 0 || wu.batchCount > 0));
  
  const allAssignedBatches = plan.workUnits.flatMap(wu => wu.batchIds);
  assert('T7: all batch IDs are assigned exactly once', allAssignedBatches.length === 2 && new Set(allAssignedBatches).size === 2);
  
  const allAssignedChunks = plan.workUnits.flatMap(wu => wu.targetChunkIds);
  assert('T7: all target chunk IDs are assigned exactly once', allAssignedChunks.length === 2 && new Set(allAssignedChunks).size === 2);

  // Invalid scenario: a batch spans multiple sections (which resolve to different work units in article_sections mode)
  const invalidBatches = [
    makeBatch('b_cross', 'quantitative_results', [
      { chunkId: 'c1', sectionId: 'secA', order: 1, text: 'A text' },
      { chunkId: 'c2', sectionId: 'secB', order: 2, text: 'B text' },
    ]),
  ];

  const invalidEvidenceBatchPlan: EvidenceBatchPlan = {
    documentId: docId,
    sourceLanguage: 'en',
    researchType: 'quantitative_empirical',
    batches: invalidBatches,
    diagnostics: {
      inputChunkCount: 2,
      targetChunkCount: 2,
      skippedChunkCount: 0,
      missingSectionChunkCount: 0,
      duplicateChunkCount: 0,
      oversizedChunkCount: 0,
      batchCount: 1,
    },
  };

  let threw = false;
  try {
    planHierarchicalEvidence(profile, extractionPlan, invalidEvidenceBatchPlan);
  } catch (err: any) {
    if (err.message.includes('Invalid hierarchical evidence plan: batch spans multiple work units')) {
      threw = true;
    }
  }
  assert('T7: cross-work-unit batch is rejected and throws error', threw);
}

// ════════════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
console.log(`TOTAL TEST RESULT: ${testPassCount} PASSED, ${testFailCount} FAILED`);
console.log('══════════════════════════════════════════════════');

if (testFailCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
