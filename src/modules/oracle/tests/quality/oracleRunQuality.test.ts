import assert from 'node:assert/strict';
import test from 'node:test';
import {
  directAnswerSuggestions,
} from '../../services/presentation/oracleSuggestion.service';
import {
  validateAcademicCitationSupport,
} from '../../services/grounding/oracleCitationValidation.service';
import {
  canonicalizeOracleEvidenceClaim,
  invalidateOracleCitationMarker,
  isResearchableOracleEvidenceClaim,
} from '../../services/evidence/oracleEvidenceClaim.service';
import {
  evidenceGapRuleSimilarity,
  oracleEvidenceClaimClusterKey,
} from '../../services/evidence/oracleEvidenceMatching.service';
import {
  buildOracleCitationVerificationQuestion,
  localizeOracleRuleStatement,
  localizeOracleVerificationQuestion,
} from '../../services/presentation/oracleRulePresentation.service';

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
  const memoryConsolidation = buildOracleCitationVerificationQuestion({
    statement: 'Dream content may contain newly encoded memories and emotional experiences.',
    subject: 'memory consolidation',
    conditions: ['memory consolidation'],
  });

  assert.match(comparison.vi, /chủ yếu gợi lại một sự kiện quá khứ/iu);
  assert.match(combined.vi, /đồng thời gợi lại/iu);
  assert.match(sleepOnset.vi, /mới bắt đầu ngủ/iu);
  assert.match(memoryConsolidation.vi, /trải nghiệm, ký ức mới hoặc cảm xúc cụ thể/iu);
  assert.doesNotMatch(memoryConsolidation.vi, /điều kiện|memory consolidation/iu);
});

test('citation localization preserves bilingual presentation instead of overwriting both languages', () => {
  const localizedStatement = localizeOracleRuleStatement({
    statement: 'Future-oriented dreams become more common later in the night.',
    localizedStatement: {
      vi: 'Giấc mơ hướng tới tương lai trở nên phổ biến hơn vào cuối đêm.',
      en: 'Future-oriented dreams become more common later in the night.',
    },
  });
  const localizedQuestion = localizeOracleVerificationQuestion({
    statement: 'Future-oriented dreams become more common later in the night.',
    localizedVerificationQuestion: {
      vi: 'Giấc mơ này có xảy ra gần sáng không?',
      en: 'Did this dream occur near awakening?',
    },
  }, 'Giấc mơ này có xảy ra gần sáng không?');

  assert.equal(localizedStatement.vi, 'Giấc mơ hướng tới tương lai trở nên phổ biến hơn vào cuối đêm.');
  assert.equal(localizedStatement.en, 'Future-oriented dreams become more common later in the night.');
  assert.equal(localizedQuestion?.vi, 'Giấc mơ này có xảy ra gần sáng không?');
  assert.equal(localizedQuestion?.en, 'Did this dream occur near awakening?');
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

test('case-specific advice is not stored as an academic evidence need', () => {
  const caseAdvice = 'Cảm giác "không biết có theo kịp hay không" là phản ứng tự nhiên trước sự thay đổi, nhưng giấc mơ đã cung cấp một manh mối: giải pháp có thể nằm ở việc kết hợp các kỹ năng nền tảng, kinh nghiệm định hướng và kiến thức mới.';
  const generalClaim = 'Dream content may recombine past memories with future concerns or anticipated tasks.';

  assert.equal(isResearchableOracleEvidenceClaim(caseAdvice), false);
  assert.equal(isResearchableOracleEvidenceClaim(generalClaim), true);
});

test('a case interpretation is not stored as a general evidence need', () => {
  const claim = 'Giấc mơ thể hiện sự kết nối giữa quá khứ và hiện tại thông qua việc quay lại lớp học tiểu học và nhận được tấm vé tàu liên quan đến công việc hiện tại.';
  assert.equal(isResearchableOracleEvidenceClaim(claim), false);
});

test('Constructive simulation claims match their bilingual canonical relation', () => {
  const evidenceNeed = 'Nội dung giấc mơ có thể tái kết hợp ký ức quá khứ với mối quan tâm hoặc nhiệm vụ tương lai.';
  const extractedRule = 'Dreams may incorporate elements from multiple past episodic memories and construct imagined scenarios anticipating future events.';

  assert.ok(evidenceGapRuleSimilarity(evidenceNeed, extractedRule) >= 0.5);
});

test('general evidence needs retain equivalent Vietnamese and English presentations', () => {
  assert.equal(
    oracleEvidenceClaimClusterKey(
      'Chuyển lo âu thành hành động hoặc kế hoạch cụ thể có thể liên quan đến việc giảm căng thẳng.',
    ),
    'relation:action-planning__outcome:stress-reduction',
  );
  assert.equal(
    canonicalizeOracleEvidenceClaim(
      'Cảm giác bất ngờ vì tìm ra giải pháp khi tỉnh dậy là kết quả trực tiếp của quá trình xử lý thông tin trong giấc ngủ.',
    ),
    'Xử lý thông tin trong giấc ngủ có thể liên quan đến cảm giác sáng tỏ hoặc bất ngờ khi tỉnh dậy.',
  );
});
