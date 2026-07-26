import assert from 'node:assert/strict';
import { assessRuleV3MergeCompatibility, buildRuleV3ConceptClusters, buildRuleV3MergeClusters, classifyRuleV3Relationship } from './ruleV3Relationship.service';
import { findRuleV3MergeGroup } from './ruleV3Merge.service';

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
assert.equal(classifyRuleV3Relationship({
  subject: 'dreaming', outcome: 'reality simulation', statement: 'Dreaming is described as a form of reality simulation.', claimType: 'theoretical_proposition', effectPolarity: 'neutral'
}, {
  subject: 'dream simulations', outcome: 'incorporation of waking-life elements', statement: 'Dream simulations incorporate themes and memories from waking experience.', claimType: 'theoretical_proposition', effectPolarity: 'neutral'
}), 'complementary');
assert.equal(classifyRuleV3Relationship({
  subject: 'future-related dreams', outcome: 'highly implausible scenarios', statement: 'Future-related dreams are often highly implausible.', claimType: 'association', effectPolarity: 'neutral'
}, {
  subject: 'dream simulations', outcome: 'realistic waking-life analogue', statement: 'Dream simulations are relatively realistic analogues of waking perception.', claimType: 'theoretical_proposition', effectPolarity: 'neutral'
}), 'scope_tension');
assert.equal(classifyRuleV3Relationship({
  subject: 'activation of weak associations', outcome: 'creative thinking', claimType: 'theoretical_proposition', effectPolarity: 'unknown'
}, {
  subject: 'future-related dreams', outcome: 'implausible scenarios', claimType: 'association', effectPolarity: 'neutral'
}, { sharedEvidenceContext: true }), 'shared_context');
const clusters = buildRuleV3ConceptClusters([{
  id: 'implausible', subject: 'future-related dreams', outcome: 'highly implausible scenarios', statement: 'Future-related dreams are often highly implausible.', claimType: 'association', effectPolarity: 'neutral', evidenceChunkIds: ['paragraph-a'],
}, {
  id: 'different-process', subject: 'dreaming', outcome: 'different from waking prospective cognition', statement: 'Dreaming is not the same as waking prospective thought.', claimType: 'theoretical_proposition', effectPolarity: 'neutral', evidenceChunkIds: ['paragraph-a'],
}, {
  id: 'realistic', subject: 'dream simulations', outcome: 'realistic waking-life analogue', statement: 'Dream simulations are relatively realistic analogues of waking perception.', claimType: 'theoretical_proposition', effectPolarity: 'neutral', evidenceChunkIds: ['paragraph-b'],
}, {
  id: 'latency', subject: 'awakening latency', outcome: 'future concerns', statement: 'Longer awakening latency is associated with fewer future concerns.', claimType: 'association', effectPolarity: 'negative', evidenceChunkIds: ['paragraph-c'],
}]);
assert.equal(clusters.get('implausible')?.memberCount, 3);
assert.equal(clusters.get('realistic')?.clusterId, clusters.get('implausible')?.clusterId);
assert.equal(clusters.get('latency')?.memberCount, 1);
const mergeRules = [{ _id: 'implausible', subject: 'future-related dreams', outcome: 'implausible scenarios', claimType: 'association', effectPolarity: 'neutral' },
  { _id: 'different-process', subject: 'dreaming', outcome: 'different from waking thought', claimType: 'theoretical_proposition', effectPolarity: 'neutral' },
  { _id: 'creativity', subject: 'weak associations', outcome: 'creative thinking', claimType: 'theoretical_proposition', effectPolarity: 'unknown' },
  { _id: 'reality-simulation', subject: 'dreaming', outcome: 'reality simulation', claimType: 'theoretical_proposition', effectPolarity: 'neutral' },
  { _id: 'waking-incorporation', subject: 'dream simulations', outcome: 'realistic waking-life incorporation', claimType: 'theoretical_proposition', effectPolarity: 'neutral' }];
const mergeChunks = new Map<string, Set<string>>([
  ['implausible', new Set(['paragraph-a'])], ['different-process', new Set(['paragraph-a'])], ['creativity', new Set(['paragraph-a'])],
  ['reality-simulation', new Set(['paragraph-b'])], ['waking-incorporation', new Set(['paragraph-b'])],
]);
assert.deepEqual(findRuleV3MergeGroup('implausible', mergeRules, mergeChunks).map(rule => String(rule._id)), ['implausible', 'creativity', 'different-process']);
assert.deepEqual(findRuleV3MergeGroup('reality-simulation', mergeRules, mergeChunks).map(rule => String(rule._id)), ['reality-simulation', 'waking-incorporation']);
assert.equal(assessRuleV3MergeCompatibility({
  subject: 'dreaming', outcome: 'reality simulation', statement: 'Dreaming is a form of reality simulation.', claimType: 'theoretical_proposition', effectPolarity: 'neutral',
}, {
  subject: 'dreaming', outcome: 'different from waking prospective thought', statement: 'Dreaming differs from waking prospective thought.', claimType: 'theoretical_proposition', effectPolarity: 'neutral',
}).canMerge, false, 'the generic subject “dreaming” alone must not make unrelated claims mergeable');
assert.equal(assessRuleV3MergeCompatibility({
  subject: 'future-related dreams', outcome: 'implausible scenarios', statement: 'Future dreams often contain implausible scenarios.', claimType: 'association', effectPolarity: 'neutral',
}, {
  subject: 'future-oriented dreams', outcome: 'unrealistic scenarios', statement: 'Future-oriented dreams often contain unrealistic scenarios.', claimType: 'association', effectPolarity: 'neutral',
}).canMerge, true, 'paraphrased meaningful subjects and outcomes should be mergeable');
const presentationMergeClusters = buildRuleV3MergeClusters([{
  id: 'a', subject: 'future-related dreams', outcome: 'implausible scenarios', statement: 'Future dreams contain implausible scenarios.', claimType: 'association', effectPolarity: 'neutral', evidenceChunkIds: ['p1'],
}, {
  id: 'b', subject: 'weak associations', outcome: 'creative thinking', statement: 'Weak associations may support creative thinking.', claimType: 'theoretical_proposition', effectPolarity: 'unknown', evidenceChunkIds: ['p1'],
}, {
  id: 'c', subject: 'dream simulations', outcome: 'realistic waking analogues', statement: 'Dream simulations can be realistic.', claimType: 'theoretical_proposition', effectPolarity: 'neutral', evidenceChunkIds: ['p2'],
}]);
assert.equal(presentationMergeClusters.get('a')?.memberCount, 2);
assert.equal(presentationMergeClusters.has('c'), false, 'related-but-not-mergeable claims must not create a candidate-list cluster');
const nonTransitiveRules = [
  { _id: 'chain-a', subject: 'alpha', outcome: 'outcome-a', claimType: 'theoretical_proposition', effectPolarity: 'neutral' },
  { _id: 'chain-b', subject: 'beta', outcome: 'outcome-b', claimType: 'theoretical_proposition', effectPolarity: 'neutral' },
  { _id: 'chain-c', subject: 'gamma', outcome: 'outcome-c', claimType: 'theoretical_proposition', effectPolarity: 'neutral' },
];
const nonTransitiveChunks = new Map<string, Set<string>>([
  ['chain-a', new Set(['p-a'])],
  ['chain-b', new Set(['p-a', 'p-b'])],
  ['chain-c', new Set(['p-b'])],
]);
assert.deepEqual(
  findRuleV3MergeGroup('chain-a', nonTransitiveRules, nonTransitiveChunks).map(rule => String(rule._id)),
  ['chain-a', 'chain-b'],
  'merge endpoint must require every member to be compatible with every other member',
);
const nonTransitiveClusters = buildRuleV3MergeClusters(nonTransitiveRules.map(rule => ({
  id: String(rule._id),
  subject: rule.subject,
  outcome: rule.outcome,
  claimType: rule.claimType,
  effectPolarity: rule.effectPolarity,
  evidenceChunkIds: [...(nonTransitiveChunks.get(String(rule._id)) || [])],
})));
assert.deepEqual(nonTransitiveClusters.get('chain-a')?.memberIds, ['chain-a', 'chain-b']);
assert.equal(nonTransitiveClusters.has('chain-c'), false, 'transitive A–B–C links must not put incompatible A and C in one UI group');
console.log('RULE V3 RELATIONSHIPS AND CONCEPT CLUSTERS: PASSED');
