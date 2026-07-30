import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateRagCase,
  evaluateRagCases,
} from '../scripts/lib/ragEvaluationMetrics';

test('RAG metrics separate retrieval, generation, citation and privacy results', () => {
  const result = evaluateRagCase({
    id: 'rag-metric-test',
    relevantContextIds: ['rule-1', 'rule-2'],
    retrievedContextIds: ['noise', 'rule-1'],
    forbiddenContextIds: ['private-dream'],
    claims: [
      { text: 'Supported claim', citationIds: ['rule-1'], supported: true },
      { text: 'Unsupported claim', citationIds: [], supported: false },
    ],
    answerRelevance: 0.75,
  });
  assert.equal(result.precisionAtK, 0.5);
  assert.equal(result.recallAtK, 0.5);
  assert.equal(result.reciprocalRank, 0.5);
  assert.equal(result.faithfulness, 0.5);
  assert.equal(result.citationTraceability, 0.5);
  assert.equal(result.privacyPass, true);
  assert.equal(result.answerRelevance, 0.75);
});

test('RAG summary reports privacy leakage separately from quality', () => {
  const summary = evaluateRagCases([{
    id: 'privacy-test',
    relevantContextIds: ['rule-1'],
    retrievedContextIds: ['rule-1', 'private-dream'],
    forbiddenContextIds: ['private-dream'],
    claims: [{ text: 'Supported claim', citationIds: ['rule-1'], supported: true }],
  }]);
  assert.equal(summary.macroRecallAtK, 1);
  assert.equal(summary.macroFaithfulness, 1);
  assert.equal(summary.privacyPassRate, 0);
});
