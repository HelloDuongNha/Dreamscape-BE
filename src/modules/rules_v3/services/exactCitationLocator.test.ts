import mongoose from 'mongoose';
import { locateCitationInText } from './exactCitationLocator.service';
import KnowledgeRuleEvidenceV3 from '../../models/rulesV3/KnowledgeRuleEvidence';
import KnowledgeRuleV3 from '../../models/rulesV3/KnowledgeRule';

async function runTests() {
  console.log('--- STARTING PURE IN-MEMORY ASSERTIONS ---');
  
  let locatorPass = 0;
  let locatorFail = 0;
  let schemaPass = 0;
  let schemaFail = 0;

  function assertLocator(title: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`[LOCATOR PASS] ${title}`);
      locatorPass++;
    } else {
      console.error(`[LOCATOR FAIL] ${title} - ${details || 'Assertion failed'}`);
      locatorFail++;
    }
  }

  function assertSchema(title: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`[SCHEMA PASS] ${title}`);
      schemaPass++;
    } else {
      console.error(`[SCHEMA FAIL] ${title} - ${details || 'Assertion failed'}`);
      schemaFail++;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // I. LOCATOR ASSERTIONS (Keep all existing assertions)
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n=== I. LOCATOR BEHAVIOR TESTS ===');

  // Fixtures
  const mockChunkId = "507f1f77bcf86cd799439011";
  const englishText = "The effect of sleep position on dream experiences is well documented. First sleep position and second sleep position are compared.";
  const vietnameseText = "Nghiên cứu về Quy luật ảnh hưởng của tư thế ngủ đã được tiến hành.";
  const whitespaceText = "Sleeping on\n  stomach can cause\n  physical constraint in REM sleep. Prone position was preferred by 50 percent of subjects. Sleeping on stomach is associated with confinement dreams.";

  // 1. Exact English quote
  const res1 = locateCitationInText(mockChunkId, englishText, "The effect of sleep position on dream experiences");
  assertLocator("1. Exact English quote success", res1.success === true);
  if (res1.success) {
    assertLocator("1. Exact English offsets correct", res1.startOffset === 0 && res1.endOffset === 49);
    assertLocator("1. Exact English exactness correct", res1.exactness === 'canonical_exact');
  }

  // 2. Exact Vietnamese quote
  const res2 = locateCitationInText(mockChunkId, vietnameseText, "Quy luật ảnh hưởng của tư thế ngủ");
  assertLocator("2. Exact Vietnamese quote success", res2.success === true);
  if (res2.success) {
    assertLocator("2. Exact Vietnamese offsets correct", res2.startOffset === 14 && res2.endOffset === 47);
    assertLocator("2. Exact Vietnamese exactness correct", res2.exactness === 'canonical_exact');
  }

  // 3. Whitespace-only normalization
  const res3 = locateCitationInText(mockChunkId, whitespaceText, "sleeping on stomach can cause physical constraint");
  // Note: Whitespace matching must be case-sensitive, so "sleeping" (lowercase) vs "Sleeping" (uppercase) must be rejected.
  assertLocator("3. Whitespace normalization with case mismatch rejected", res3.success === false && res3.rejectionReason === 'missing');

  const res3_case_correct = locateCitationInText(mockChunkId, whitespaceText, "Sleeping on stomach can cause physical constraint");
  assertLocator("3. Whitespace normalization with exact case success", res3_case_correct.success === true);
  if (res3_case_correct.success) {
    assertLocator("3. Normalized offsets correct", res3_case_correct.startOffset === 0 && res3_case_correct.endOffset === 53);
    assertLocator("3. Sliced text matches exactly", whitespaceText.slice(res3_case_correct.startOffset, res3_case_correct.endOffset) === res3_case_correct.exactQuote);
    assertLocator("3. Sliced text includes linebreak", res3_case_correct.exactQuote.includes('\n'));
    assertLocator("3. Sliced exactness tag correct", res3_case_correct.exactness === 'canonical_exact');
  }

  // 4. Duplicate occurrence ambiguity
  const res4 = locateCitationInText(mockChunkId, englishText, "sleep position");
  assertLocator("4. Ambiguous quote rejected", res4.success === false && res4.rejectionReason === 'ambiguous');

  // 5. Missing text
  const res5 = locateCitationInText(mockChunkId, englishText, "eating before bed time");
  assertLocator("5. Missing quote rejected", res5.success === false && res5.rejectionReason === 'missing');

  // 6. Changed number rejected as missing
  const res6 = locateCitationInText(mockChunkId, whitespaceText, "Sleeping on stomach can cause physical constraint in REM sleep. Prone position was preferred by 60 percent of subjects.");
  assertLocator("6. Number change rejected as missing", res6.success === false && res6.rejectionReason === 'missing');

  // 7. Added/removed negation or phrase rejected as missing
  const res7_added = locateCitationInText(mockChunkId, whitespaceText, "Sleeping on stomach can not cause physical constraint");
  const res7_removed = locateCitationInText(mockChunkId, whitespaceText, "Sleeping on stomach is associated with dreams"); // missing "confinement" in proposed
  
  assertLocator("7. Added negation rejected as missing", res7_added.success === false && res7_added.rejectionReason === 'missing');
  assertLocator("7. Removed phrase rejected as missing", res7_removed.success === false && res7_removed.rejectionReason === 'missing');

  // 8. Translated quote rejected as missing
  const res8 = locateCitationInText(mockChunkId, whitespaceText, "Nằm sấp khi ngủ");
  assertLocator("8. Translation rejected as missing", res8.success === false && res8.rejectionReason === 'missing');

  // 9. Case-changed quote rejected as missing
  const res9 = locateCitationInText(mockChunkId, englishText, "the effect of sleep position");
  assertLocator("9. Case change rejected as missing", res9.success === false && res9.rejectionReason === 'missing');

  // 10. Punctuation-changed quote rejected as missing
  const res10 = locateCitationInText(mockChunkId, englishText, "The effect of sleep position on dream experiences, is well documented");
  assertLocator("10. Punctuation change rejected as missing", res10.success === false && res10.rejectionReason === 'missing');

  // 11. Empty/short/long quote
  const res11_empty = locateCitationInText(mockChunkId, englishText, "   ");
  const res11_short = locateCitationInText(mockChunkId, englishText, "short");
  const res11_long = locateCitationInText(mockChunkId, englishText, "A".repeat(1001));
  assertLocator("11. Empty quote rejected", res11_empty.success === false && res11_empty.rejectionReason === 'whitespace_only');
  assertLocator("11. Short quote rejected", res11_short.success === false && res11_short.rejectionReason === 'too_short');
  assertLocator("11. Long quote rejected", res11_long.success === false && res11_long.rejectionReason === 'too_long');

  // 12. Deterministic hashes
  const res12_a = locateCitationInText(mockChunkId, englishText, "The effect of sleep position on dream experiences");
  const res12_b = locateCitationInText(mockChunkId, englishText, "The effect of sleep position on dream experiences");
  if (res12_a.success && res12_b.success) {
    assertLocator("12. QuoteHash is deterministic", res12_a.quoteHash === res12_b.quoteHash);
    assertLocator("12. QuoteHash format is hex sha256", /^[a-f0-9]{64}$/.test(res12_a.quoteHash));
  } else {
    assertLocator("12. QuoteHash testing failed", false);
  }

  // 13. exactQuote equals chunkText.slice(startOffset, endOffset)
  if (res3_case_correct.success) {
    const sliced = whitespaceText.slice(res3_case_correct.startOffset, res3_case_correct.endOffset);
    assertLocator("13. exactQuote matches chunk text slice", sliced === res3_case_correct.exactQuote);
  } else {
    assertLocator("13. exactQuote slice verification failed", false);
  }

  // 14. Verify unique compound index in memory
  const indexes = KnowledgeRuleEvidenceV3.schema.indexes();
  const hasUniqueCompound = indexes.some((idx: any) => {
    const fields = idx[0];
    const opts = idx[1];
    return (
      fields.ruleId === 1 &&
      fields.chunkId === 1 &&
      fields.chunkContentHash === 1 &&
      fields.startOffset === 1 &&
      fields.endOffset === 1 &&
      fields.stance === 1 &&
      opts.unique === true
    );
  });
  assertLocator("14. Unique compound index metadata verified in schema", hasUniqueCompound);

  // 15. Verify paths schema
  const paths = KnowledgeRuleV3.schema.paths as any;
  assertLocator("15. Schema: relationType does not exist", paths.relationType === undefined);
  assertLocator("15. Schema: direction does not exist", paths.direction === undefined);
  assertLocator("15. Schema: causality does not exist", paths.causality === undefined);
  
  assertLocator("15. Schema: claimType exists", paths.claimType !== undefined);
  if (paths.claimType) {
    const claimTypeEnums = paths.claimType.enumValues;
    const expectedClaimTypes = [
      'association',
      'prediction',
      'intervention_effect',
      'moderation',
      'mediation',
      'qualitative_theme',
      'theoretical_proposition',
      'review_synthesis',
      'null_finding'
    ];
    assertLocator("15. Schema: claimType has all 9 correct enums", 
      claimTypeEnums.length === 9 &&
      expectedClaimTypes.every((e: string) => claimTypeEnums.includes(e))
    );
  }
  
  assertLocator("15. Schema: effectPolarity exists", paths.effectPolarity !== undefined);
  if (paths.effectPolarity) {
    const polarityEnums = paths.effectPolarity.enumValues;
    const expectedPolarities = ['positive', 'negative', 'mixed', 'neutral', 'unknown'];
    assertLocator("15. Schema: effectPolarity has all 5 correct enums", 
      polarityEnums.length === 5 &&
      expectedPolarities.every((e: string) => polarityEnums.includes(e))
    );
  }
  
  assertLocator("15. Schema: evidenceInterpretation exists", paths.evidenceInterpretation !== undefined);
  if (paths.evidenceInterpretation) {
    const interpEnums = paths.evidenceInterpretation.enumValues;
    const expectedInterps = ['causal', 'associational', 'predictive', 'descriptive', 'interpretive', 'not_applicable'];
    assertLocator("15. Schema: evidenceInterpretation has all 6 correct enums", 
      interpEnums.length === 6 &&
      expectedInterps.every((e: string) => interpEnums.includes(e))
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // II. IN-MEMORY SCHEMA VALIDATION TESTS
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n=== II. IN-MEMORY SCHEMA VALIDATION TESTS ===');

  function testValidation(data: any): any {
    const doc = new KnowledgeRuleV3({
      ruleCode: 'KR3_TEST1234',
      status: 'pending',
      sourceLanguage: 'en',
      statement: 'Statement text here.',
      claimType: 'association',
      effectPolarity: 'positive',
      evidenceInterpretation: 'associational',
      subject: 'subject',
      outcome: 'outcome',
      dedupKey: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', // 64-char valid hex
      certaintyTier: 'moderate',
      evidenceScore: 50,
      ...data
    });
    return doc.validateSync();
  }

  // 1. association + causal fails validation
  const errCausal = testValidation({ claimType: 'association', evidenceInterpretation: 'causal' });
  assertSchema("1. association + causal fails validation", errCausal !== undefined && errCausal.errors['evidenceInterpretation'] !== undefined);

  // 2. association + associational passes
  const errAssoc = testValidation({ claimType: 'association', evidenceInterpretation: 'associational' });
  assertSchema("2. association + associational passes", errAssoc === undefined, errAssoc?.message);

  // 3. qualitative_theme with evidenceScore 70 passes
  const errQual = testValidation({ claimType: 'qualitative_theme', evidenceInterpretation: 'descriptive', evidenceScore: 70 });
  assertSchema("3. qualitative_theme with evidenceScore 70 passes", errQual === undefined, errQual?.message);

  // 4. theoretical_proposition with evidenceScore 50 passes
  const errTheo = testValidation({ claimType: 'theoretical_proposition', evidenceInterpretation: 'interpretive', evidenceScore: 50 });
  assertSchema("4. theoretical_proposition with evidenceScore 50 passes", errTheo === undefined, errTheo?.message);

  // 5. null_finding is accepted
  const errNull = testValidation({ claimType: 'null_finding', evidenceInterpretation: 'descriptive', effectPolarity: 'neutral' });
  assertSchema("5. null_finding is accepted", errNull === undefined, errNull?.message);

  // 6. evidenceScore below 0 and above 100 fail
  const errUnder = testValidation({ evidenceScore: -1 });
  const errOver = testValidation({ evidenceScore: 101 });
  assertSchema("6. evidenceScore below 0 fails", errUnder !== undefined && errUnder.errors['evidenceScore'] !== undefined);
  assertSchema("6. evidenceScore above 100 fails", errOver !== undefined && errOver.errors['evidenceScore'] !== undefined);

  // 7. invalid/non-64-character dedupKey fails
  const errShortDedup = testValidation({ dedupKey: 'a'.repeat(63) });
  const errLongDedup = testValidation({ dedupKey: 'a'.repeat(65) });
  const errNonHexDedup = testValidation({ dedupKey: 'g'.repeat(64) });
  assertSchema("7. dedupKey 63 chars fails", errShortDedup !== undefined && errShortDedup.errors['dedupKey'] !== undefined);
  assertSchema("7. dedupKey 65 chars fails", errLongDedup !== undefined && errLongDedup.errors['dedupKey'] !== undefined);
  assertSchema("7. dedupKey non-hex fails", errNonHexDedup !== undefined && errNonHexDedup.errors['dedupKey'] !== undefined);

  // 8. valid 64-character SHA-256 dedupKey passes
  const errValidDedup = testValidation({ dedupKey: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' });
  assertSchema("8. valid 64-character SHA-256 dedupKey passes", errValidDedup === undefined, errValidDedup?.message);

  // 9. schema.indexes() contains the unique { sourceLanguage: 1, dedupKey: 1 } index
  const rulesIndexes = KnowledgeRuleV3.schema.indexes();
  const hasUniqueDedupIndex = rulesIndexes.some((idx: any) => {
    const fields = idx[0];
    const opts = idx[1];
    return fields.sourceLanguage === 1 && fields.dedupKey === 1 && opts.unique === true;
  });
  assertSchema("9. unique { sourceLanguage, dedupKey } index exists", hasUniqueDedupIndex);

  // 10. Async validation must execute document middleware without requiring a callback.
  const asyncValidationDoc = new KnowledgeRuleV3({
    ruleCode: 'KR3_ASYNC01',
    status: 'pending',
    sourceLanguage: 'en',
    statement: 'Async middleware validation contract.',
    claimType: 'association',
    effectPolarity: 'neutral',
    evidenceInterpretation: 'associational',
    subject: 'subject',
    outcome: 'outcome',
    conditions: ['  retained condition  ', ''],
    limitations: [],
    dreamFeatureTags: [],
    classifications: [],
    dedupKey: 'b'.repeat(64),
    certaintyTier: 'weak',
    evidenceScore: 0,
    supportingSourceCount: 0,
    contradictingSourceCount: 0,
    version: 1
  });
  try {
    await asyncValidationDoc.validate();
    assertSchema(
      '10. async validation middleware runs and normalizes arrays',
      asyncValidationDoc.conditions.length === 1 && asyncValidationDoc.conditions[0] === 'retained condition'
    );
  } catch (error: any) {
    assertSchema('10. async validation middleware runs and normalizes arrays', false, error?.message);
  }

  console.log('\n======================================');
  console.log(`LOCATOR ASSERTIONS: ${locatorPass} PASSED, ${locatorFail} FAILED`);
  console.log(`SCHEMA ASSERTIONS:  ${schemaPass} PASSED, ${schemaFail} FAILED`);
  console.log('======================================');

  if (locatorFail > 0 || schemaFail > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
