import assert from 'node:assert/strict';
import {
  canExplainPsychology,
  canGenerateContextQuestion,
  classifyRuleV3DreamApplication,
  classifyRuleV3VerificationKind,
} from './ruleV3DreamApplication.service';

const lateNight = {
  statement: 'Future-oriented dreams become proportionally more common later in the night.',
  subject: 'future-oriented dreams', outcome: 'proportion of dreams', conditions: ['later in the night'],
};
const multipleFuture = {
  statement: 'Some dreams combine future events occurring at different time points.',
  subject: 'dreams', outcome: 'combining future events', dreamFeatureTags: ['multiple time points'],
};
const temporalSource = {
  statement: 'Dreams are most often identified with events that occurred yesterday or will occur tomorrow.',
  subject: 'episodic sources of dreams', outcome: 'temporal proximity',
};
const memoryMechanism = {
  statement: 'Memory consolidation during sleep can make recent autobiographical memories available as dream material.',
  subject: 'memory consolidation', outcome: 'autobiographical memory activation',
};
const combineFutureWithoutOtherHints = {
  statement: 'Dreams can combine future events in a single narrative.',
};

assert.equal(classifyRuleV3DreamApplication(lateNight), 'descriptive_pattern');
assert.equal(canExplainPsychology(lateNight), false);
assert.equal(canGenerateContextQuestion(lateNight), false);
assert.equal(classifyRuleV3DreamApplication(multipleFuture), 'contextual_probe');
assert.equal(canExplainPsychology(multipleFuture), false);
assert.equal(canGenerateContextQuestion(multipleFuture), true);
assert.equal(classifyRuleV3DreamApplication(temporalSource), 'contextual_probe');
assert.equal(classifyRuleV3DreamApplication(memoryMechanism), 'psychological_mechanism');
assert.equal(canExplainPsychology(memoryMechanism), true);
assert.equal(classifyRuleV3VerificationKind(memoryMechanism), 'recent_experience_incorporation');
assert.equal(canGenerateContextQuestion(memoryMechanism), true);
assert.equal(classifyRuleV3DreamApplication(combineFutureWithoutOtherHints), 'contextual_probe');
assert.equal(classifyRuleV3VerificationKind({ statement: 'Memory consolidation occurs during sleep.' }), 'none');
assert.equal(canGenerateContextQuestion({ statement: 'Memory consolidation occurs during sleep.' }), false);
assert.equal(classifyRuleV3VerificationKind({
  statement: 'Under threat or distress, attachment-system activation can increase proximity-seeking toward a trusted support figure.',
}), 'attachment_support_under_stress');
assert.equal(canGenerateContextQuestion({
  statement: 'A grandmother appeared in one patient vignette.',
}), false);

console.log('RULE V3 DREAM APPLICATION: 17 PASSED, 0 FAILED');
