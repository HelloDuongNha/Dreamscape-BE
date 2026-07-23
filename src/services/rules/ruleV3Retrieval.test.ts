import assert from 'node:assert/strict';
import {
  classifyRuleApplicationTier,
  expandDreamRetrievalConcepts,
  extractDreamRuleFeatures,
  lexicalOverlap,
  rankRuleV3Candidates,
} from './ruleV3Retrieval.service';

assert.equal(classifyRuleApplicationTier({ evidenceScore: 19, supportingSourceCount: 1 }), 'exploratory');
assert.equal(classifyRuleApplicationTier({ evidenceScore: 60, supportingSourceCount: 2 }), 'supported');

const dream = 'Tôi cầm cuốn sổ trắng, sợ mình sẽ quên, rồi chạy về căn nhà cũ của bà ngoại.';
const expanded = expandDreamRetrievalConcepts(dream);

assert.match(expanded, /memory consolidation/);
assert.match(expanded, /autobiographical memory/);
assert.match(expanded, /recent events/);
assert.match(expanded, /threat simulation/);
assert.match(expanded, /social support/);
assert.ok(lexicalOverlap(expanded, 'recent events autobiographical memory') > 0);
assert.ok(lexicalOverlap(expanded, 'brain damage and alien hand syndrome') === 0);

const stationDream = 'Gần sáng, phòng chờ giống lớp học cũ. Vé ghi ngày hôm qua; bảng điện tử ghi sáng mai và tháng Chín năm sau. Đường ray dựng thẳng lên trời, tàu không có bánh và trôi lơ lửng.';
const stationFeatures = extractDreamRuleFeatures(stationDream);
assert.ok(stationFeatures.includes('past event reference'));
assert.ok(stationFeatures.includes('future event combination'));
assert.ok(stationFeatures.includes('multiple time points'));
assert.ok(stationFeatures.includes('implausible scenarios'));
assert.ok(stationFeatures.includes('later in the night'));
const recombinationFeatures = extractDreamRuleFeatures('Lớp học cũ biến thành lịch họp; tàu bàn phím bay tới Mặt Trăng trước buổi trình bày sắp tới.');
assert.ok(recombinationFeatures.includes('weak associations'));
assert.ok(recombinationFeatures.includes('implausible scenarios'));

const baseRule = {
  status: 'verified', sourceLanguage: 'en', evidenceScore: 35, embedding: [1, 0], conditions: [],
};
const ranked = rankRuleV3Candidates([
  { ...baseRule, _id: 'past-future', subject: 'dreams', outcome: 'past and future events', statement: 'Dreams can relate to past and anticipated future events.', dreamFeatureTags: ['past event reference', 'future anticipation'] },
  { ...baseRule, _id: 'future-combination', subject: 'dreams', outcome: 'combining future events', statement: 'Dreams can combine future events at different time points.', dreamFeatureTags: ['future event combination', 'multiple time points'], conditions: ['events occur at different time points'] },
  { ...baseRule, _id: 'implausible', subject: 'future-related dreams', outcome: 'highly implausible scenarios', statement: 'Future-related dreams can be implausible.', dreamFeatureTags: ['implausible scenarios', 'future anticipation'] },
  { ...baseRule, _id: 'late-night', subject: 'future-oriented dreams', outcome: 'proportion of dreams', statement: 'Future-oriented dreams become more common later in the night.', dreamFeatureTags: ['future events', 'temporal orientation'], conditions: ['later in the night'] },
  { ...baseRule, _id: 'awakening-latency', subject: 'future concerns', outcome: 'reporting likelihood', statement: 'Long awakening latency changes reports.', dreamFeatureTags: ['future events'], conditions: ['awakening latency greater than 30 seconds'] },
  { ...baseRule, _id: 'termite', subject: "termite's nest", outcome: 'self-organization', statement: 'A termite nest is an example of self-organization.', dreamFeatureTags: ['termite colony'] },
  { ...baseRule, _id: 'brain-damage', subject: 'brain damage', outcome: 'alien hand syndrome', statement: 'Brain damage can alter the sense of self.', dreamFeatureTags: ['brain injury'] },
], stationDream, [1, 0], 'vi');
const rankedIds = ranked.map(item => item.rule._id);
assert.ok(rankedIds.includes('past-future'));
assert.ok(rankedIds.includes('future-combination'));
assert.ok(rankedIds.includes('implausible'));
assert.ok(rankedIds.includes('late-night'));
assert.equal(rankedIds.includes('awakening-latency'), false);
assert.equal(rankedIds.includes('termite'), false);
assert.equal(rankedIds.includes('brain-damage'), false);

const targetDream = 'Tôi quay lại lớp học cũ; bảng biến thành lịch họp. Tôi đi tàu làm bằng bàn phím tới Mặt Trăng để trình bày dự án, rồi ghép đồ chơi tuổi thơ thành một cây cầu.';
const targetComposite = {
  ...baseRule, _id: 'target-composite', subject: 'weak associations', outcome: 'creative thinking',
  statement: 'Weak associations may contribute to flexible thinking in implausible future-related dreams.',
  dreamFeatureTags: ['weak associations', 'implausible scenarios', 'future anticipation'],
  isComposite: true,
  compositeComponents: [{ statement: 'Future-related dreams are often highly implausible scenarios.', subject: 'future-related dreams', outcome: 'implausible scenarios' },
    { statement: 'Weak associations may contribute to creative thinking.', subject: 'weak associations', outcome: 'creative thinking' }],
};
assert.equal(rankRuleV3Candidates([targetComposite], targetDream, [1, 0], 'vi')[0]?.rule._id, 'target-composite',
  'the exact user test dream must pass semantic retrieval for the approved composite rule');

console.log('RULE V3 RETRIEVAL: ALL ASSERTIONS PASSED');
