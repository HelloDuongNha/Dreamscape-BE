import assert from 'node:assert/strict';
import {
  applyFeedbackToThreads,
  buildCaseGroundedSynthesis,
  buildDreamCaseConclusion,
  buildExploratoryCaseAssessment,
  buildFeedbackAppliedAnalysis,
  deduplicateAcademicSources,
  ensureInterpretiveThreadCoverage,
  exactExcerptExists,
  isVagueFollowUpQuestion,
  normalizeGroundingText,
  sanitizeGeneratedHypotheses,
  sanitizeInterpretiveThreads,
} from '../analysis/grounding/dreamAnalysisGrounding.service';

const narrative = 'Tôi đứng trong một căn phòng lạ rồi bước qua cây cầu trong mưa.';
assert.equal(normalizeGroundingText('  Cây   Cầu  '), 'cây cầu');
assert.equal(exactExcerptExists('cây cầu', narrative), true);
assert.equal(exactExcerptExists('một chuyến tàu không có trong lời kể', narrative), false);

assert.equal(isVagueFollowUpQuestion('Có không?'), true);
assert.equal(
  isVagueFollowUpQuestion('Trong tuần này, bạn có sự kiện thật nào liên quan trực tiếp đến căn phòng trong mơ không?'),
  false,
);

const hypotheses = sanitizeGeneratedHypotheses([{
  ruleId: 'rule-1',
  hypothesis: 'Một hoàn cảnh khi thức có thể liên quan tới cảnh này.',
  evidenceFromDream: ['căn phòng lạ'],
  followUpQuestion: 'Trong tuần này, bạn có sự kiện thật nào liên quan trực tiếp đến căn phòng trong mơ không?',
  reasonForAsking: 'Câu trả lời giúp kiểm tra trực tiếp độ phù hợp của lập luận với trường hợp đang được kể.',
  ifYesMeaning: 'Có một bối cảnh thật cần được giữ lại để đối chiếu trong trường hợp hiện tại.',
  ifNoMeaning: 'Hướng liên hệ này kém phù hợp và không nên được giữ làm trọng tâm của trường hợp.',
}], narrative, '', new Set(['rule-1']));
assert.equal(hypotheses.length, 1);
assert.equal(hypotheses[0].ruleId, 'rule-1');

const threads = sanitizeInterpretiveThreads([{
  title: 'Một hướng diễn giải cần kiểm tra',
  dreamEvidence: ['căn phòng lạ', 'cây cầu'],
  reasoning: 'Hai chi tiết xuất hiện theo thứ tự trong lời kể và có thể được xem xét cùng nhau, nhưng chưa đủ để gán ý nghĩa cố định.',
  alternativeExplanation: 'Chúng cũng có thể chỉ là hai mảnh cảnh được ghép trong mơ.',
}], narrative);
assert.equal(threads.length, 1);
assert.deepEqual(ensureInterpretiveThreadCoverage(narrative, threads), threads);
assert.equal(
  buildCaseGroundedSynthesis(narrative, hypotheses, '  Phân tích do mô hình tạo.  '),
  'Phân tích do mô hình tạo.',
);

const answered = [{
  ...hypotheses[0],
  userFeedback: 'yes',
}];
const feedback = buildFeedbackAppliedAnalysis(answered);
assert.deepEqual(feedback?.confirmedFacts, [
  'Có một bối cảnh thật cần được giữ lại để đối chiếu trong trường hợp hiện tại.',
]);
assert.deepEqual(applyFeedbackToThreads(threads, answered), [{
  ...threads[0],
  reasoning: `${threads[0].reasoning} Thông tin bạn xác nhận làm mạch này phù hợp hơn: Có một bối cảnh thật cần được giữ lại để đối chiếu trong trường hợp hiện tại.`,
}]);

const assessment = buildExploratoryCaseAssessment(answered);
assert.equal(assessment?.answeredCount, 1);
assert.equal(assessment?.confirmedCount, 1);
assert.equal(assessment?.status, 'strong_match');

const conclusion = buildDreamCaseConclusion(narrative, answered, [{
  sources: [{ sourceId: 'source-1', title: 'A study', year: 2024 }],
}]);
assert.equal(conclusion.status, 'clarified');
assert.equal(conclusion.confirmedFindings.length, 1);
assert.equal(conclusion.evidenceBasis.some(item => item.kind === 'academic_context'), true);

assert.deepEqual(deduplicateAcademicSources([
  { sourceId: 'source-1', title: 'A study' },
  { sourceId: 'source-1', title: 'A study' },
]), [{ sourceId: 'source-1', title: 'A study', chunkIds: [] }]);

console.log('DREAM ANALYSIS GROUNDING: 18 PASSED, 0 FAILED');
