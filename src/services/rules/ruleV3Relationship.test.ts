import assert from 'node:assert/strict';
import { classifyRuleV3Relationship } from './ruleV3Relationship.service';

const base = { subject: 'waking-life stress', outcome: 'threatening dream content', claimType: 'association', effectPolarity: 'positive', conditions: ['during periods of stress'] };
assert.equal(classifyRuleV3Relationship(base, {
  subject: 'stress in waking life', outcome: 'threat content in dreams', claimType: 'association', effectPolarity: 'positive', conditions: ['during stress periods']
}), 'equivalent');
assert.equal(classifyRuleV3Relationship(base, {
  subject: 'threatening dream content', outcome: 'waking-life stress', claimType: 'association', effectPolarity: 'positive', conditions: ['during periods of stress']
}), 'reverse_direction');
assert.equal(classifyRuleV3Relationship(base, {
  subject: 'waking-life stress', outcome: 'threatening dream content', claimType: 'association', effectPolarity: 'negative', conditions: ['during periods of stress']
}), 'contradictory');
assert.equal(classifyRuleV3Relationship(base, {
  subject: 'waking-life stress', outcome: 'threatening dream content', claimType: 'null_finding', effectPolarity: 'neutral', conditions: ['during periods of stress']
}), 'contradictory');
assert.equal(classifyRuleV3Relationship(base, {
  subject: 'waking-life stress', outcome: 'threatening dream content', claimType: 'association', effectPolarity: 'positive', conditions: ['only among children with fever']
}), 'overlapping');
assert.equal(classifyRuleV3Relationship(base, {
  subject: 'sleep duration', outcome: 'dream recall', claimType: 'association', effectPolarity: 'positive', conditions: []
}), 'unrelated');
console.log('RULE V3 RELATIONSHIPS: 6 PASSED, 0 FAILED');
