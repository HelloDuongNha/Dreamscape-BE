import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dreamLexicalOverlap,
  scoreDreamSimilarity,
} from '../src/modules/dream/services/analysis/retrieval/similarDreamRetrieval.service';
import {
  classifyRuleApplicationTier,
  inferRuleQueryLanguage,
  rankRuleV3Candidates,
} from '../src/modules/rules_v3/services/retrieval/ruleV3RetrievalRanking.service';
import {
  evidenceGapRuleSimilarity,
  oracleEvidenceClaimClusterKey,
} from '../src/shared/evidence/evidenceClaimMatching';
import {
  estimatePdfImportSeconds,
  type PdfImportTimingSample,
} from '../src/modules/academic/services/ingestion/pdf/pdfImportProgress.service';

test('similar dream scoring keeps exact matches at the maximum score', () => {
  assert.equal(scoreDreamSimilarity({
    exact: true,
    semantic: 0.1,
    lexicalOverlap: 0.1,
  }), 1);
});

test('similar dream scoring uses the production 85/15 weighting', () => {
  const score = scoreDreamSimilarity({
    exact: false,
    semantic: 0.8,
    lexicalOverlap: 0.4,
  });
  assert.equal(score, 0.74);
});

test('lexical overlap normalises Vietnamese case and punctuation', () => {
  assert.equal(
    dreamLexicalOverlap('Tôi thấy NƯỚC, trường học và một cây cầu.', 'nước trường học'),
    1,
  );
});

test('evidence matching recognises the same bilingual relation', () => {
  const vietnamese = 'Lập kế hoạch hành động có thể làm giảm căng thẳng.';
  const english = 'Action planning may support stress reduction.';
  assert.ok(evidenceGapRuleSimilarity(vietnamese, english) >= 0.5);
  assert.equal(
    oracleEvidenceClaimClusterKey(vietnamese),
    'relation:action-planning__outcome:stress-reduction',
  );
});

test('evidence matching limits claims from different relation clusters', () => {
  const score = evidenceGapRuleSimilarity(
    'Lập kế hoạch hành động có thể làm giảm căng thẳng.',
    'Weak associations during dreaming may support creative thinking.',
  );
  assert.ok(score <= 0.24);
});

test('rule retrieval ranks the applicable matching rule first', () => {
  const rules = [
    {
      _id: 'rule-matching',
      statement: 'Threat dreams can reflect fear and avoidance.',
      subject: 'threat dream',
      outcome: 'fear',
      conditions: [],
      dreamFeatureTags: ['threat', 'fear', 'being chased'],
      embedding: [1, 0],
      evidenceScore: 80,
      supportingSourceCount: 2,
      sourceLanguage: 'en',
    },
    {
      _id: 'rule-unrelated',
      statement: 'Memory may support future event construction.',
      subject: 'memory',
      outcome: 'future event',
      conditions: [],
      dreamFeatureTags: ['memory', 'future'],
      embedding: [0, 1],
      evidenceScore: 95,
      supportingSourceCount: 3,
      sourceLanguage: 'en',
    },
  ];
  const ranked = rankRuleV3Candidates(
    rules,
    'I was chased and felt fear in the dream.',
    [1, 0],
    'en',
  );
  assert.equal(String(ranked[0]?.rule._id), 'rule-matching');
  assert.ok(ranked[0].score > 0.5);
});

test('rule tier requires both score and independent source breadth', () => {
  assert.equal(classifyRuleApplicationTier({
    evidenceScore: 80,
    supportingSourceCount: 1,
  }), 'exploratory');
  assert.equal(classifyRuleApplicationTier({
    evidenceScore: 60,
    supportingSourceCount: 2,
  }), 'supported');
  assert.equal(inferRuleQueryLanguage('Tôi mơ thấy nước và trường học'), 'vi');
});

test('PDF ETA uses the first-run non-OCR heuristic', () => {
  assert.equal(estimatePdfImportSeconds({
    pageCount: 10,
    fileSizeBytes: 0,
    ocrExpected: false,
  }), 24);
});

test('PDF ETA gives matching successful history most of the weight', () => {
  const history: PdfImportTimingSample[] = [{
    durationMs: 100_000,
    estimatedDurationSeconds: 24,
    pageCount: 10,
    fileSizeBytes: 0,
    ocrUsed: false,
    succeeded: true,
    completedAt: new Date('2026-07-30T00:00:00Z'),
  }];
  assert.equal(estimatePdfImportSeconds({
    pageCount: 10,
    fileSizeBytes: 0,
    ocrExpected: false,
    history,
  }), 81);
});
