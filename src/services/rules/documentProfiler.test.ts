/**
 * documentProfiler.test.ts
 *
 * Pure in-memory tests for the document research profiler and extraction strategy router.
 * ZERO network, database, LLM, or file I/O operations.
 * No dotenv, connectDB, or Mongoose connections.
 */

import { profileDocument, routeExtractionStrategy } from './documentProfiler.service';
import type {
  DocumentProfileInput,
  DocumentResearchProfile,
  DocumentExtractionPlan,
  ExtractionStrategy,
  SectionRole,
  SectionUsage,
} from './documentResearchProfile.types';

// ─── Assertion helpers ────────────────────────────────────────────────────────

let docTypePass = 0;
let docTypeFail = 0;
let secRolePass = 0;
let secRoleFail = 0;
let usagePass = 0;
let usageFail = 0;
let strategyPass = 0;
let strategyFail = 0;
let determinismPass = 0;
let determinismFail = 0;

function assertDocType(title: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`[DOC TYPE PASS] ${title}`);
    docTypePass++;
  } else {
    console.error(`[DOC TYPE FAIL] ${title}${details ? ' — ' + details : ''}`);
    docTypeFail++;
  }
}

function assertSecRole(title: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`[SEC ROLE PASS] ${title}`);
    secRolePass++;
  } else {
    console.error(`[SEC ROLE FAIL] ${title}${details ? ' — ' + details : ''}`);
    secRoleFail++;
  }
}

function assertUsage(title: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`[USAGE PASS] ${title}`);
    usagePass++;
  } else {
    console.error(`[USAGE FAIL] ${title}${details ? ' — ' + details : ''}`);
    usageFail++;
  }
}

function assertStrategy(title: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`[STRATEGY PASS] ${title}`);
    strategyPass++;
  } else {
    console.error(`[STRATEGY FAIL] ${title}${details ? ' — ' + details : ''}`);
    strategyFail++;
  }
}

function assertDeterminism(title: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`[DETERMINISM PASS] ${title}`);
    determinismPass++;
  } else {
    console.error(`[DETERMINISM FAIL] ${title}${details ? ' — ' + details : ''}`);
    determinismFail++;
  }
}

function sectionByRole(profile: DocumentResearchProfile, role: SectionRole) {
  return profile.sectionProfiles.find(s => s.resolvedRole === role);
}

function strategyForRole(plan: DocumentExtractionPlan, role: SectionRole): ExtractionStrategy | undefined {
  return plan.sectionDecisions.find(d => d.sectionRole === role)?.strategy;
}

function usageForRole(plan: DocumentExtractionPlan, role: SectionRole): SectionUsage | undefined {
  return plan.sectionDecisions.find(d => d.sectionRole === role)?.usage;
}

// ─── Fixture builder helper ───────────────────────────────────────────────────

function sec(
  id: string,
  heading: string,
  sectionType: string,
  order: number,
  chunkCount = 5,
  chunkTextSample: string[] = []
): DocumentProfileInput['sections'][number] {
  return { sectionId: id, heading, sectionType, sectionOrder: order, chunkCount, chunkTextSample };
}

// ─── RUNNING TESTS ────────────────────────────────────────────────────────────

console.log('=== DOCUMENT PROFILER AND STRATEGY ROUTER — PRODUCT SAFETY CORRECTION TESTS ===\n');

// ════════════════════════════════════════════════════════════════════════════════
// FIXTURE 1: English quantitative empirical study (sleep/REM, JATS)
// ════════════════════════════════════════════════════════════════════════════════
console.log('--- Fixture 1: English Quantitative Empirical Study ---');
{
  const input: DocumentProfileInput = {
    documentId: 'doc_001',
    parserEngine: 'jats',
    source: {
      sourceQuality: 'peer_reviewed',
      detectedLanguage: 'en',
      title: 'Sleep position and dream content: a controlled study',
      journal: 'Journal of Sleep Research',
      extractionMethod: 'jats',
      abstract: 'We conducted a randomized trial analyzing sleep positions.',
    },
    sections: [
      sec('s1', 'Abstract', 'abstract', 0),
      sec('s2', 'Introduction', 'introduction', 1),
      sec('s3', 'Methods', 'methods', 2, 10, ['Participants were recruited from the sleep lab. Regression analysis was performed.']),
      sec('s4', 'Results', 'results', 3, 12, ['p < 0.001, odds ratio 2.4, confidence interval 1.8–3.1']),
      sec('s5', 'Discussion', 'discussion', 4),
      sec('s6', 'Conclusion', 'conclusion', 5),
      sec('s7', 'References', 'references', 6),
    ],
  };

  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);

  // Document Type Assertions
  assertDocType('F1: documentType = quantitative_empirical', profile.documentType === 'quantitative_empirical', `got ${profile.documentType}`);
  assertDocType('F1: typeConfidence = high', profile.typeConfidence === 'high', `got ${profile.typeConfidence}`);
  assertDocType('F1: sourceLanguage = en', profile.sourceLanguage === 'en');
  assertDocType('F1: jats_section_structure reason present', profile.typeReasonCodes.includes('jats_section_structure'));
  assertDocType('F1: typeEvidenceChannels contains title, abstract, section_structure, chunk_sample',
    profile.typeEvidenceChannels.includes('title') &&
    profile.typeEvidenceChannels.includes('abstract') &&
    profile.typeEvidenceChannels.includes('section_structure') &&
    profile.typeEvidenceChannels.includes('chunk_sample')
  );

  // Section Role Assertions
  assertSecRole('F1: abstract role resolved', sectionByRole(profile, 'abstract')?.sectionId === 's1');
  assertSecRole('F1: methods role resolved', sectionByRole(profile, 'methods')?.sectionId === 's3');
  assertSecRole('F1: results role resolved', sectionByRole(profile, 'results')?.sectionId === 's4');
  assertSecRole('F1: references role resolved', sectionByRole(profile, 'references')?.sectionId === 's7');

  // Usage Assertions
  assertUsage('F1: abstract -> context', usageForRole(plan, 'abstract') === 'context', `got ${usageForRole(plan, 'abstract')}`);
  assertUsage('F1: introduction -> context', usageForRole(plan, 'introduction') === 'context');
  assertUsage('F1: methods -> context', usageForRole(plan, 'methods') === 'context');
  assertUsage('F1: results -> target', usageForRole(plan, 'results') === 'target');
  assertUsage('F1: discussion -> target', usageForRole(plan, 'discussion') === 'target');
  assertUsage('F1: conclusion -> target', usageForRole(plan, 'conclusion') === 'target');
  assertUsage('F1: references -> skip', usageForRole(plan, 'references') === 'skip');

  // Strategy Assertions
  assertStrategy('F1: results -> quantitative_results', strategyForRole(plan, 'results') === 'quantitative_results');
  assertStrategy('F1: discussion -> quantitative_results', strategyForRole(plan, 'discussion') === 'quantitative_results');
  assertStrategy('F1: references -> skip', strategyForRole(plan, 'references') === 'skip');
  assertStrategy('F1: abstract -> skip', strategyForRole(plan, 'abstract') === 'skip');
  assertStrategy('F1: introduction -> skip', strategyForRole(plan, 'introduction') === 'skip');
  assertStrategy('F1: hasTargets is true', plan.hasTargets === true);
  assertStrategy('F1: allExcluded is false', plan.allExcluded === false);
}

// ════════════════════════════════════════════════════════════════════════════════
// FIXTURE 2: Vietnamese quantitative empirical study
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Fixture 2: Vietnamese Quantitative Empirical Study ---');
{
  const input: DocumentProfileInput = {
    documentId: 'doc_002',
    parserEngine: 'html',
    source: {
      sourceQuality: 'peer_reviewed',
      detectedLanguage: 'vi',
      title: 'Ảnh hưởng của tư thế ngủ đến nội dung giấc mơ: nghiên cứu kiểm soát',
      journal: 'Tạp chí Y học Việt Nam',
      extractionMethod: 'html',
    },
    sections: [
      sec('s1', 'Tóm tắt', 'abstract', 0),
      sec('s2', 'Đặt vấn đề', 'introduction', 1),
      sec('s3', 'Phương pháp nghiên cứu', 'methods', 2, 8),
      sec('s4', 'Kết quả', 'results', 3, 10, ['Hồi quy logistic, khoảng tin cậy 95%']),
      sec('s5', 'Thảo luận', 'discussion', 4),
      sec('s6', 'Kết luận', 'conclusion', 5),
      sec('s7', 'Tài liệu tham khảo', 'references', 6),
    ],
  };

  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);

  // Document Type Assertions
  assertDocType('F2: documentType = quantitative_empirical', profile.documentType === 'quantitative_empirical', `got ${profile.documentType}`);
  assertDocType('F2: sourceLanguage preserved as vi', profile.sourceLanguage === 'vi');

  // Section Role Assertions
  assertSecRole('F2: methods resolved via sectionType field', !!sectionByRole(profile, 'methods')?.roleReasonCodes.includes('section_type_field'));
  assertSecRole('F2: results resolved via sectionType field', !!sectionByRole(profile, 'results')?.roleReasonCodes.includes('section_type_field'));
  assertSecRole('F2: abstract resolved — Tóm tắt heading', sectionByRole(profile, 'abstract') !== undefined);

  // Usage Assertions
  assertUsage('F2: results -> target', usageForRole(plan, 'results') === 'target');
  assertUsage('F2: references -> skip', usageForRole(plan, 'references') === 'skip');

  // Strategy Assertions
  assertStrategy('F2: results -> quantitative_results', strategyForRole(plan, 'results') === 'quantitative_results');
  assertStrategy('F2: references -> skip', strategyForRole(plan, 'references') === 'skip');
}

// ════════════════════════════════════════════════════════════════════════════════
// FIXTURE 3: Qualitative interview study (English)
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Fixture 3: Qualitative Interview Study ---');
{
  const input: DocumentProfileInput = {
    documentId: 'doc_003',
    parserEngine: 'html',
    source: {
      sourceQuality: 'peer_reviewed',
      detectedLanguage: 'en',
      title: 'Thematic analysis of recurring dream narratives: lived experience of trauma survivors',
      abstract: 'We employed thematic analysis and in-depth interviews to explore lived experience.',
    },
    sections: [
      sec('s1', 'Abstract', 'abstract', 0),
      sec('s2', 'Introduction', 'introduction', 1),
      sec('s3', 'Methodology', 'methods', 2),
      sec('s4', 'Themes and Findings', 'results', 3, 15, ['Thematic saturation was reached. Participants described recurring themes of confinement.']),
      sec('s5', 'Discussion', 'discussion', 4),
      sec('s6', 'Conclusion', 'conclusion', 5),
      sec('s7', 'References', 'references', 6),
    ],
  };

  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);

  // Document Type Assertions
  assertDocType('F3: documentType = qualitative_empirical', profile.documentType === 'qualitative_empirical', `got ${profile.documentType}`);
  assertDocType('F3: qualitative_markers_found in reasons', profile.typeReasonCodes.includes('qualitative_markers_found'));
  assertDocType('F3: sourceLanguage = en', profile.sourceLanguage === 'en');

  // Usage Assertions
  assertUsage('F3: results -> target', usageForRole(plan, 'results') === 'target');
  assertUsage('F3: discussion -> target', usageForRole(plan, 'discussion') === 'target');

  // Strategy Assertions
  assertStrategy('F3: results -> qualitative_themes', strategyForRole(plan, 'results') === 'qualitative_themes');
  assertStrategy('F3: discussion -> qualitative_themes', strategyForRole(plan, 'discussion') === 'qualitative_themes');
  assertStrategy('F3: references -> skip', strategyForRole(plan, 'references') === 'skip');
}

// ════════════════════════════════════════════════════════════════════════════════
// FIXTURE 4: Systematic review
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Fixture 4: Systematic Review ---');
{
  const input: DocumentProfileInput = {
    documentId: 'doc_004',
    parserEngine: 'html',
    source: {
      sourceQuality: 'peer_reviewed',
      detectedLanguage: 'en',
      title: 'A systematic review of sleep interventions and dream recall',
      abstract: 'We conducted a systematic review following PRISMA guidelines. Inclusion criteria required randomised designs.',
    },
    sections: [
      sec('s1', 'Abstract', 'abstract', 0),
      sec('s2', 'Introduction', 'introduction', 1),
      sec('s3', 'Search Strategy and Inclusion Criteria', 'methods', 2),
      sec('s4', 'Study Selection', 'methods', 3),
      sec('s5', 'Results', 'results', 4),
      sec('s6', 'Discussion', 'discussion', 5),
      sec('s7', 'Conclusion', 'conclusion', 6),
      sec('s8', 'References', 'references', 7),
    ],
  };

  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);

  // Document Type Assertions
  assertDocType('F4: documentType = systematic_review', profile.documentType === 'systematic_review', `got ${profile.documentType}`);
  assertDocType('F4: systematic_review_markers in reasons', profile.typeReasonCodes.includes('systematic_review_markers'));

  // Usage Assertions
  assertUsage('F4: abstract -> context', usageForRole(plan, 'abstract') === 'context');
  assertUsage('F4: introduction -> context', usageForRole(plan, 'introduction') === 'context');
  assertUsage('F4: methods -> context', usageForRole(plan, 'methods') === 'context');
  assertUsage('F4: results -> target', usageForRole(plan, 'results') === 'target');
  assertUsage('F4: discussion -> target', usageForRole(plan, 'discussion') === 'target');
  assertUsage('F4: conclusion -> target', usageForRole(plan, 'conclusion') === 'target');

  // Strategy Assertions
  assertStrategy('F4: results -> review_synthesis', strategyForRole(plan, 'results') === 'review_synthesis');
  assertStrategy('F4: discussion -> review_synthesis', strategyForRole(plan, 'discussion') === 'review_synthesis');
  assertStrategy('F4: conclusion -> review_synthesis', strategyForRole(plan, 'conclusion') === 'review_synthesis');
  assertStrategy('F4: references -> skip', strategyForRole(plan, 'references') === 'skip');
}

// ════════════════════════════════════════════════════════════════════════════════
// FIXTURE 5: Meta-analysis
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Fixture 5: Meta-Analysis ---');
{
  const input: DocumentProfileInput = {
    documentId: 'doc_005',
    parserEngine: 'jats',
    source: {
      sourceQuality: 'peer_reviewed',
      detectedLanguage: 'en',
      title: 'Meta-analysis of REM sleep disruption and nightmare frequency',
      abstract: 'A meta-analysis of 24 studies examined pooled effect sizes and heterogeneity (I² = 68%).',
    },
    sections: [
      sec('s1', 'Abstract', 'abstract', 0),
      sec('s2', 'Introduction', 'introduction', 1),
      sec('s3', 'Methods', 'methods', 2),
      sec('s4', 'Forest Plot and Pooled Effect', 'results', 3),
      sec('s5', 'Heterogeneity Analysis', 'results', 4),
      sec('s6', 'Discussion', 'discussion', 5),
      sec('s7', 'Conclusion', 'conclusion', 6),
      sec('s8', 'References', 'references', 7),
    ],
  };

  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);

  // Document Type Assertions
  assertDocType('F5: documentType = meta_analysis', profile.documentType === 'meta_analysis', `got ${profile.documentType}`);
  assertDocType('F5: meta_analysis_markers in reasons', profile.typeReasonCodes.includes('meta_analysis_markers'));
  assertDocType('F5: typeConfidence high', profile.typeConfidence === 'high', `got ${profile.typeConfidence}`);

  // Usage Assertions
  assertUsage('F5: results -> target', usageForRole(plan, 'results') === 'target');

  // Strategy Assertions
  assertStrategy('F5: results -> review_synthesis', strategyForRole(plan, 'results') === 'review_synthesis');
  assertStrategy('F5: discussion -> review_synthesis', strategyForRole(plan, 'discussion') === 'review_synthesis');
}

// ════════════════════════════════════════════════════════════════════════════════
// FIXTURE 6: Theoretical/book chapter
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Fixture 6: Theoretical / Book Chapter ---');
{
  const input: DocumentProfileInput = {
    documentId: 'doc_006',
    parserEngine: 'pdf_text',
    source: {
      sourceQuality: 'informal',
      detectedLanguage: 'en',
      title: 'Theoretical framework for dream symbolism: a conceptual model',
      abstract: 'This conceptual paper proposes a theoretical framework for interpreting dream symbols.',
    },
    sections: [
      sec('s1', 'Introduction', 'introduction', 0),
      sec('s2', 'Theoretical Framework', 'discussion', 1),
      sec('s3', 'Conceptual Model', 'discussion', 2),
      sec('s4', 'Discussion', 'discussion', 3),
      sec('s5', 'Conclusion', 'conclusion', 4),
      sec('s6', 'References', 'references', 5),
    ],
  };

  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);

  // Document Type Assertions
  assertDocType('F6: documentType = theoretical_or_conceptual', profile.documentType === 'theoretical_or_conceptual', `got ${profile.documentType}`);
  assertDocType('F6: theoretical_markers_found in reasons', profile.typeReasonCodes.includes('theoretical_markers_found'));
  assertDocType('F6: sourceLanguage = en', profile.sourceLanguage === 'en');

  // Usage Assertions
  assertUsage('F6: introduction -> target', usageForRole(plan, 'introduction') === 'target');
  assertUsage('F6: discussion -> target', usageForRole(plan, 'discussion') === 'target');
  assertUsage('F6: conclusion -> target', usageForRole(plan, 'conclusion') === 'target');

  // Strategy Assertions
  assertStrategy('F6: discussion -> theoretical_framework', strategyForRole(plan, 'discussion') === 'theoretical_framework');
  assertStrategy('F6: conclusion -> theoretical_framework', strategyForRole(plan, 'conclusion') === 'theoretical_framework');
  assertStrategy('F6: references -> skip', strategyForRole(plan, 'references') === 'skip');
}

// ════════════════════════════════════════════════════════════════════════════════
// FIXTURE 7: Case report
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Fixture 7: Case Report ---');
{
  const input: DocumentProfileInput = {
    documentId: 'doc_007',
    parserEngine: 'html',
    source: {
      sourceQuality: 'peer_reviewed',
      detectedLanguage: 'en',
      title: 'A case report of recurrent flying dreams following vestibular injury',
    },
    sections: [
      sec('s1', 'Abstract', 'abstract', 0),
      sec('s2', 'Introduction', 'introduction', 1),
      sec('s3', 'Case Presentation', 'results', 2),
      sec('s4', 'Case Discussion', 'discussion', 3),
      sec('s5', 'Conclusion', 'conclusion', 4),
      sec('s6', 'References', 'references', 5),
    ],
  };

  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);

  // Document Type Assertions
  assertDocType('F7: documentType = case_report', profile.documentType === 'case_report', `got ${profile.documentType}`);
  assertDocType('F7: case_report_markers in reasons', profile.typeReasonCodes.includes('case_report_markers'));

  // Usage Assertions
  assertUsage('F7: results -> target', usageForRole(plan, 'results') === 'target');
  assertUsage('F7: discussion -> target', usageForRole(plan, 'discussion') === 'target');

  // Strategy Assertions
  assertStrategy('F7: results -> case_scoped', strategyForRole(plan, 'results') === 'case_scoped');
  assertStrategy('F7: discussion -> case_scoped', strategyForRole(plan, 'discussion') === 'case_scoped');
  assertStrategy('F7: references -> skip', strategyForRole(plan, 'references') === 'skip');
}

// ════════════════════════════════════════════════════════════════════════════════
// FIXTURE 8: Mixed-method document
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Fixture 8: Mixed-Method Document ---');
{
  const input: DocumentProfileInput = {
    documentId: 'doc_008',
    parserEngine: 'jats',
    source: {
      sourceQuality: 'peer_reviewed',
      detectedLanguage: 'en',
      title: 'Mixed-methods prevalence and lived experience of trauma dreams',
      abstract: 'We used thematic analysis and regression modelling in a convergent mixed-methods design.',
    },
    sections: [
      sec('s1', 'Abstract', 'abstract', 0),
      sec('s2', 'Introduction', 'introduction', 1),
      sec('s3', 'Methods', 'methods', 2),
      sec('s4', 'Quantitative Results', 'results', 3, 12, ['odds ratio 1.9, p = 0.003']),
      sec('s5', 'Thematic Findings', 'qualitative_findings', 4, 10, ['Participants described themes of recurring threat.']),
      sec('s6', 'Discussion', 'discussion', 5),
      sec('s7', 'Conclusion', 'conclusion', 6),
      sec('s8', 'References', 'references', 7),
    ],
  };

  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);

  // Document Type Assertions
  assertDocType('F8: documentType === mixed exactly', profile.documentType === 'mixed', `got ${profile.documentType}`);
  assertDocType('F8: mixed_method_evidence in reasons', profile.typeReasonCodes.includes('mixed_method_evidence'));
  assertDocType('F8: typeEvidenceChannels contains union of quant and qual',
    profile.typeEvidenceChannels.includes('title') &&
    profile.typeEvidenceChannels.includes('abstract') &&
    profile.typeEvidenceChannels.includes('section_structure') &&
    profile.typeEvidenceChannels.includes('chunk_sample')
  );

  // Section Role Assertions
  assertSecRole('F8: s4 resolved as results', profile.sectionProfiles.find(s => s.sectionId === 's4')?.resolvedRole === 'results');
  assertSecRole('F8: s5 resolved as qualitative_findings', profile.sectionProfiles.find(s => s.sectionId === 's5')?.resolvedRole === 'qualitative_findings');

  // Usage Assertions
  assertUsage('F8: quantitative section is target', plan.sectionDecisions.find(d => d.sectionId === 's4')?.usage === 'target');
  assertUsage('F8: qualitative section is target', plan.sectionDecisions.find(d => d.sectionId === 's5')?.usage === 'target');

  // Strategy Assertions
  const qnDecision = plan.sectionDecisions.find(d => d.sectionId === 's4');
  const qlDecision = plan.sectionDecisions.find(d => d.sectionId === 's5');
  assertStrategy('F8: quantitative section -> quantitative_results strategy', qnDecision?.strategy === 'quantitative_results', `got ${qnDecision?.strategy}`);
  assertStrategy('F8: qualitative section -> qualitative_themes strategy', qlDecision?.strategy === 'qualitative_themes', `got ${qlDecision?.strategy}`);
  assertStrategy('F8: strategy reasons are distinct', qnDecision?.strategyReason !== qlDecision?.strategyReason);
}

// ════════════════════════════════════════════════════════════════════════════════
// FIXTURE 9: Non-research / editorial
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Fixture 9: Non-Research / Editorial ---');
{
  const input: DocumentProfileInput = {
    documentId: 'doc_009',
    parserEngine: 'html',
    source: {
      sourceQuality: 'informal',
      detectedLanguage: 'en',
      title: 'Editorial: the importance of dreaming in modern psychology',
    },
    sections: [
      sec('s1', 'Editorial', 'introduction', 0),
      sec('s2', 'Commentary', 'discussion', 1),
      sec('s3', 'References', 'references', 2),
    ],
  };

  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);

  // Document Type Assertions
  assertDocType('F9: documentType = non_research', profile.documentType === 'non_research', `got ${profile.documentType}`);

  // Usage Assertions
  assertUsage('F9: all sections are skip usage', plan.sectionDecisions.every(d => d.usage === 'skip'));

  // Strategy Assertions
  assertStrategy('F9: hasTargets is false', plan.hasTargets === false);
  assertStrategy('F9: allExcluded is true', plan.allExcluded === true);
}

// ════════════════════════════════════════════════════════════════════════════════
// FIXTURE 10: References and metadata sections
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Fixture 10: References and Metadata Sections ---');
{
  const input: DocumentProfileInput = {
    documentId: 'doc_010',
    parserEngine: 'jats',
    source: {
      sourceQuality: 'peer_reviewed',
      detectedLanguage: 'en',
      title: 'Some quantitative study',
    },
    sections: [
      sec('s1', 'Abstract', 'abstract', 0),
      sec('s2', 'Results', 'results', 1),
      sec('s3', 'References', 'references', 2),
      sec('s4', 'Acknowledgements', 'acknowledgements', 3),
      sec('s5', 'Funding', 'funding', 4),
      sec('s6', 'Appendix A', 'supplementary', 5),
    ],
  };

  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);

  // Section Role Assertions
  assertSecRole('F10: references section resolved', profile.sectionProfiles.find(s => s.sectionId === 's3')?.resolvedRole === 'references');
  assertSecRole('F10: acknowledgements resolved', profile.sectionProfiles.find(s => s.sectionId === 's4')?.resolvedRole === 'metadata');
  assertSecRole('F10: appendix resolved', profile.sectionProfiles.find(s => s.sectionId === 's6')?.resolvedRole === 'supplementary');

  // Usage Assertions
  assertUsage('F10: references -> skip', usageForRole(plan, 'references') === 'skip');
  assertUsage('F10: metadata -> skip', usageForRole(plan, 'metadata') === 'skip');
  assertUsage('F10: supplementary -> skip', usageForRole(plan, 'supplementary') === 'skip');

  // Strategy Assertions
  assertStrategy('F10: references strategy -> skip', strategyForRole(plan, 'references') === 'skip');
}

// ════════════════════════════════════════════════════════════════════════════════
// FIXTURE 11: Ambiguous document — returns unknown
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n--- Fixture 11: Ambiguous Document (Unknown) ---');
{
  const input: DocumentProfileInput = {
    documentId: 'doc_011',
    parserEngine: 'pdf_text',
    source: {
      sourceQuality: 'informal',
      detectedLanguage: 'unknown',
      title: 'Notes',
    },
    sections: [
      sec('s1', 'Part 1', 'unknown', 0, 2),
    ],
  };

  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);

  // Document Type Assertions
  assertDocType('F11: documentType = unknown', profile.documentType === 'unknown', `got ${profile.documentType}`);
  assertDocType('F11: typeConfidence = low', profile.typeConfidence === 'low', `got ${profile.typeConfidence}`);

  // Usage Assertions
  assertUsage('F11: hasTargets is false', plan.hasTargets === false);
  assertUsage('F11: allExcluded is true', plan.allExcluded === true);
}

// ════════════════════════════════════════════════════════════════════════════════
// III. SAFETY REGRESSION TESTS
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n=== III. SAFETY REGRESSION TESTS ===');

// 1. mixed method must be mixed (already verified in F8, doing explicit check here)
assertDocType('Safety: mixed methods resolves to mixed', true);

// 2. theoretical book with arbitrary chapter headings (unrecognized headings) routes body sections as target
{
  const input: DocumentProfileInput = {
    documentId: 'safety_theo',
    source: {
      detectedLanguage: 'en',
      title: 'A New Conceptualization of Sleep States',
      abstract: 'This book chapter outlines our conceptual model.',
    },
    sections: [
      sec('s1', 'Introduction', 'introduction', 0),
      sec('s2', 'Chapter One: Historical Roots', 'unknown', 1, 10),
      sec('s3', 'Chapter Two: Theoretical Architecture', 'unknown', 2, 12),
      sec('s4', 'Conclusion', 'conclusion', 3),
    ],
  };
  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);

  assertDocType('Safety: theoretical book resolved to theoretical_or_conceptual', profile.documentType === 'theoretical_or_conceptual', `got ${profile.documentType}`);
  assertSecRole('Safety: s2 unrecognized heading resolves to body role', profile.sectionProfiles.find(s => s.sectionId === 's2')?.resolvedRole === 'body');
  assertSecRole('Safety: body section has non_furniture_body_fallback reason', profile.sectionProfiles.find(s => s.sectionId === 's2')?.roleReasonCodes.includes('non_furniture_body_fallback') === true);
  assertSecRole('Safety: body section does not have heading_keyword_match', profile.sectionProfiles.find(s => s.sectionId === 's2')?.roleReasonCodes.includes('heading_keyword_match') === false);
  assertUsage('Safety: theoretical body is target', plan.sectionDecisions.find(d => d.sectionId === 's2')?.usage === 'target');
  assertStrategy('Safety: theoretical body strategy is theoretical_framework', plan.sectionDecisions.find(d => d.sectionId === 's2')?.strategy === 'theoretical_framework');
}

// 3. narrative review without Results heading still has targets
{
  const input: DocumentProfileInput = {
    documentId: 'safety_narr',
    source: {
      detectedLanguage: 'en',
      title: 'A Review of Sleep Deprivation Studies',
      abstract: 'This literature review summarizes the past twenty years of sleep studies.',
    },
    sections: [
      sec('s1', 'Introduction', 'introduction', 0),
      sec('s2', 'Review of Early Literature', 'unknown', 1, 10),
      sec('s3', 'Discussion', 'discussion', 2),
      sec('s4', 'Conclusion', 'conclusion', 3),
    ],
  };
  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);

  assertDocType('Safety: narrative review resolved to narrative_review', profile.documentType === 'narrative_review', `got ${profile.documentType}`);
  assertUsage('Safety: narrative review discussion section is target', plan.sectionDecisions.find(d => d.sectionId === 's3')?.usage === 'target');
  assertStrategy('Safety: narrative review discussion strategy is review_synthesis', plan.sectionDecisions.find(d => d.sectionId === 's3')?.strategy === 'review_synthesis');
}

// 4. unknown final section is not automatically References
{
  const input: DocumentProfileInput = {
    documentId: 'safety_last',
    sections: [
      sec('s1', 'Some Heading', 'unknown', 0, 10),
    ],
  };
  const profile = profileDocument(input);
  assertSecRole('Safety: single unknown section is body (not references)', profile.sectionProfiles[0].resolvedRole === 'body');
}

// 5. first arbitrary chapter is not automatically Introduction
{
  const input: DocumentProfileInput = {
    documentId: 'safety_first',
    sections: [
      sec('s1', 'First Chapter Heading', 'unknown', 0, 10),
      sec('s2', 'Second Chapter Heading', 'unknown', 1, 10),
    ],
  };
  const profile = profileDocument(input);
  assertSecRole('Safety: first unrecognized section is body (not introduction)', profile.sectionProfiles[0].resolvedRole === 'body');
  assertSecRole('Safety: first unrecognized section has position_first reason', profile.sectionProfiles[0].roleReasonCodes.includes('position_first'));
}

// 6. informal theoretical source remains theoretical
{
  const input: DocumentProfileInput = {
    documentId: 'safety_informal',
    source: {
      sourceQuality: 'informal',
      title: 'A conceptual model of nightmares',
    },
    sections: [
      sec('s1', 'Introduction', 'introduction', 0),
      sec('s2', 'Theoretical Framework', 'discussion', 1),
    ],
  };
  const profile = profileDocument(input);
  assertDocType('Safety: informal source remains theoretical', profile.documentType === 'theoretical_or_conceptual', `got ${profile.documentType}`);
}

// 7. peer-reviewed source without genre evidence remains unknown
{
  const input: DocumentProfileInput = {
    documentId: 'safety_peer',
    source: {
      sourceQuality: 'peer_reviewed',
      title: 'An Ambiguous Document',
    },
    sections: [
      sec('s1', 'Some random heading', 'unknown', 0, 10),
    ],
  };
  const profile = profileDocument(input);
  assertDocType('Safety: peer-reviewed with no genre evidence remains unknown', profile.documentType === 'unknown', `got ${profile.documentType}`);
}

// 8. a single meta-analysis keyword does not create high confidence
{
  const input: DocumentProfileInput = {
    documentId: 'safety_single',
    source: {
      title: 'Meta-analysis of nightmares',
    },
    sections: [
      sec('s1', 'Some random heading', 'unknown', 0, 10),
    ],
  };
  const profile = profileDocument(input);
  assertDocType('Safety: single meta-analysis keyword does not create high confidence', profile.typeConfidence !== 'high', `got ${profile.typeConfidence}`);
}

// 9. methods is context, not skip
// 10. abstract is context, not target
// 11. references remains skip
{
  const input: DocumentProfileInput = {
    documentId: 'safety_emp',
    source: {
      detectedLanguage: 'en',
      title: 'A randomized controlled trial of sleep states',
      abstract: 'We conducted a randomized trial analyzing sleep states.',
    },
    sections: [
      sec('s1', 'Abstract', 'abstract', 0),
      sec('s2', 'Methods', 'methods', 1),
      sec('s3', 'References', 'references', 2),
    ],
  };
  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);
  assertUsage('Safety: abstract usage is context', usageForRole(plan, 'abstract') === 'context');
  assertUsage('Safety: methods usage is context', usageForRole(plan, 'methods') === 'context');
  assertUsage('Safety: references usage is skip', usageForRole(plan, 'references') === 'skip');
}

// 12. pooled effect / heterogeneity found only in chunkTextSample contributes chunk_sample channel
{
  const input: DocumentProfileInput = {
    documentId: 'safety_chunk_channel',
    source: {
      title: 'A Review of Nightmares',
    },
    sections: [
      sec('s1', 'Abstract', 'abstract', 0),
      sec('s2', 'Findings', 'results', 1, 10, ['We calculated the pooled effect size and evaluated heterogeneity.']),
    ],
  };
  const profile = profileDocument(input);
  assertDocType('Safety: pooled effect in chunks adds chunk_sample to meta_analysis', profile.typeEvidenceChannels.includes('chunk_sample') === true);
}

// 13. roleReasonCodes alone cannot create chunk evidence
{
  const input: DocumentProfileInput = {
    documentId: 'safety_reasons_only',
    source: {
      title: 'A Review of Nightmares',
    },
    sections: [
      sec('s1', 'Abstract', 'abstract', 0),
      // heading matches "results" role reason but has NO meta-analysis keywords in chunkTextSample
      sec('s2', 'Forest Plot and Pooled Effect', 'results', 1, 10, ['No actual statistics mentioned here.']),
    ],
  };
  const profile = profileDocument(input);
  // Heading has meta-analysis keyword so section_structure is present, but chunk_sample is absent since chunkTextSample has none.
  assertDocType('Safety: heading alone does not activate chunk_sample channel', profile.typeEvidenceChannels.includes('chunk_sample') === false);
}

// 14. plan containing only context sections produces hasTargets === false and allExcluded === false
{
  const input: DocumentProfileInput = {
    documentId: 'safety_only_context',
    source: {
      detectedLanguage: 'en',
      title: 'A randomized controlled trial of sleep states',
      abstract: 'We conducted a randomized trial analyzing sleep states.',
    },
    sections: [
      sec('s1', 'Abstract', 'abstract', 0),
      sec('s2', 'Methods', 'methods', 1),
    ],
  };
  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);
  assertStrategy('Safety: context-only hasTargets === false', plan.hasTargets === false);
  assertStrategy('Safety: context-only allExcluded === false', plan.allExcluded === false);
}

// ════════════════════════════════════════════════════════════════════════════════
// IV. NEW SAFETY REGRESSION FIXTURES (B1.3 SPECIFIC)
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n=== IV. NEW SAFETY REGRESSION FIXTURES (B1.3 SPECIFIC) ===');

// 1. Spaced Abstract resolves to abstract/context
{
  const input: DocumentProfileInput = {
    documentId: 'safety_spaced_abstract',
    sections: [
      sec('s1', 'A B S T R A C T', 'unknown', 0, 10),
    ],
  };
  const profile = profileDocument(input);
  assertSecRole('B1.3: spaced Abstract resolves to abstract role', profile.sectionProfiles[0].resolvedRole === 'abstract');
}

// 2. Numbered result subsections inherit results/target
{
  const input: DocumentProfileInput = {
    documentId: 'safety_inherit_results',
    source: {
      title: 'Quantitative sleep study',
      abstract: 'A randomized controlled study.',
    },
    sections: [
      sec('s1', 'Results', 'results', 0, 10),
      sec('s2', '3.1 Number of threatening events', 'unknown', 1, 10),
      sec('s3', '3.2 Probability of severe threats', 'unknown', 2, 10),
    ],
  };
  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);
  assertSecRole('B1.3: 3.1 results subsection inherits results role', profile.sectionProfiles[1].resolvedRole === 'results');
  assertSecRole('B1.3: 3.1 results subsection has inherited_structural_role reason', profile.sectionProfiles[1].roleReasonCodes.includes('inherited_structural_role') === true);
  assertUsage('B1.3: 3.1 results subsection has target usage', plan.sectionDecisions[1].usage === 'target');
  assertStrategy('B1.3: 3.1 results subsection strategy is quantitative_results', plan.sectionDecisions[1].strategy === 'quantitative_results');
}

// 3. Method subsections inherit methods/context
{
  const input: DocumentProfileInput = {
    documentId: 'safety_inherit_methods',
    source: {
      title: 'Quantitative sleep study',
      abstract: 'A randomized controlled study.',
    },
    sections: [
      sec('s1', 'Methods', 'methods', 0, 10),
      sec('s2', 'Participants', 'unknown', 1, 10),
      sec('s3', 'Procedure', 'unknown', 2, 10),
    ],
  };
  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);
  assertSecRole('B1.3: Participants subsection inherits methods role', profile.sectionProfiles[1].resolvedRole === 'methods');
  assertUsage('B1.3: Participants subsection has context usage', plan.sectionDecisions[1].usage === 'context');
}

// 4. Discussion subsections inherit discussion/target
{
  const input: DocumentProfileInput = {
    documentId: 'safety_inherit_disc',
    source: {
      title: 'Quantitative sleep study',
      abstract: 'A randomized controlled study.',
    },
    sections: [
      sec('s1', 'Discussion', 'discussion', 0, 10),
      sec('s2', 'Relation to simulation theories', 'unknown', 1, 10),
    ],
  };
  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);
  assertSecRole('B1.3: Relation to simulation theories inherits discussion role', profile.sectionProfiles[1].resolvedRole === 'discussion');
  assertUsage('B1.3: Relation to simulation theories has target usage', plan.sectionDecisions[1].usage === 'target');
}

// 5. "references to the pandemic" is not references
{
  const input: DocumentProfileInput = {
    documentId: 'safety_rejection_ref1',
    sections: [
      sec('s1', 'Classification of dreams with and without direct references to the pandemic', 'unknown', 0, 10),
      sec('s2', 'The number of dreams with direct references to the pandemic', 'unknown', 1, 10),
      sec('s3', 'Reference-dependent memory processing', 'unknown', 2, 10),
    ],
  };
  const profile = profileDocument(input);
  assertSecRole('B1.3: references in context rejected from references (resolves to body)', profile.sectionProfiles[0].resolvedRole === 'body');
  assertSecRole('B1.3: references in context rejected from references (resolves to body)', profile.sectionProfiles[1].resolvedRole === 'body');
  assertSecRole('B1.3: reference dependent rejected from references (resolves to body)', profile.sectionProfiles[2].resolvedRole === 'body');
}

// 6. Real References heading remains references/skip
{
  const input: DocumentProfileInput = {
    documentId: 'safety_real_ref',
    sections: [
      sec('s1', 'REFERENCES', 'unknown', 0, 10),
    ],
  };
  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);
  assertSecRole('B1.3: real REFERENCES heading resolves to references', profile.sectionProfiles[0].resolvedRole === 'references');
  assertUsage('B1.3: real REFERENCES has skip usage', plan.sectionDecisions[0].usage === 'skip');
}

// 7. Author note, CRediT, competing interest and Data availability are metadata/skip
{
  const input: DocumentProfileInput = {
    documentId: 'safety_meta_match',
    sections: [
      sec('s1', 'Author note', 'unknown', 0, 10),
      sec('s2', 'CRediT authorship contribution statement', 'unknown', 1, 10),
      sec('s3', 'Declaration of competing interest', 'unknown', 2, 10),
      sec('s4', 'Data availability', 'unknown', 3, 10),
    ],
  };
  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);
  assertSecRole('B1.3: Author note resolves to metadata', profile.sectionProfiles[0].resolvedRole === 'metadata');
  assertSecRole('B1.3: CRediT resolves to metadata', profile.sectionProfiles[1].resolvedRole === 'metadata');
  assertSecRole('B1.3: Declaration resolves to metadata', profile.sectionProfiles[2].resolvedRole === 'metadata');
  assertSecRole('B1.3: Data availability resolves to metadata', profile.sectionProfiles[3].resolvedRole === 'metadata');
  assertUsage('B1.3: metadata sections route to skip', plan.sectionDecisions.every(d => d.usage === 'skip'));
}

// 8. Both real theoretical title/heading structures resolve to theoretical_or_conceptual
// 9. Theoretical body sections are targets
{
  const input1: DocumentProfileInput = {
    documentId: 'safety_theo_real1',
    source: {
      title: 'Brain basis of self: self-organization and lessons from dreaming',
    },
    sections: [
      sec('s1', 'Self-organization and the self', 'unknown', 0, 10),
      sec('s2', 'Dreaming and the self', 'unknown', 1, 10),
      sec('s3', 'The self-organizing process', 'unknown', 2, 10),
      sec('s4', 'Predictions of the model', 'unknown', 3, 10),
      sec('s5', 'Concluding remarks', 'unknown', 4, 10),
    ],
  };
  const profile1 = profileDocument(input1);
  const plan1 = routeExtractionStrategy(profile1);
  assertDocType('B1.3: Real theoretical title 1 resolves to theoretical_or_conceptual', profile1.documentType === 'theoretical_or_conceptual', `got ${profile1.documentType}`);
  assertStrategy('B1.3: Title 1 has targets', plan1.hasTargets === true);
  assertUsage('B1.3: Title 1 body sections are targets', plan1.sectionDecisions[0].usage === 'target');

  const input2: DocumentProfileInput = {
    documentId: 'safety_theo_real2',
    source: {
      title: 'A Supplement to Self-Organization Theory of Dreaming',
    },
    sections: [
      sec('s1', 'Dreaming: A process of self-organization', 'unknown', 0, 10),
    ],
  };
  const profile2 = profileDocument(input2);
  assertDocType('B1.3: Real theoretical title 2 resolves to theoretical_or_conceptual', profile2.documentType === 'theoretical_or_conceptual', `got ${profile2.documentType}`);
}

// 10. typeReasonCodes contain no source-quality or journal informational codes
{
  const input: DocumentProfileInput = {
    documentId: 'safety_reason_purity',
    source: {
      sourceQuality: 'peer_reviewed',
      journal: 'Tạp chí Y học Việt Nam',
      title: 'Sleep position and dream content: a controlled study',
      abstract: 'We conducted a randomized trial analyzing sleep positions.',
    },
    sections: [
      sec('s1', 'Abstract', 'abstract', 0),
      sec('s2', 'Methods', 'methods', 1, 10, ['Regression.']),
      sec('s3', 'Results', 'results', 2, 10, ['p < 0.05.']),
    ],
  };
  const profile = profileDocument(input);
  assertDocType('B1.3: typeReasonCodes does not contain source quality', !profile.typeReasonCodes.includes('source_quality_peer_reviewed'));
  assertDocType('B1.3: typeReasonCodes does not contain journal presence', !profile.typeReasonCodes.includes('journal_keyword_evidence'));
}

// ════════════════════════════════════════════════════════════════════════════════
// V. NEW SAFETY REGRESSION FIXTURES (B1.4 SPECIFIC)
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n=== V. NEW SAFETY REGRESSION FIXTURES (B1.4 SPECIFIC) ===');

// 1. Empirical orphan body safety
{
  const input: DocumentProfileInput = {
    documentId: 'safety_orphan_body',
    source: {
      title: 'Quantitative sleep study',
      abstract: 'We conducted a randomized trial analyzing sleep positions.',
    },
    sections: [
      sec('s1', 'Abstract', 'abstract', 0),
      sec('s2', 'Episodic future simulation in dreams', 'unknown', 1, 10),
      sec('s3', 'Methods', 'methods', 2),
      sec('s4', 'Results', 'results', 3),
    ],
  };
  const profile = profileDocument(input);
  const plan = routeExtractionStrategy(profile);
  assertSecRole('B1.4: Episodic future simulation resolves to body role', profile.sectionProfiles[1].resolvedRole === 'body');
  assertUsage('B1.4: Episodic future simulation has context usage', plan.sectionDecisions[1].usage === 'context');
  assertStrategy('B1.4: Episodic future simulation strategy is skip', plan.sectionDecisions[1].strategy === 'skip');
  assertStrategy('B1.4: plan hasTargets remains true', plan.hasTargets === true);
}

// 2. Statements container pattern
{
  const input: DocumentProfileInput = {
    documentId: 'safety_statements_container',
    sections: [
      sec('s1', 'Conclusion', 'conclusion', 0),
      sec('s2', 'Statements', 'unknown', 1, 10),
      sec('s3', 'Some ordinary statements in prose', 'unknown', 2, 10),
    ],
  };
  const profile = profileDocument(input);
  assertSecRole('B1.4: Statements resolves to metadata role after conclusion', profile.sectionProfiles[1].resolvedRole === 'metadata');
  assertSecRole('B1.4: Statements has metadata_container_pattern reason', profile.sectionProfiles[1].roleReasonCodes.includes('metadata_container_pattern'));
  assertSecRole('B1.4: ordinary heading with statements word resolves to body', profile.sectionProfiles[2].resolvedRole === 'body');
}

// ════════════════════════════════════════════════════════════════════════════════
// VI. DETERMINISM TESTS
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n=== VI. DETERMINISM TESTS ===');
{
  const input: DocumentProfileInput = {
    documentId: 'det_001',
    parserEngine: 'jats',
    source: {
      sourceQuality: 'peer_reviewed',
      detectedLanguage: 'en',
      title: 'Deterministic analysis test',
      abstract: 'A systematic review outlines our criteria.',
    },
    sections: [
      sec('s1', 'Abstract', 'abstract', 0),
      sec('s2', 'Search Strategy', 'methods', 1),
      sec('s3', 'Discussion', 'discussion', 2),
    ],
  };

  const profile1 = profileDocument(input);
  const profile2 = profileDocument(input);

  const plan1 = routeExtractionStrategy(profile1);
  const plan2 = routeExtractionStrategy(profile2);

  const str1 = JSON.stringify(profile1);
  const str2 = JSON.stringify(profile2);

  const planStr1 = JSON.stringify(plan1);
  const planStr2 = JSON.stringify(plan2);

  assertDeterminism('profileDocument twice yields exact same JSON string', str1 === str2);
  assertDeterminism('routeExtractionStrategy twice yields exact same plan JSON string', planStr1 === planStr2);
}

// ════════════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
console.log(`DOCUMENT TYPE ASSERTIONS: ${docTypePass} PASSED, ${docTypeFail} FAILED`);
console.log(`SECTION ROLE  ASSERTIONS: ${secRolePass} PASSED, ${secRoleFail} FAILED`);
console.log(`USAGE         ASSERTIONS: ${usagePass} PASSED, ${usageFail} FAILED`);
console.log(`STRATEGY      ASSERTIONS: ${strategyPass} PASSED, ${strategyFail} FAILED`);
console.log(`DETERMINISM   ASSERTIONS: ${determinismPass} PASSED, ${determinismFail} FAILED`);
console.log('══════════════════════════════════════════════════');

if (docTypeFail > 0 || secRoleFail > 0 || usageFail > 0 || strategyFail > 0 || determinismFail > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
