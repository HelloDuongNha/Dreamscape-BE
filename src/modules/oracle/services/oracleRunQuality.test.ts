import assert from 'node:assert/strict';
import test from 'node:test';
import {
  directAnswerSuggestions,
  validateAcademicCitationSupport,
} from './oracleRun.service';
import {
  canonicalizeOracleEvidenceClaim,
  evidenceGapRuleSimilarity,
  invalidateOracleCitationMarker,
  isResearchableOracleEvidenceClaim,
  oracleEvidenceClaimClusterKey,
} from './oracleEvidenceGap.service';
import { buildOracleCitationVerificationQuestion } from './oracleRulePresentation.service';

test('direct yes/no questions receive short reply affordances', () => {
  const suggestions = directAnswerSuggestions(
    'Bạn có cảm thấy hình ảnh cây cầu gợi ra một ý tưởng cụ thể không?',
  );
  assert.deepEqual(suggestions, [
    'Có, tôi có cảm thấy như vậy.',
    'Không, tôi không cảm thấy như vậy.',
    'Tôi chưa chắc mình có cảm thấy như vậy không.',
  ]);
  assert.equal(
    directAnswerSuggestions('Bạn muốn giải thích ý tưởng đó như thế nào?').length,
    0,
  );
});

test('an academic citation cannot cover concepts absent from its evidence scope', () => {
  const answer = 'Giấc mơ cho thấy áp lực công việc và nhiệm vụ tương lai được xử lý qua ký ức [1].';
  const citations = [{
    index: 1,
    sourceType: 'academic_source' as const,
    sourceId: 'source-1',
    title: 'A broad memory paper',
    excerpt: 'Memory is a major element of dreams.',
    detail: 'Supported claim: Memory is a major element of dreams.',
  }];
  assert.equal(
    validateAcademicCitationSupport(answer, citations),
    'Giấc mơ cho thấy áp lực công việc và nhiệm vụ tương lai được xử lý qua ký ức [?].',
  );
});

test('a substantive quote remains when it covers the adjacent claim scope', () => {
  const answer = 'Giấc mơ có thể kết hợp ký ức quá khứ với một sự kiện dự kiến trong tương lai [1].';
  const citations = [{
    index: 1,
    sourceType: 'academic_source' as const,
    sourceId: 'source-1',
    title: 'Constructive episodic simulation in dreams',
    excerpt: 'Participants identified dreams as related to both specific past memories and anticipated future events.',
    detail: 'Supported claim: Dreams can relate to both past events and anticipated future events.',
  }];
  assert.equal(validateAcademicCitationSupport(answer, citations), answer);
});

test('source invalidation reopens academic claims but never turns questions into evidence gaps', () => {
  const academicClaim = 'Nghiên cứu cho thấy giấc mơ hướng tới tương lai phổ biến hơn vào cuối đêm [4].';
  const verificationQuestion = 'Để kiểm tra cách lập luận [4] áp dụng: tuần tới bạn có buổi họp không?';

  assert.equal(
    invalidateOracleCitationMarker(academicClaim, 4),
    'Nghiên cứu cho thấy giấc mơ hướng tới tương lai phổ biến hơn vào cuối đêm [?].',
  );
  assert.equal(
    invalidateOracleCitationMarker(verificationQuestion, 4),
    'Để kiểm tra cách lập luận áp dụng: tuần tới bạn có buổi họp không?',
  );
});

test('weak-association claims remain distinct from general memory-incorporation needs', () => {
  const claim = 'The activation of weak associations may be a critical component of creative, flexible, and divergent thinking during dreaming.';
  assert.equal(isResearchableOracleEvidenceClaim(claim), true);
  assert.equal(
    canonicalizeOracleEvidenceClaim(claim),
    'Activation of weak associations in dreams may be related to creative, flexible, or divergent thinking.',
  );
  assert.equal(
    oracleEvidenceClaimClusterKey(claim),
    'mechanism:weak-association__outcome:creative-divergent-thinking',
  );
});

test('citation questions follow the exact rule relation instead of broad feature tags', () => {
  const comparison = buildOracleCitationVerificationQuestion({
    statement: 'Dreams are more likely to be associated with past episodes than future episodes.',
    dreamFeatureTags: ['past event', 'future event'],
  });
  const combined = buildOracleCitationVerificationQuestion({
    statement: 'Dreams were related to both specific past events and anticipated future events.',
  });
  const sleepOnset = buildOracleCitationVerificationQuestion({
    statement: 'Past memories were incorporated into sleep onset dreams.',
    conditions: ['during sleep onset'],
  });

  assert.match(comparison.vi, /chủ yếu gợi lại một sự kiện quá khứ/iu);
  assert.match(combined.vi, /đồng thời gợi lại/iu);
  assert.match(sleepOnset.vi, /mới bắt đầu ngủ/iu);
});

test('late-sleep future claims do not match general past-versus-future comparisons', () => {
  const claim = 'Future-oriented dreams become proportionally more common later in the night.';
  const unrelatedRule = 'Dreams are more likely to be associated with past episodes than future episodes.';

  assert.equal(
    oracleEvidenceClaimClusterKey(claim),
    'context:late-sleep__outcome:future-oriented-dream-prevalence',
  );
  assert.ok(evidenceGapRuleSimilarity(claim, unrelatedRule) < 0.5);
});
