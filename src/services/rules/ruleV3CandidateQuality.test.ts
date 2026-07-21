import assert from 'node:assert/strict';
import {
  assessRuleV3CandidateQuality,
  hasSpecificRuleCondition,
  hasSpecificRuleLimitation
} from './ruleV3CandidateQuality.service';

const base = {
  statement: 'Lower life satisfaction predicts more threatening events in dreams.',
  claimType: 'prediction',
  effectPolarity: 'negative',
  evidenceInterpretation: 'predictive',
  subject: 'lower life satisfaction',
  outcome: 'threatening events in dreams',
  conditions: [],
  limitations: [],
  dreamFeatureTags: []
};

const valid = assessRuleV3CandidateQuality(base, [{
  stance: 'supports',
  exactQuote: 'Lower life satisfaction predicts more threatening events in dreams.'
}]);
assert.equal(valid.accepted, true);
assert.equal(valid.semanticSupportLevel, 'direct');
assert.equal(valid.applicationReadiness, 'direct');
assert.match(valid.semanticSupportReason, /bao hàm trực tiếp/iu);

const navigation = assessRuleV3CandidateQuality({
  ...base,
  statement: 'Descriptive statistics for situational factors are presented in Table 2.',
  claimType: 'intervention_effect',
  evidenceInterpretation: 'descriptive',
  subject: 'situational factors',
  outcome: 'descriptive statistics'
}, [{ stance: 'supports', exactQuote: 'Descriptive statistics for situational factors are shown in Table 2.' }]);
assert.equal(navigation.accepted, false);
assert.ok(navigation.reasonCodes.includes('document_navigation'));
assert.ok(navigation.reasonCodes.includes('generic_subject_or_outcome'));
assert.ok(navigation.reasonCodes.includes('claim_type_evidence_mismatch'));

const recommendation = assessRuleV3CandidateQuality({
  ...base,
  statement: 'Further research is needed to replicate these findings.'
}, [{ stance: 'supports', exactQuote: 'Further research is needed to replicate these findings.' }]);
assert.equal(recommendation.accepted, false);
assert.ok(recommendation.reasonCodes.includes('research_recommendation'));

const stitched = assessRuleV3CandidateQuality({
  ...base,
  statement: 'Positive emotions predict pandemic-related threatening events in dreams.',
  subject: 'positive emotions',
  outcome: 'pandemic-related threatening events in dreams'
}, [
  { stance: 'supports', exactQuote: 'A stable emotional trait predicts threatening dream content.' },
  { stance: 'supports', exactQuote: 'Positive emotions may help people cope with pandemic changes.' }
]);
assert.equal(stitched.accepted, false);
assert.ok(stitched.reasonCodes.includes('evidence_does_not_entail_claim'));

const theoretical = assessRuleV3CandidateQuality({
  ...base,
  statement: 'Dreams are products of self-organization in the sleeping brain.',
  claimType: 'theoretical_proposition',
  effectPolarity: 'positive',
  evidenceInterpretation: 'interpretive',
  subject: 'dreams',
  outcome: 'self-organization in the sleeping brain'
}, [{ stance: 'supports', exactQuote: 'Dreams are products of self-organization in the sleeping brain.' }]);
assert.equal(theoretical.accepted, true);
assert.equal(theoretical.normalizedEffectPolarity, 'unknown');
assert.equal(theoretical.normalizedEvidenceInterpretation, 'interpretive');

assert.equal(hasSpecificRuleCondition(['during sleep']), true);
assert.equal(hasSpecificRuleCondition(['function of NREM and REM sleep']), false);
assert.equal(hasSpecificRuleCondition([]), false);
assert.equal(hasSpecificRuleLimitation(['single study']), true);
assert.equal(hasSpecificRuleLimitation(['']), false);

const henryCase = assessRuleV3CandidateQuality({
  ...base,
  statement: 'Bốn người bạn trong giấc mơ sau cùng có liên hệ với tâm thức Henry.',
  claimType: 'theoretical_proposition',
  evidenceInterpretation: 'interpretive',
  subject: 'bốn người bạn trong giấc mơ sau cùng',
  outcome: 'tâm thức Henry'
}, [{ stance: 'supports', exactQuote: 'Bốn người bạn trong giấc mơ sau cùng có liên hệ với tâm thức Henry.' }]);
assert.equal(henryCase.accepted, false);
assert.ok(henryCase.reasonCodes.includes('case_specific_narrative'));

const historicalFact = assessRuleV3CandidateQuality({
  ...base,
  statement: 'Ý niệm về hạt được trình bày bởi triết gia Hy Lạp thế kỷ IV trước Công nguyên.',
  claimType: 'theoretical_proposition',
  evidenceInterpretation: 'descriptive',
  subject: 'ý niệm về hạt',
  outcome: 'triết gia Hy Lạp thế kỷ IV trước Công nguyên'
}, [{ stance: 'supports', exactQuote: 'Ý niệm về hạt được trình bày bởi triết gia Hy Lạp thế kỷ IV trước Công nguyên.' }]);
assert.equal(historicalFact.accepted, false);
assert.ok(historicalFact.reasonCodes.includes('historical_or_biographical_fact'));
assert.ok(historicalFact.reasonCodes.includes('not_applicable_to_dream_analysis'));

const vagueLink = assessRuleV3CandidateQuality({
  ...base,
  statement: 'Giá trị của tự do có liên hệ với tạo ra những điều hữu ích.',
  claimType: 'theoretical_proposition',
  evidenceInterpretation: 'interpretive',
  subject: 'giá trị của tự do',
  outcome: 'tạo ra những điều hữu ích'
}, [{ stance: 'supports', exactQuote: 'Giá trị của tự do có liên hệ với tạo ra những điều hữu ích.' }]);
assert.equal(vagueLink.accepted, false);
assert.ok(vagueLink.reasonCodes.includes('generic_relation_wording'));
assert.ok(vagueLink.reasonCodes.includes('not_applicable_to_dream_analysis'));

const fixedBasement = assessRuleV3CandidateQuality({
  ...base,
  statement: 'Tầng hầm trong giấc mơ đại diện cho những tiềm năng chưa biết của vô thức.',
  claimType: 'theoretical_proposition',
  evidenceInterpretation: 'interpretive',
  subject: 'tầng hầm trong giấc mơ',
  outcome: 'tiềm năng chưa biết của vô thức'
}, [{ stance: 'supports', exactQuote: 'Tầng hầm trong giấc mơ đại diện cho những tiềm năng chưa biết của vô thức.' }], { documentType: 'book_or_monograph' });
assert.equal(fixedBasement.accepted, false);
assert.ok(fixedBasement.reasonCodes.includes('fixed_symbol_dictionary'));

const harmfulIdentity = assessRuleV3CandidateQuality({
  ...base,
  statement: 'Người da đen đại diện cho vô thức và các xung lực nguyên thủy.',
  claimType: 'theoretical_proposition',
  evidenceInterpretation: 'interpretive',
  subject: 'người da đen',
  outcome: 'vô thức và các xung lực nguyên thủy'
}, [{ stance: 'supports', exactQuote: 'Người da đen đại diện cho vô thức và các xung lực nguyên thủy.' }], { documentType: 'book_or_monograph' });
assert.equal(harmfulIdentity.accepted, false);
assert.ok(harmfulIdentity.reasonCodes.includes('identity_stereotype'));

const applicableBookMechanism = assessRuleV3CandidateQuality({
  ...base,
  statement: 'Khi con người đối mặt với căng thẳng, ký ức về người từng hỗ trợ họ có thể được kích hoạt như một cách ứng phó cảm xúc.',
  claimType: 'theoretical_proposition',
  evidenceInterpretation: 'interpretive',
  subject: 'căng thẳng trong cuộc sống',
  outcome: 'kích hoạt ký ức về người từng hỗ trợ',
  conditions: ['khi con người đối mặt với căng thẳng'],
  limitations: ['có thể khác nhau giữa các cá nhân']
}, [{ stance: 'supports', exactQuote: 'Khi con người đối mặt với căng thẳng, ký ức về người từng hỗ trợ họ có thể được kích hoạt như một cách ứng phó cảm xúc.' }], { documentType: 'book_or_monograph' });
assert.equal(applicableBookMechanism.accepted, true);
assert.equal(applicableBookMechanism.applicationReadiness, 'conditional');

console.log('RULE V3 CANDIDATE QUALITY: 36 PASSED, 0 FAILED');
