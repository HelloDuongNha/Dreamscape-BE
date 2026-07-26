import assert from 'node:assert/strict';
import { scoreRuleV3 } from './ruleV3Scoring.service';

const baseRule = {
  statement: 'Dream content is associated with waking-life emotional concerns.',
  subject: 'waking-life emotional concerns',
  outcome: 'dream content',
  claimType: 'association',
  effectPolarity: 'unknown',
  evidenceInterpretation: 'associational',
  conditions: ['during sleep'],
  limitations: ['single study'],
  dreamFeatureTags: ['dream content', 'emotion']
};
const directQuote = 'Dream content is associated with waking-life emotional concerns.';

const oneSource = scoreRuleV3(baseRule, [
  { sourceId: 's1', chunkId: 'c1', stance: 'supports', exactness: 'canonical_exact', verificationScore: 1, exactQuote: directQuote, researchType: 'quantitative_empirical', researchTypeConfidence: 'high', sourceQuality: 'peer_reviewed' }
]);
assert.equal(oneSource.evidenceScore, 59);
assert.equal(oneSource.oracleUsefulnessScore, 100);
assert.equal(oneSource.oracleEligible, false);
assert.equal(oneSource.certaintyTier, 'limited');
assert.equal(oneSource.semanticSupportLevel, 'direct');
assert.equal(oneSource.scoreCriteria.map(item => String(item.key)).includes('semantic_support'), false);
assert.match(oneSource.scoreCriteria[0].reason, /1 tài liệu độc lập/u);
assert.match(oneSource.scoreCriteria[1].reason, /1 cụm dẫn chứng/u);

const corroborated = scoreRuleV3(baseRule, [
  { sourceId: 's1', chunkId: 'c1', stance: 'supports', exactness: 'canonical_exact', verificationScore: 1, exactQuote: directQuote, researchType: 'quantitative_empirical', researchTypeConfidence: 'high', sourceQuality: 'peer_reviewed' },
  { sourceId: 's2', chunkId: 'c2', stance: 'supports', exactness: 'canonical_exact', verificationScore: 1, exactQuote: directQuote, researchType: 'quantitative_empirical', researchTypeConfidence: 'high', sourceQuality: 'peer_reviewed' },
  { sourceId: 's3', chunkId: 'c3', stance: 'supports', exactness: 'canonical_exact', verificationScore: 1, exactQuote: directQuote, researchType: 'quantitative_empirical', researchTypeConfidence: 'high', sourceQuality: 'peer_reviewed' }
]);
assert.equal(corroborated.evidenceScore, 97);
assert.equal(corroborated.independentSourceCount, 3);
assert.equal(corroborated.certaintyTier, 'strong');

const noEvidence = scoreRuleV3(baseRule, []);
assert.equal(noEvidence.evidenceScore, 0);
assert.equal(noEvidence.oracleEligible, false);
assert.equal(noEvidence.applicationReadiness, 'not_usable');

const conflicting = scoreRuleV3(baseRule, [
  { sourceId: 's1', chunkId: 'c1', stance: 'supports', exactness: 'canonical_exact', verificationScore: 1, exactQuote: directQuote, researchType: 'quantitative_empirical', researchTypeConfidence: 'high', sourceQuality: 'peer_reviewed' },
  { sourceId: 's2', chunkId: 'c2', stance: 'refutes', exactness: 'canonical_exact', verificationScore: 1, exactQuote: directQuote }
]);
assert.equal(conflicting.evidenceScore, 57);
assert.equal(conflicting.certaintyTier, 'mixed');
assert.equal(conflicting.scoreCriteria.length, 5);

console.log('RULE V3 SCORING: 16 PASSED, 0 FAILED');
