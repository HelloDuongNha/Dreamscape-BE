import assert from 'node:assert/strict';
import { buildCompositeProbeBlueprint } from '../../controllers/ruleV3ModerationController';

const blueprint = buildCompositeProbeBlueprint({
  isComposite: true,
  compositeComponents: [{
    ruleCode: 'KR3_IMPLAUSIBLE', statement: 'Future-related dreams are often highly implausible scenarios.',
    subject: 'future-related dreams', outcome: 'implausible scenarios', claimType: 'association',
    effectPolarity: 'neutral', evidenceInterpretation: 'associational', conditions: [], limitations: [], dreamFeatureTags: ['implausible scenarios'],
  }, {
    ruleCode: 'KR3_BOUNDARY', statement: 'Dreaming is not strictly the same process as waking prospective thought.',
    subject: 'dreaming', outcome: 'not the same process as waking prospective thought', claimType: 'theoretical_proposition',
    effectPolarity: 'neutral', evidenceInterpretation: 'interpretive', conditions: [], limitations: [], dreamFeatureTags: [],
  }, {
    ruleCode: 'KR3_CREATIVE', statement: 'Weak associations may be a component of creative thinking.',
    subject: 'weak associations', outcome: 'creative thinking', claimType: 'theoretical_proposition',
    effectPolarity: 'unknown', evidenceInterpretation: 'interpretive', conditions: [], limitations: [], dreamFeatureTags: ['creative thinking'],
  }],
});

assert.equal(blueprint.checkable, true);
assert.equal(blueprint.questionDimensions.length, 5, 'three claims must expose five distinct data dimensions');
assert.deepEqual(blueprint.questionDimensions.map((item: any) => item.type), [
  'implausible_future_scenario',
  'waking_prospective_difference', 'novel_solution_origin',
  'weak_association_recombination', 'creative_problem_preoccupation',
]);
assert.ok(blueprint.questionDimensions.every((item: any) => item.componentRuleCodes.length === 1));
assert.ok(!blueprint.questionDimensions.some((item: any) => ['anticipated_event', 'preparation_behavior'].includes(item.type)));

console.log('RULE V3 COMPOSITE PROBE: PASSED');
