import assert from 'node:assert/strict';
import { extractDreamSegments, hasStandaloneVietnameseHouseMeaning, isStrictExactMatch } from './symbolRetrieval.service';
import {
  deduplicateAcademicSources,
  collectPersonalSymbolPatterns,
  exactExcerptExists,
  extractContextualMotifHints,
  findNarrativeSentenceForSymbol,
  inferContextualTone,
  isVagueFollowUpQuestion,
  isSubstantiveCoreAnalysis,
  sanitizeInterpretiveThreads,
  isGroundedDreamTitle,
  buildGroundedDreamTitle,
  buildRuleGroundedFallbackHypotheses,
  reconcileAlternateQuestionAfterFeedback,
  ensureSubstantiveCoreAnalysis,
  polishGeneratedDreamProse,
  structureScientificNoteText,
  buildScientificInsightTitle,
  collectScientificDreamEvidence,
  buildVerifiedScientificNote,
  buildVerifiedMechanismFallbackNotes,
  enrichScientificNotesForResponse,
  buildRuleScientificFallback,
  buildPracticalReflectionsFromHypotheses,
  buildFeedbackRevision,
  buildGroundedMotifExplanation,
  sanitizeUnsupportedDreamClaims,
  isHypothesisAlreadyAnswered,
  sanitizeGeneratedHypotheses,
  buildCaseGroundedSynthesis,
  buildCaseGroundedThreads,
  buildFeedbackConclusion,
  buildFeedbackAppliedAnalysis,
  buildFeedbackChangeSet,
  applyFeedbackToThreads,
  stripGeneratedThreadFeedback,
  buildContextualMotifNotes,
  deduplicateOverlappingMotifNotes,
  deriveDreamEmotionTone,
  removeInternalAnalysisVocabulary,
  normalizeGroundingText,
  resolveQuestionRuleIds,
  buildExploratoryCaseAssessment,
} from './dreamAnalysisGrounding.service';
import { requiresAggregateRuleValidation } from '../rules/ruleV3DreamApplication.service';

assert.equal(requiresAggregateRuleValidation({
  claimType: 'review_synthesis',
  statement: 'Dream simulations are often realistic and incorporate themes, characters, concerns, and memories from waking experience.',
  subject: 'dream simulations',
  outcome: 'realistic incorporation of waking life elements',
}), false, '"incorporate" must not be misclassified because it contains the letters "rate"');
assert.equal(requiresAggregateRuleValidation({
  claimType: 'null_finding',
  statement: 'There was no significant difference in illness threats between pandemic and pre-pandemic dreams.',
  subject: 'illness threats',
  outcome: 'frequency in pandemic vs. pre-pandemic dreams',
}), true);

const input = `Đêm qua tôi mơ mình quay lại ngôi trường cấp ba cũ, dù ngày mai tôi phải thuyết trình một dự án rất quan trọng ở công ty. Hành lang trường tối. Tôi cầm một cuốn sổ nhưng các trang đều trắng. Tôi chạy qua một cây cầu gỗ. Ngoài đời, tuần vừa rồi tôi làm việc sát hạn. Gần đây tôi xem lại ảnh căn nhà cũ của bà.`;
const segments = extractDreamSegments(input);
assert.equal(hasStandaloneVietnameseHouseMeaning(['nhà', 'ga', 'mái', 'nhà', 'sàn', 'nhà']), false);
assert.equal(hasStandaloneVietnameseHouseMeaning(['căn', 'nhà', 'cũ']), true);

assert.match(segments.dreamNarrative, /ngôi trường cấp ba cũ/);
assert.match(segments.dreamNarrative, /cuốn sổ/);
assert.doesNotMatch(segments.dreamNarrative, /phải thuyết trình/);
assert.doesNotMatch(segments.dreamNarrative, /Ngoài đời/);
assert.match(segments.wakingReactionText, /phải thuyết trình/);
assert.match(segments.wakingReactionText, /tuần vừa rồi/);
assert.match(segments.wakingReactionText, /Gần đây/);

const answered = {
  hypothesis: 'Người kể đang lo lắng về một bài thuyết trình quan trọng vào ngày mai.',
  followUpQuestion: 'Ngày mai bạn có phải thuyết trình ở công ty không?',
};
assert.equal(isHypothesisAlreadyAnswered(answered, segments.wakingReactionText), true);
assert.equal(isHypothesisAlreadyAnswered({
  hypothesis: 'Có thể có áp lực công việc.',
  followUpQuestion: 'Bạn có phải thuyết trình dự án quan trọng vào ngày mai không?',
}, segments.wakingReactionText), true);
assert.equal(exactExcerptExists('Tôi cầm một cuốn sổ', segments.dreamNarrative), true);
assert.equal(exactExcerptExists('Tôi bị rơi khỏi cây cầu', segments.dreamNarrative), false);
assert.match(findNarrativeSentenceForSymbol('cuốn sổ', segments.dreamNarrative) || '', /cuốn sổ/);

const hypotheses = sanitizeGeneratedHypotheses([
  {
    ruleId: 'rule-1',
    hypothesis: answered.hypothesis,
    evidenceFromDream: ['ngôi trường cấp ba cũ'],
    confidence: 0.8,
    needsUserConfirmation: true,
    followUpQuestion: answered.followUpQuestion,
    questionType: 'future',
  },
  {
    ruleId: 'rule-1',
    hypothesis: 'Người kể có thể đang né tránh một ký ức chưa muốn đối diện.',
    evidenceFromDream: ['Tôi chạy qua một cây cầu gỗ.', 'một câu không tồn tại'],
    confidence: 0.6,
    needsUserConfirmation: true,
    followUpQuestion: 'Gần đây bạn có đang tránh nhắc lại một ký ức khiến mình khó chịu không?',
    reasonForAsking: 'Câu hỏi kiểm tra liệu cảnh chạy khỏi nơi quen thuộc có đi cùng một ký ức đang bị né tránh ngoài đời hay không.',
    ifYesMeaning: 'Câu trả lời Có làm giả thuyết né tránh ký ức phù hợp hơn với trường hợp này.',
    ifNoMeaning: 'Câu trả lời Không làm giảm ưu tiên của giả thuyết né tránh ký ức trong trường hợp này.',
    questionType: 'past',
  },
  {
    ruleId: null,
    hypothesis: 'Giả thuyết không có quy luật hỗ trợ.',
    evidenceFromDream: ['Hành lang trường tối.'],
    confidence: 0.5,
    needsUserConfirmation: true,
    followUpQuestion: 'Điều này có đúng không?',
  },
], segments.dreamNarrative, segments.wakingReactionText, new Set(['rule-1']));

assert.equal(hypotheses.length, 1);
assert.equal(hypotheses[0].ruleId, 'rule-1');
assert.deepEqual(hypotheses[0].evidenceFromDream, ['Tôi chạy qua một cây cầu gỗ.']);
assert.equal(hypotheses[0].questionType, 'past');

const dedupedPurpose = sanitizeGeneratedHypotheses([
  {
    ruleId: 'memory-1', hypothesis: 'Có thể có áp lực ghi nhớ.', evidenceFromDream: ['Tôi cầm một cuốn sổ nhưng các trang đều trắng.'],
    followUpQuestion: 'Trong tuần này, bạn có đang chuẩn bị cho một việc đòi hỏi phải nhớ nhiều thông tin không?', questionType: 'present',
    reasonForAsking: 'Câu hỏi kiểm tra xem cuốn sổ trắng có đi cùng một yêu cầu ghi nhớ đang tồn tại ngoài đời hay không.',
    ifYesMeaning: 'Câu trả lời Có làm áp lực ghi nhớ phù hợp hơn với trường hợp hiện tại.',
    ifNoMeaning: 'Câu trả lời Không làm giảm ưu tiên của giả thuyết áp lực ghi nhớ hiện tại.',
  },
  {
    ruleId: 'memory-2', hypothesis: 'Nỗi sợ quên có thể đến từ yêu cầu ghi nhớ.', evidenceFromDream: ['Tôi cầm một cuốn sổ nhưng các trang đều trắng.'],
    followUpQuestion: 'Trong hai tuần gần đây, bạn có lo mình quên thông tin quan trọng không?', questionType: 'past',
    reasonForAsking: 'Câu hỏi kiểm tra xem nỗi sợ quên trong lời kể có một tình huống ghi nhớ tương ứng ngoài đời hay không.',
    ifYesMeaning: 'Câu trả lời Có làm nỗi lo quên thông tin phù hợp hơn với trường hợp hiện tại.',
    ifNoMeaning: 'Câu trả lời Không làm giảm ưu tiên của giả thuyết lo quên thông tin hiện tại.',
  },
], segments.dreamNarrative, '', new Set(['memory-1', 'memory-2']));
assert.equal(dedupedPurpose.length, 1);

const sources = deduplicateAcademicSources([
  { sourceId: 'source-1', title: 'Paper', chunkIds: ['chunk-1'] },
  { sourceId: 'source-1', title: 'Paper', chunkIds: ['chunk-2', 'chunk-1'] },
]);
assert.equal(sources.length, 1);
assert.deepEqual(sources[0].chunkIds, ['chunk-1', 'chunk-2']);

const personalPatterns = collectPersonalSymbolPatterns([
  { ai_result: { symbolic_notes: [{ symbol: 'cuốn sổ', meaning: 'Áp lực ghi nhớ trong trường hợp trước.' }] } },
  { ai_result: { symbolic_notes: [{ symbol: 'cuốn sổ', meaning: 'Một cách hiểu cũ khác.' }, { symbol: 'rắn', meaning: 'Không liên quan.' }] } },
], segments.dreamNarrative);
assert.equal(personalPatterns.length, 1);
assert.equal(personalPatterns[0].symbol, 'cuốn sổ');
assert.equal(personalPatterns[0].occurrences, 2);
assert.equal(isStrictExactMatch('cap', new Set(['cấp']), new Set(), false).matched, false);
assert.equal(isStrictExactMatch('can', new Set(['căn']), new Set(), false).matched, false);
assert.equal(isStrictExactMatch('water', new Set(['nước']), new Set(), false).matched, true);
const motifHints = extractContextualMotifHints(segments.dreamNarrative);
assert.equal(motifHints.includes('cuốn sổ'), true);
assert.equal(motifHints.includes('cây cầu'), true);
assert.equal(motifHints.includes('rắn'), false);

assert.equal(inferContextualTone('Tôi quay lại ngôi trường cấp ba cũ.'), 'neutral');
assert.equal(inferContextualTone('Tôi chạy qua cây cầu khi nước đang dâng cao.'), 'threatening');
assert.equal(inferContextualTone('Bà ôm tôi nhưng tôi vẫn sợ bị bắt kịp.'), 'ambivalent');

assert.equal(isVagueFollowUpQuestion('Bạn có đang trải qua một sự kiện quan trọng liên quan đến ngôi trường cấp ba cũ hoặc nhà bà ngoại không?'), true);
assert.equal(isVagueFollowUpQuestion('Bạn có đang lo lắng về việc quên mất điều gì quan trọng trong cuộc sống hiện tại không?'), true);
assert.equal(isVagueFollowUpQuestion('Trong hai tuần gần đây, bạn có đang chuẩn bị cho một việc đòi hỏi phải nhớ nhiều thông tin không?'), false);
assert.equal(isVagueFollowUpQuestion('Trong tuần này, bạn có áp lực công việc hoặc áp lực học tập không?'), true);

assert.equal(isSubstantiveCoreAnalysis('Một câu ngắn.'), false);
assert.equal(isSubstantiveCoreAnalysis(
  'Chuỗi sự kiện bắt đầu ở một không gian học tập cũ, rồi chuyển sang cảm giác bị thúc ép và sợ quên. '
  + 'Cuốn sổ trắng nối trực tiếp nỗi sợ mất thông tin với hành động chạy trốn khỏi tiếng bước chân. '
  + 'Cây cầu và dòng nước dâng tạo thành một ranh giới phải vượt qua để tiếp cận căn nhà gắn với ký ức tuổi thơ. '
  + 'Toàn bộ chuỗi này có thể phản ánh việc tâm trí đặt áp lực hiện tại cạnh một ký ức an toàn nhưng không còn dễ tiếp cận; đây vẫn là giả thuyết cần kiểm tra bằng hoàn cảnh thực tế.',
), true);

const threads = sanitizeInterpretiveThreads([{
  title: 'Từ nỗi sợ quên đến nơi trú ẩn ký ức',
  dreamEvidence: ['Tôi cầm một cuốn sổ nhưng các trang đều trắng.', 'Tôi chạy qua một cây cầu gỗ.'],
  reasoning: 'Cuốn sổ mất chữ tạo ra vấn đề về khả năng ghi nhớ, còn hành động chạy qua cầu cho thấy người kể đang tìm cách chuyển khỏi áp lực ấy sang một không gian ký ức quen thuộc.',
  alternativeExplanation: 'Hai hình ảnh cũng có thể chỉ là sự kết hợp gần đây của việc học và một ký ức cũ.',
}], segments.dreamNarrative);
assert.equal(threads.length, 1);
assert.equal(threads[0].dreamEvidence.length, 2);
assert.equal(sanitizeInterpretiveThreads([{ ...threads[0], dreamEvidence: ['một câu bịa'] }], segments.dreamNarrative).length, 0);

assert.equal(isGroundedDreamTitle('Trường Học và Cầu Thước', segments.dreamNarrative), false);
assert.equal(isGroundedDreamTitle('Ngôi Trường và Cuốn Sổ', segments.dreamNarrative), true);
assert.doesNotMatch(buildGroundedDreamTitle(segments.dreamNarrative, ['ngôi trường', 'cuốn sổ']), /thước/i);

const fallbackHypotheses = buildRuleGroundedFallbackHypotheses([
  { ruleId: 'memory-rule', ruleStatement: 'Recent waking-life experiences can be incorporated into dream content through autobiographical memory processing.' },
], `${segments.dreamNarrative} Tôi sợ mình sẽ quên một điều cần nhớ. Căn nhà của bà ngoại ở phía bên kia cầu gỗ.`);
assert.equal(fallbackHypotheses.length, 1);
assert.equal(fallbackHypotheses[0].ruleId, 'memory-rule');
assert.equal(fallbackHypotheses[0].questionDimension, 'recent_experience_incorporation');
assert.equal(isVagueFollowUpQuestion(fallbackHypotheses[0].followUpQuestion), false);
assert.match(fallbackHypotheses[0].reasonForAsking, /tác nhân gợi nhớ thật/);
assert.doesNotMatch(fallbackHypotheses[0].reasonForAsking, /\brule\b/iu);
const futureHypotheses = buildRuleGroundedFallbackHypotheses([
  { ruleId: 'prospective-rule', factor: 'dream sources may concern future events that will occur tomorrow' },
], `${segments.dreamNarrative} Tôi sợ quên cuốn sổ và tiếp tục chạy khỏi tiếng bước chân.`);
assert.equal(futureHypotheses.length, 1);
assert.equal(futureHypotheses[0].questionType, 'future');
assert.match(futureHypotheses[0].followUpQuestion, /bảy ngày tới/);
assert.match(futureHypotheses[0].reasonForAsking, /tình huống bị đánh giá thật/);
assert.doesNotMatch(futureHypotheses[0].reasonForAsking, /\brule\b/iu);
const futurePractical = buildPracticalReflectionsFromHypotheses(futureHypotheses);
assert.equal(futurePractical.length, 1);
assert.match(futurePractical[0].suggestion, /diễn tập một lần trong mười phút/);
const groundedNotebook = buildGroundedMotifExplanation({ symbol: 'cuốn sổ', dreamEvidence: 'Các trang đều trắng.', meaning: 'Cuốn sổ đại diện cho tri thức.' }, [{ ruleStatement: 'Memory is a major element of dreams.' }]);
assert.match(groundedNotebook, /cơ chế xử lý ký ức/);
assert.doesNotMatch(groundedNotebook, /đại diện cho tri thức/);
const groundedRelative = buildGroundedMotifExplanation({ symbol: 'bà ngoại', dreamEvidence: 'Tôi nhìn thấy bà ngoại.', meaning: 'Bà đại diện cho sự bảo vệ.' }, [{ ruleStatement: 'Autobiographical memory can be incorporated into dreams.' }]);
assert.match(groundedRelative, /chỉ kiểm tra xem ký ức này có vừa được khơi lại ngoài đời/);
assert.match(groundedRelative, /Không được suy ra người thân tượng trưng cho sự che chở/);
const groundedTicket = buildGroundedMotifExplanation({ symbol: 'tấm vé tàu', dreamEvidence: 'Trên bàn giáo viên có một tấm vé tàu ghi ngày hôm qua.', meaning: 'Tấm vé đại diện cho lựa chọn.' }, [{ ruleStatement: 'Autobiographical memory can be incorporated into dreams.' }]);
assert.match(groundedTicket, /ngày hôm qua.*dấu mốc quá khứ/);
const projectTicket = buildGroundedMotifExplanation({ symbol: 'tấm vé tàu', dreamEvidence: 'Cô giáo cũ đưa cho tôi một tấm vé tàu có in tên dự án mà tôi đang thực hiện.' }, [{ ruleStatement: 'Autobiographical memory can be incorporated into dreams.' }]);
assert.match(projectTicket, /tên dự án.*mối bận tâm hiện tại/);
assert.doesNotMatch(projectTicket, /ngày hôm qua|hai chuyến/);
const constructedBridge = buildGroundedMotifExplanation({ symbol: 'cây cầu', dreamEvidence: 'Tôi lấy những mảnh đồ chơi trong căn bếp thời thơ ấu để ghép thành một cây cầu.' }, [{ ruleStatement: 'Weak memory associations may be recombined in dreams.' }]);
assert.match(constructedBridge, /phương án giải quyết.*các mảnh có sẵn/);
assert.doesNotMatch(constructedBridge, /khó tiếp cận|bước ngoặt/);
const groundedWater = buildGroundedMotifExplanation({ symbol: 'mặt nước', dreamEvidence: 'Chuông tàu vang lên và sàn nhà biến thành mặt nước.', meaning: 'Mặt nước đại diện cho cảm xúc.' }, [{ ruleStatement: 'Autobiographical memory can be incorporated into dreams.' }]);
assert.match(groundedWater, /lấy đi chỗ đứng ổn định/);
const sanitizedClaims = sanitizeUnsupportedDreamClaims('Bà ngoại đại diện cho sự an ủi và bảo vệ. Cây cầu biểu thị một bước ngoặt trong cuộc sống.');
assert.match(sanitizedClaims, /chưa có đủ bằng chứng để gọi đó là biểu tượng của sự bảo vệ/);
assert.match(sanitizedClaims, /chưa có đủ bằng chứng để suy ra một bước ngoặt ngoài đời/);
assert.equal(isSubstantiveCoreAnalysis(ensureSubstantiveCoreAnalysis('Một phân tích ngắn.', [{ reasoning: 'Một mạch giải thích đủ dài nối cuốn sổ trắng với nỗi sợ quên và hành động chạy qua cây cầu để tiếp cận căn nhà gắn với ký ức tuổi thơ trong bối cảnh nước đang dâng cao.' }, { reasoning: 'Mạch thứ hai đối chiếu việc cánh cửa đóng lại với cảm giác tiếc nuối khi tỉnh dậy, cho thấy nhu cầu tìm câu trả lời nhưng chưa thể tiếp cận được nơi từng tạo cảm giác quen thuộc.' }])), true);
assert.equal(
  polishGeneratedDreamProse('Trong giấc mơ này, người mơ đứng giữa hai chuyến tàu. Người mơ cảm thấy gấp gáp.'),
  'Bạn đứng giữa hai chuyến tàu. Bạn cảm thấy gấp gáp.',
);
assert.match(polishGeneratedDreamProse('Giấc mơ này phản ánh áp lực phải lựa chọn.'), /^Chuỗi cảnh gợi tới/);
assert.equal(polishGeneratedDreamProse('Một câu lặp lại. Một câu lặp lại.'), 'Một câu lặp lại.');

const structuredScience = structureScientificNoteText('Nghiên cứu cho thấy trải nghiệm gần đây thường đi vào giấc mơ. Chi tiết ngôi trường cũ có thể được kiểm tra theo cơ chế này.');
assert.doesNotMatch(structuredScience.explanation, /^Nghiên cứu cho thấy/);
assert.match(structuredScience.explanation, /ngôi trường cũ/);
assert.equal(structuredScience.boundary, undefined);
const structuredBoundary = structureScientificNoteText('Tài liệu ghi nhận một xu hướng ở cuối đêm. Đây là xu hướng ở cấp nhóm, không cho phép dự đoán điều sẽ xảy ra với cá nhân. Mối liên hệ này không chứng minh nguyên nhân và không xác định một ý nghĩa cố định cho hình ảnh trong mơ.');
assert.match(structuredBoundary.explanation, /Tài liệu ghi nhận/);
assert.match(structuredBoundary.boundary || '', /cấp nhóm/);
assert.doesNotMatch(structuredBoundary.boundary || '', /ý nghĩa cố định/);
const practical = buildPracticalReflectionsFromHypotheses(fallbackHypotheses);
assert.equal(practical.length, 1);
assert.match(practical[0].suggestion, /ba ngày trước/);

const revisions = buildFeedbackRevision([{
  ruleId: 'memory-rule',
  hypothesis: 'Áp lực ghi nhớ có thể liên quan đến cuốn sổ trắng.',
  ifYesMeaning: 'Áp lực ghi nhớ được củng cố.',
  ifNoMeaning: 'Giả thuyết áp lực ghi nhớ giảm ưu tiên.',
}], [{ ruleId: 'memory-rule', hypothesisIndex: 0, answer: 'yes', effect: 'supports' }]);
assert.equal(revisions.length, 1);
assert.equal(revisions[0].status, 'supported');
assert.equal(revisions[0].interpretation, 'Áp lực ghi nhớ được củng cố.');
assert.equal(buildFeedbackRevision([], []).length, 0);

const stationNarrative = 'Gần sáng, phòng chờ giống lớp học tiểu học cũ. Trên bàn có vé ghi ngày hôm qua và bảng điện tử ghi 8 giờ sáng mai. Chuyến tàu đầu tiên rời ngay, còn chuyến tàu thứ hai đi vào tháng Chín năm sau. Tôi không biết phải lên chuyến nào vì cả hai đều sắp rời ga.';
const stationEvidenceLinks = [
  { ruleId: 'combined-future-rule', sourceId: 'source-future', sourceTitle: 'Future events in dreams', sourceYear: 2022, chunkIds: ['chunk-future'], chunkPreview: 'Dreams can combine future events at multiple time points.' },
  { ruleId: 'past-future-rule', sourceId: 'source-memory', sourceTitle: 'Memory sources in dreams', sourceYear: 2022, chunkIds: ['chunk-memory'], chunkPreview: 'Recent events can be incorporated into dreams.' },
];
const stationQuestions = buildRuleGroundedFallbackHypotheses([
  { ruleId: 'combined-future-rule', factor: 'dreams', outcome: 'combining future events', ruleStatement: 'Dreams can combine future events at multiple time points.' },
  { ruleId: 'past-future-rule', factor: 'episodic sources', outcome: 'temporal proximity', ruleStatement: 'Episodic sources close in time to sleep, including recent events, are often incorporated into dreams.' },
  { ruleId: 'implausible-rule', factor: 'future-related dreams', outcome: 'implausible scenarios', ruleStatement: 'Future dreams can contain implausible scenarios.' },
], stationNarrative);
assert.equal(stationQuestions.length, 2);
assert.equal(stationQuestions[0].verificationKey, 'combined-future-rule:multiple_future_horizons');
assert.match(stationQuestions[0].followUpQuestion, /kế hoạch kéo dài nhiều tháng/);
assert.equal(stationQuestions[0].answerSemantics.yes, 'supports');
assert.equal(stationQuestions[0].alternateQuestion.questionDimension, 'priority_pressure');
assert.match(stationQuestions[0].alternateQuestion.followUpQuestion, /hạn chót cụ thể/);
assert.doesNotMatch(stationQuestions[0].alternateQuestion.followUpQuestion, /chuẩn bị đồng thời/);
assert.equal(stationQuestions[1].verificationKey, 'past-future-rule:recent_experience_incorporation');
assert.match(stationQuestions[1].followUpQuestion, /ba ngày trước/);
assert.equal(stationQuestions[1].answerSemantics.no, 'weakens');
assert.equal(stationQuestions[1].alternateQuestion.questionDimension, 'recent_direct_exposure');
assert.match(stationQuestions[1].alternateQuestion.followUpQuestion, /trực tiếp nhìn thấy|nghe nhắc tới|tiếp xúc/);
const unsureExpandedQuestions = reconcileAlternateQuestionAfterFeedback(
  stationQuestions,
  stationQuestions[0].verificationKey,
  'unsure',
);
assert.equal(unsureExpandedQuestions.length, 2);
assert.equal(unsureExpandedQuestions[0].userFeedback, 'unsure');
assert.equal(reconcileAlternateQuestionAfterFeedback(
  stationQuestions,
  stationQuestions[0].verificationKey,
  'yes',
).length, 2);
assert.equal(reconcileAlternateQuestionAfterFeedback(
  unsureExpandedQuestions,
  stationQuestions[0].verificationKey,
  null,
).length, 2);
const continuityQuestions = buildRuleGroundedFallbackHypotheses([
  {
    ruleId: 'continuity-rule',
    factor: 'daily experiences and activities, especially current concerns',
    outcome: 'incorporated into dreams',
    ruleStatement: 'Daily experiences and activities, especially current concerns, are easily incorporated into dreams.',
    dreamFeatureTags: ['current concerns', 'daily activities'],
  },
], 'Tôi mơ thấy mình đến muộn một cuộc họp và không tìm thấy tài liệu cần trình bày.');
assert.equal(continuityQuestions.length, 1);
assert.equal(continuityQuestions[0].verificationKey, 'continuity-rule:waking_concern_incorporation');
assert.match(continuityQuestions[0].followUpQuestion, /trong bảy ngày trước giấc mơ/i);
assert.match(continuityQuestions[0].followUpQuestion, /cuộc họp/iu);
assert.equal(continuityQuestions[0].answerSemantics.yes, 'supports');
const stationSynthesis = buildCaseGroundedSynthesis(stationNarrative, stationQuestions, 'Một câu chung chung.');
assert.match(stationSynthesis, /phải chọn – thiếu thông tin – không kịp hoàn tất/);
assert.match(stationSynthesis, /việc gần hạn và một kế hoạch dài hơn/);
assert.doesNotMatch(stationSynthesis, /\brule\b|đại diện cho/iu);
assert.equal(buildCaseGroundedThreads(stationNarrative, []).length, 3);
assert.match(buildCaseGroundedThreads(stationNarrative, [])[1].reasoning, /áp lực phải trình bày hoặc được đánh giá/);
assert.deepEqual(deriveDreamEmotionTone(`${stationNarrative} Tôi tỉnh dậy cảm thấy gấp gáp, bối rối và tiếc nuối.`), {
  key: 'urgent_conflicted',
  label: 'Gấp gáp · bối rối · tiếc nuối',
});
assert.equal(inferContextualTone('Tấm vé ghi ngày hôm qua.'), 'neutral');
assert.doesNotMatch(removeInternalAnalysisVocabulary('Rule về nguồn sự kiện và quy luật đã duyệt.'), /rule|quy luật/iu);
assert.match(buildFeedbackConclusion([{ status: 'supported', interpretation: 'Câu trả lời Có hỗ trợ giả thuyết rằng ký ức trường cũ vừa được gợi lại.' }]) || '', /ký ức trường cũ vừa được gợi lại/);
const refreshedStation = enrichScientificNotesForResponse({
  emotional_tone: 'Một nhãn ngẫu nhiên từ mô hình',
  dreamValenceScore: 45,
  score_breakdown: { finalScore: 45 },
  scientific_context_notes: [],
  real_life_hypotheses: [{
    ruleId: 'past-future-rule',
    followUpQuestion: 'Một câu hỏi cũ.',
    hypothesis: 'Một giả thuyết cũ.',
    evidenceFromDream: ['ngày hôm qua'],
    confidence: 0,
    needsUserConfirmation: true,
  }],
}, {
  componentD: {
    appliedRules: [
      { ruleId: 'combined-future-rule', factor: 'dreams', outcome: 'combine future events', ruleStatement: 'Dreams can combine future events.' },
      { ruleId: 'past-future-rule', factor: 'episodic sources', outcome: 'temporal proximity', ruleStatement: 'Episodic sources close in time to sleep, including recent events, are often incorporated into dreams.' },
    ],
    evidenceLinks: stationEvidenceLinks,
  },
}, `${stationNarrative} Tôi tỉnh dậy cảm thấy gấp gáp, bối rối và tiếc nuối.`);
assert.equal(refreshedStation.real_life_hypotheses.length, 4);
assert.deepEqual(refreshedStation.real_life_hypotheses.map((item: any) => item.questionDimension), [
  'multiple_future_horizons', 'priority_pressure', 'recent_experience_incorporation', 'recent_direct_exposure',
]);
assert.equal(refreshedStation.emotional_tone_key, 'urgent_conflicted');
assert.equal('dreamValenceScore' in refreshedStation, false);
assert.equal('score_breakdown' in refreshedStation, false);
assert.equal(refreshedStation.interpretive_threads.length, 3);
const motifNarrative = 'Tôi đứng trong một nhà ga. Trên bàn có một tấm vé tàu ghi ngày hôm qua. Cô giáo đưa cho tôi một chiếc cặp khóa kín. Tôi chưa kịp mở thì sàn nhà biến thành mặt nước.';
const contextualMotifs = buildContextualMotifNotes(motifNarrative, []);
assert.deepEqual(contextualMotifs.map(item => item.symbol), ['nhà ga', 'tấm vé tàu', 'chiếc cặp khóa', 'mặt nước']);
assert.equal(contextualMotifs.every(item => item.meaning.length > 100 && item.dreamEvidence.length > 0), true);
const answeredStationQuestions = stationQuestions.map((item, index) => ({
  ...item,
  userFeedback: index === 0 ? 'yes' : 'no',
}));
const feedbackAnalysis = buildFeedbackAppliedAnalysis(answeredStationQuestions);
assert.equal(feedbackAnalysis?.confirmedFacts.length, 1);
assert.equal(feedbackAnalysis?.rejectedDirections.length, 1);
const feedbackThreads = applyFeedbackToThreads(buildCaseGroundedThreads(stationNarrative, []), answeredStationQuestions);
assert.match(feedbackThreads[0].reasoning, /đã xác nhận/);
assert.match(feedbackThreads[1].reasoning, /loại hướng/);
const yesReflections = buildPracticalReflectionsFromHypotheses(answeredStationQuestions);
assert.match(yesReflections[0].suggestion, /Tách việc gần hạn/);
const noConflictReflections = buildPracticalReflectionsFromHypotheses([
  { ...stationQuestions[0], userFeedback: 'no' },
]);
assert.match(noConflictReflections[0].suggestion, /Không cần tiếp tục tìm hai kế hoạch/);
const sleepNarrative = `${stationNarrative} Chuông tàu vang lên và tôi tỉnh dậy.`;
const persistedQuestionTree = enrichScientificNotesForResponse({
  title: 'Question identity',
  summary: 'Question identity',
  core_analysis: 'Question identity',
  symbolic_notes: [],
  scientific_context_notes: [],
  interpretive_threads: [],
  real_life_hypotheses: stationQuestions.map(item => ({ ...item, userFeedback: 'unsure' })),
}, {
  componentD: {
    appliedRules: [
      { ruleId: 'combined-future-rule', factor: 'dreams', outcome: 'combine future events', ruleStatement: 'Dreams can combine future events.' },
      { ruleId: 'past-future-rule', factor: 'episodic sources', outcome: 'temporal proximity', ruleStatement: 'Episodic sources close in time to sleep, including recent events, are often incorporated into dreams.' },
    ],
    evidenceLinks: stationEvidenceLinks,
  },
}, sleepNarrative);
const persistedFeedbackByKey = new Map(persistedQuestionTree.real_life_hypotheses
  .map((item: any) => [item.verificationKey, item.userFeedback]));
assert.equal(persistedFeedbackByKey.get(stationQuestions[0].verificationKey), 'unsure');
assert.equal(persistedQuestionTree.real_life_hypotheses.some((item: any) =>
  item.questionDimension === 'external_sound_at_wake'), false);
const persistedWithAlternate = enrichScientificNotesForResponse({
  ...persistedQuestionTree,
  real_life_hypotheses: reconcileAlternateQuestionAfterFeedback(
    persistedQuestionTree.real_life_hypotheses,
    stationQuestions[0].verificationKey,
    'unsure',
  ),
}, {
  componentD: {
    appliedRules: [
      { ruleId: 'combined-future-rule', factor: 'dreams', outcome: 'combine future events', ruleStatement: 'Dreams can combine future events.' },
      { ruleId: 'past-future-rule', factor: 'episodic sources', outcome: 'temporal proximity', ruleStatement: 'Episodic sources close in time to sleep, including recent events, are often incorporated into dreams.' },
    ],
    evidenceLinks: stationEvidenceLinks,
  },
}, sleepNarrative);
assert.equal(persistedWithAlternate.real_life_hypotheses.length, 4);
assert.equal(persistedWithAlternate.real_life_hypotheses[1].questionDimension, 'priority_pressure');
assert.match(persistedWithAlternate.real_life_hypotheses[1].followUpQuestion, /hạn chót cụ thể/);
const resolvedQuestionTree = enrichScientificNotesForResponse({
  ...persistedQuestionTree,
  real_life_hypotheses: persistedQuestionTree.real_life_hypotheses.map((item: any) =>
    item.questionDimension === 'multiple_future_horizons' ? { ...item, userFeedback: null } : item),
}, {
  componentD: {
    appliedRules: [
      { ruleId: 'combined-future-rule', factor: 'dreams', outcome: 'combine future events', ruleStatement: 'Dreams can combine future events.' },
      { ruleId: 'past-future-rule', factor: 'episodic sources', outcome: 'temporal proximity', ruleStatement: 'Episodic sources close in time to sleep, including recent events, are often incorporated into dreams.' },
    ],
    evidenceLinks: stationEvidenceLinks,
  },
}, sleepNarrative);
assert.equal(resolvedQuestionTree.real_life_hypotheses.every((item: any) =>
  item.ruleId && item.questionBasis === 'academic_rule'), true);
const deduplicatedMotifs = deduplicateOverlappingMotifNotes([
  { symbol: 'mặt nước', dreamEvidence: 'Sàn nhà biến thành mặt nước.', dictionarySymbol: 'Water' },
  { symbol: 'sàn nhà biến thành mặt nước', dreamEvidence: 'Sàn nhà biến thành mặt nước.', dictionarySymbol: 'Water' },
]);
assert.deepEqual(deduplicatedMotifs.map(item => item.symbol), ['mặt nước']);
const refreshedMotifFallback = enrichScientificNotesForResponse({
  title: 'Fallback',
  summary: 'Fallback',
  core_analysis: 'Fallback',
  symbolic_notes: [],
  scientific_context_notes: [],
  real_life_hypotheses: [],
  interpretive_threads: [],
}, {
  componentC: {
    personalSymbolPatterns: [{ symbol: 'nhà ga', occurrences: 2, recentMeaning: 'Một nơi phải lựa chọn.' }],
    similarDreams: [{
      excerpt: 'Tôi đứng trong một nhà ga.',
      dreamId: 'prior-1',
      matchedOn: ['Cùng tình tiết hoặc mô-típ'],
      confirmedContext: [{ answer: 'yes', question: 'Có việc gần hạn không?' }],
    }],
  },
  componentD: { appliedRules: [], evidenceLinks: [] },
}, motifNarrative);
assert.equal(refreshedMotifFallback.symbolic_notes.length, 4);
assert.equal(refreshedMotifFallback.grounding_summary.contextualMotifCount, 4);
assert.equal(refreshedMotifFallback.symbolic_notes[0].motifStats.previousPersonalDreamCount, 2);
assert.equal(refreshedMotifFallback.symbolic_notes[0].motifStats.similarDreamCount, 1);
assert.equal(refreshedMotifFallback.symbolic_notes[0].motifStats.sameSequenceCount, 1);
assert.equal(refreshedMotifFallback.symbolic_notes[0].motifStats.confirmedContextCount, 1);
const stationScientific = buildRuleScientificFallback({
  ruleStatement: 'Some dreams combine future events occurring at different time points.',
  outcome: 'combining future events',
}, stationNarrative);
assert.equal(stationScientific, null);
assert.equal(buildScientificInsightTitle({ ruleStatement: 'Dreams can combine future events at multiple time points.' }), 'Hai mốc tương lai cùng xuất hiện');
assert.deepEqual(collectScientificDreamEvidence({
  note: 'Hai mốc “8 giờ sáng mai” và “không có trong lời kể” được so sánh.',
  dreamEvidence: ['phòng chờ giống lớp học tiểu học cũ'],
}, stationNarrative, ['Chuyến tàu đầu tiên rời ngay']), [
  'phòng chờ giống lớp học tiểu học cũ',
  '8 giờ sáng mai',
  'Chuyến tàu đầu tiên rời ngay',
]);
const verifiedScientificNote = buildVerifiedScientificNote({
  rule: {
    ruleId: 'future-rule',
    ruleCode: 'KR3_FUTURE',
    ruleStatement: 'Memory consolidation supports the processing of recent experiences during sleep.',
  },
  noteText: 'Quá trình củng cố ký ức trong khi ngủ có thể sắp xếp lại những trải nghiệm vừa xảy ra. Hai mốc thời gian trong lời kể là phần cần kiểm tra trong trường hợp này.',
  narrative: stationNarrative,
  dreamEvidence: ['8 giờ sáng mai', 'một chi tiết không tồn tại'],
  sources: [{ sourceId: 'source-1', title: 'Future events in dreams', authors: ['A. Author'], year: 2022 }],
  evidenceQuotes: [{ sourceId: 'source-1', chunkId: 'chunk-1', quote: 'A verified exact quote.' }],
  confidence: 0.73,
});
assert.equal(verifiedScientificNote?.ruleCode, 'KR3_FUTURE');
assert.deepEqual(verifiedScientificNote?.matchedDreamDetails, ['8 giờ sáng mai']);
assert.equal(verifiedScientificNote?.evidenceQuotes.length, 1);
const mechanismFallbackNotes = buildVerifiedMechanismFallbackNotes([{
  ruleId: 'mechanism-rule',
  ruleCode: 'KR3_MEMORY',
  applicationRole: 'psychological_mechanism',
  factor: 'waking life experiences',
  outcome: 'dream content',
  ruleStatement: 'Waking life experiences are selectively incorporated in dream content, and this procedure could be interpreted by memory consolidation.',
}], [{
  ruleId: 'mechanism-rule',
  sourceId: 'source-1',
  sourceTitle: 'Memory and dreaming',
  sourceYear: 2022,
  chunkIds: ['chunk-1'],
  chunkPreview: 'Waking life experiences are selectively incorporated in dream content.',
}], stationNarrative, stationQuestions);
assert.equal(mechanismFallbackNotes.length, 1);
assert.equal(mechanismFallbackNotes[0].evidenceQuotes[0].chunkId, 'chunk-1');
assert.equal(buildVerifiedScientificNote({
  rule: { ruleId: 'future-rule' },
  noteText: 'Quá trình củng cố ký ức trong khi ngủ có thể sắp xếp lại những trải nghiệm vừa xảy ra. Hai mốc thời gian trong lời kể là phần cần kiểm tra trong trường hợp này.',
  narrative: stationNarrative,
  sources: [{ sourceId: 'source-1', title: 'Future events in dreams' }],
  evidenceQuotes: [{ sourceId: 'unrelated-source', chunkId: 'chunk-1', quote: 'Not owned by the source.' }],
  confidence: 0.5,
}), null);
const enrichedLegacyAnalysis = enrichScientificNotesForResponse({
  scientific_context_notes: [{
    ruleId: 'future-rule',
    note: stationScientific,
    confidence: 0.73,
    sources: [{ sourceId: 'source-1', title: 'Future events in dreams', authors: ['A. Author'], year: 2022 }],
  }],
}, {
  componentD: {
    appliedRules: [{ ruleId: 'future-rule', ruleCode: 'KR3_FUTURE', ruleStatement: 'Dreams can combine future events at multiple time points.' }],
    evidenceLinks: [{ ruleId: 'future-rule', sourceId: 'source-1', chunkIds: ['chunk-1'], chunkPreview: 'A verified exact quote.' }],
  },
}, stationNarrative);
assert.equal(enrichedLegacyAnalysis.scientific_context_notes.length, 0);
const termiteScientific = buildRuleScientificFallback({
  ruleStatement: "A termite's nest is an example of self-organization.",
}, stationNarrative);
assert.equal(termiteScientific, null);

const feedbackChangeSet = buildFeedbackChangeSet({
  core_analysis: 'Câu này được giữ nguyên. Cách hiểu cũ chưa có dữ kiện.',
  interpretive_threads: [{ reasoning: 'Đoạn này không đổi.' }],
  case_conclusion: {
    conclusion: 'Đây mới là giả thuyết ban đầu.',
    recommendedNextStep: 'Trả lời câu hỏi xác nhận.',
  },
}, {
  core_analysis: 'Câu này được giữ nguyên. Câu trả lời Có xác nhận một việc gần hạn đang tồn tại.',
  interpretive_threads: [{ reasoning: 'Đoạn này không đổi.' }],
  case_conclusion: {
    conclusion: 'Buổi trình bày là bối cảnh thật của giấc mơ.',
    recommendedNextStep: 'Viết ba ý chính và diễn tập một lần.',
  },
});
assert.deepEqual(feedbackChangeSet.paths, [
  'core_analysis',
  'case_conclusion.conclusion',
  'case_conclusion.recommendedNextStep',
]);
assert.deepEqual(feedbackChangeSet.fragments.core_analysis, [
  'Câu trả lời Có xác nhận một việc gần hạn đang tồn tại.',
]);
assert.deepEqual(feedbackChangeSet.fragments['case_conclusion.conclusion'], [
  'Buổi trình bày là bối cảnh thật của giấc mơ.',
]);
const feedbackFactOnlyChange = buildFeedbackChangeSet({
  feedback_analysis: { confirmedFacts: ['Dữ kiện thứ nhất.'], interpretation: 'Kết luận giữ nguyên.' },
}, {
  feedback_analysis: { confirmedFacts: ['Dữ kiện thứ nhất.', 'Dữ kiện thứ hai.'], interpretation: 'Kết luận giữ nguyên.' },
});
assert.deepEqual(feedbackFactOnlyChange.paths, ['feedback_analysis.confirmedFacts.1']);

const familyDream = 'Tôi quay lại ngôi trường cũ và cầm một cuốn sổ trắng. Tôi nghe tiếng bước chân rồi chạy vì bị đuổi theo; nếu bị bắt kịp tôi sợ mình sẽ quên điều rất quan trọng. Phía bên kia cầu là nhà cũ của bà ngoại. Tôi muốn hỏi bà nhưng cửa đóng lại. Tôi tỉnh dậy với tim đập nhanh.';
const familyResponse = enrichScientificNotesForResponse({
  title: 'Family dream',
  summary: 'Family dream',
  core_analysis: 'Cuốn sổ trắng đi cùng nỗi sợ quên và việc cố tìm tới bà ngoại.',
  symbolic_notes: [],
  scientific_context_notes: [],
  interpretive_threads: [],
  real_life_hypotheses: [],
}, {
  componentA: { sleepContext: {} },
  componentD: {
    appliedRules: [{
      ruleId: 'memory-rule',
      factor: 'recent waking-life experience',
      outcome: 'dream content',
      ruleStatement: 'Recent waking-life experiences can be incorporated into dream content through autobiographical memory processing.',
    }],
    evidenceLinks: [{
      ruleId: 'memory-rule',
      sourceId: 'source-memory',
      sourceTitle: 'Memory and dreaming',
      sourceYear: 2022,
      chunkIds: ['chunk-memory'],
      chunkPreview: 'Recent waking-life experiences can be incorporated into dream content.',
    }],
  },
}, familyDream);
assert.deepEqual(familyResponse.real_life_hypotheses.map((item: any) => item.questionDimension), [
  'recent_experience_incorporation',
  'recent_direct_exposure',
]);
assert.equal(familyResponse.real_life_hypotheses[0].ruleId, 'memory-rule');
assert.match(familyResponse.real_life_hypotheses[0].followUpQuestion, /bà ngoại/);
assert.equal(familyResponse.real_life_hypotheses[0].sources[0].sourceId, 'source-memory');
assert.equal(familyResponse.real_life_hypotheses.every((item: any) => item.questionBasis === 'academic_rule'), true);
assert.equal(familyResponse.interpretive_threads.length, 2);
assert.match(familyResponse.interpretive_threads[0].reasoning, /mất.*thông tin|sợ quên/iu);
assert.match(familyResponse.interpretive_threads[1].reasoning, /bà ngoại/iu);
assert.doesNotMatch(familyResponse.real_life_hypotheses[0].followUpQuestion, /trấn an|che chở/);
const genericMemoryResponse = enrichScientificNotesForResponse({
  real_life_hypotheses: [], symbolic_notes: [], scientific_context_notes: [], interpretive_threads: [],
}, {
  componentD: {
    appliedRules: [{ ruleId: 'generic-memory', ruleStatement: 'Memory consolidation occurs during sleep.' }],
    evidenceLinks: [],
  },
}, familyDream);
assert.equal(genericMemoryResponse.real_life_hypotheses.length, 0);
const soundBackedResponse = enrichScientificNotesForResponse({
  real_life_hypotheses: [], symbolic_notes: [], scientific_context_notes: [], interpretive_threads: [],
}, {
  componentA: { sleepContext: {} },
  componentD: {
    appliedRules: [{
      ruleId: 'sound-rule',
      ruleStatement: 'External auditory stimuli during sleep can be incorporated into dream content.',
    }],
    evidenceLinks: [{
      ruleId: 'sound-rule', sourceId: 'source-sound', sourceTitle: 'Auditory stimuli and dreams',
      chunkIds: ['chunk-sound'], chunkPreview: 'External auditory stimuli can be incorporated into dreams.',
    }],
  },
}, familyDream);
assert.equal(soundBackedResponse.real_life_hypotheses.length, 1);
assert.equal(soundBackedResponse.real_life_hypotheses[0].questionDimension, 'external_sound_at_wake');
assert.equal(soundBackedResponse.real_life_hypotheses[0].ruleId, 'sound-rule');
const attachmentBackedResponse = enrichScientificNotesForResponse({
  real_life_hypotheses: [], symbolic_notes: [], scientific_context_notes: [], interpretive_threads: [],
}, {
  componentD: {
    appliedRules: [{
      ruleId: 'attachment-rule',
      ruleStatement: 'Under threat or distress, attachment-system activation can increase proximity-seeking toward a trusted support figure.',
    }],
    evidenceLinks: [{
      ruleId: 'attachment-rule', sourceId: 'source-attachment', sourceTitle: 'Attachment under threat',
      chunkIds: ['chunk-attachment'],
      chunkPreview: 'Threat can activate proximity-seeking toward a trusted support figure.',
    }],
  },
}, familyDream);
assert.equal(attachmentBackedResponse.real_life_hypotheses.length, 2);
assert.equal(attachmentBackedResponse.real_life_hypotheses[0].questionDimension, 'attachment_support_under_stress');
assert.match(attachmentBackedResponse.real_life_hypotheses[0].followUpQuestion, /bà ngoại.*an toàn/);
assert.equal(attachmentBackedResponse.real_life_hypotheses[0].ruleId, 'attachment-rule');
const familyWithMemoryConfirmed = enrichScientificNotesForResponse({
  ...familyResponse,
  real_life_hypotheses: familyResponse.real_life_hypotheses.map((item: any) =>
    item.questionDimension === 'recent_experience_incorporation' ? { ...item, userFeedback: 'yes' } : item),
}, {
  componentA: { sleepContext: {} },
  componentD: {
    appliedRules: [{
      ruleId: 'memory-rule',
      factor: 'recent waking-life experience',
      outcome: 'dream content',
      ruleStatement: 'Recent waking-life experiences can be incorporated into dream content through autobiographical memory processing.',
    }],
    evidenceLinks: [{
      ruleId: 'memory-rule', sourceId: 'source-memory', sourceTitle: 'Memory and dreaming',
      sourceYear: 2022, chunkIds: ['chunk-memory'],
      chunkPreview: 'Recent waking-life experiences can be incorporated into dream content.',
    }],
  },
}, familyDream);
assert.match(familyWithMemoryConfirmed.core_analysis, /sự việc thật gợi bạn nghĩ tới bà ngoại/);
const grandmotherNote = familyWithMemoryConfirmed.symbolic_notes.find((item: any) => item.symbol === 'bà ngoại');
assert.match(grandmotherNote?.meaning || '', /nguồn ký ức gần đây cụ thể/);
const familyReenriched = enrichScientificNotesForResponse(familyWithMemoryConfirmed, {
  componentA: { sleepContext: {} },
  componentD: {
    appliedRules: [{
      ruleId: 'memory-rule', factor: 'recent waking-life experience', outcome: 'dream content',
      ruleStatement: 'Recent waking-life experiences can be incorporated into dream content through autobiographical memory processing.',
    }],
    evidenceLinks: [{
      ruleId: 'memory-rule', sourceId: 'source-memory', sourceTitle: 'Memory and dreaming',
      sourceYear: 2022, chunkIds: ['chunk-memory'],
      chunkPreview: 'Recent waking-life experiences can be incorporated into dream content.',
    }],
  },
}, familyDream);
assert.equal(familyReenriched.core_analysis, familyWithMemoryConfirmed.core_analysis);
assert.equal((familyReenriched.core_analysis.match(/Thông tin bạn vừa xác nhận/gu) || []).length, 1);

const corruptedFamilyThread = {
  title: 'Ký ức và cảm giác bị truy đuổi',
  dreamEvidence: ['Phía bên kia cầu là nhà cũ của bà ngoại.', 'Tôi nghe tiếng bước chân rồi chạy vì bị đuổi theo.'],
  reasoning: 'Căn nhà của bà ngoại nối ký ức gia đình với cảnh chạy trốn. Bạn đã xác nhận trường cũ vừa được gợi lại gần đây, vì vậy bối cảnh trường học có một nguồn ký ức cụ thể thay vì chỉ là cách gán nghĩa biểu tượng. Bạn không ghi nhận tác nhân gợi nhớ gần đây, nên cách giải thích bằng ký ức vừa kích hoạt bị loại; mạch này chỉ còn đáng xét nếu có áp lực bị đánh giá hoặc thiếu chuẩn bị ngoài đời. Bạn đã xác nhận trường cũ vừa được gợi lại gần đây, vì vậy bối cảnh trường học có một nguồn ký ức cụ thể thay vì chỉ là cách gán nghĩa biểu tượng.',
  alternativeExplanation: 'Cảnh này cũng có thể chỉ nối hai ký ức quen thuộc.',
};
assert.equal(stripGeneratedThreadFeedback(corruptedFamilyThread.reasoning), 'Căn nhà của bà ngoại nối ký ức gia đình với cảnh chạy trốn.');
const memoryQuestion = {
  questionDimension: 'recent_experience_incorporation',
  matchedCue: 'bà ngoại',
  verificationKey: 'memory-rule:recent_experience_incorporation:ba-ngoai',
};
const familyThreadYes = applyFeedbackToThreads([corruptedFamilyThread], [{ ...memoryQuestion, userFeedback: 'yes' }]);
assert.match(familyThreadYes[0].reasoning, /gợi nhớ tới bà ngoại/);
assert.doesNotMatch(familyThreadYes[0].reasoning, /trường cũ vừa được gợi lại/);
assert.equal((familyThreadYes[0].reasoning.match(/gợi nhớ tới bà ngoại/gu) || []).length, 1);
const familyThreadNo = applyFeedbackToThreads(familyThreadYes, [{ ...memoryQuestion, userFeedback: 'no' }]);
assert.match(familyThreadNo[0].reasoning, /không ghi nhận sự việc gần đây nào gợi nhớ tới bà ngoại/iu);
assert.doesNotMatch(familyThreadNo[0].reasoning, /đã xác nhận một sự việc gần đây/iu);
const familyThreadUnsure = applyFeedbackToThreads(familyThreadNo, [{ ...memoryQuestion, userFeedback: 'unsure' }]);
assert.equal(familyThreadUnsure[0].reasoning, 'Căn nhà của bà ngoại nối ký ức gia đình với cảnh chạy trốn.');
assert.deepEqual(
  applyFeedbackToThreads(familyThreadUnsure, [{ ...memoryQuestion, userFeedback: 'unsure' }]),
  familyThreadUnsure,
);
assert.equal(polishGeneratedDreamProse('Nội dung không liên quanse đến sự kiện cụ thể.'), 'Nội dung không liên quan đến sự kiện cụ thể.');
assert.doesNotMatch(
  buildGroundedMotifExplanation({ symbol: 'bà ngoại', dreamEvidence: 'Tôi thấy bà ngoại.' }, [{ ruleStatement: 'Memory consolidation affects dream content.' }]),
  /Ý nghĩa cụ thể phải dựa/,
);

const compositeQuestions = buildRuleGroundedFallbackHypotheses([{
  ruleId: 'composite-rule',
  isComposite: true,
  compositeComponents: [{
    sourceRuleId: 'future-a', ruleCode: 'KR3_FUTURE_A',
    statement: 'Dreams can incorporate anticipated future events.', subject: 'anticipated future event', outcome: 'prospective dream content',
    conditions: [], limitations: [], dreamFeatureTags: ['upcoming events'],
  }, {
    sourceRuleId: 'future-b', ruleCode: 'KR3_FUTURE_B',
    statement: 'Prospective dreams can draw on upcoming events.', subject: 'upcoming event', outcome: 'prospective dream content',
    conditions: [], limitations: [], dreamFeatureTags: ['upcoming events'],
  }, {
    sourceRuleId: 'memory-a', ruleCode: 'KR3_MEMORY_A',
    statement: 'Recent waking-life experiences can be incorporated into dream content.', subject: 'recent events', outcome: 'dream content',
    conditions: [], limitations: [], dreamFeatureTags: ['old school'],
  }],
}], 'Tôi quay lại trường cũ và cầm một cuốn sổ. Tôi nhớ rằng ngày mai phải trình bày trước nhiều người.');
assert.equal(compositeQuestions.filter(item => item.questionDimension === 'prospective_demand').length, 1,
  'equivalent component questions must be deduplicated by verification dimension');
assert.equal(compositeQuestions.filter(item => item.questionDimension === 'recent_experience_incorporation').length, 1,
  'a genuinely different component question must remain available');
assert.ok(compositeQuestions.every(item => item.ruleId === 'composite-rule'),
  'all component questions must remain attributed to the composite rule');

const sharedQuestionAcrossRules = buildRuleGroundedFallbackHypotheses([{
  ruleId: 'future-rule-a',
  factor: 'anticipated future events', outcome: 'prospective dream content',
  ruleStatement: 'Dreams can incorporate anticipated future events.',
}, {
  ruleId: 'future-rule-b',
  factor: 'upcoming events', outcome: 'prospective dream content',
  ruleStatement: 'Upcoming events can appear in prospective dreams.',
}], 'Tôi mơ thấy mình ở trường và chạy đi tìm cuốn sổ vì ngày mai phải thuyết trình trước mọi người.');
assert.equal(sharedQuestionAcrossRules.length, 1, 'identical questions across rules must be asked once');
assert.deepEqual(sharedQuestionAcrossRules[0].ruleIds, ['future-rule-a', 'future-rule-b'],
  'one answer must retain links to every rule tested by the shared question');
assert.deepEqual(resolveQuestionRuleIds(sharedQuestionAcrossRules[0]), ['future-rule-a', 'future-rule-b'],
  'feedback persistence must fan one answer out to every linked rule statistic');
assert.notEqual(
  normalizeGroundingText(sharedQuestionAcrossRules[0].followUpQuestion),
  normalizeGroundingText(sharedQuestionAcrossRules[0].alternateQuestion.followUpQuestion),
  'a preloaded follow-up must collect a genuinely different datum',
);

const unsureAdjustedCore = buildCaseGroundedSynthesis(
  'Tôi mơ thấy mình đến muộn một cuộc họp.',
  [{ ...continuityQuestions[0], userFeedback: 'unsure' }],
  'Cuộc họp tạo cảm giác gấp gáp.',
);
assert.match(unsureAdjustedCore, /Chưa biết|để mở|không được dùng làm kết luận chính/iu,
  'an unsure answer must still change the rendered analysis while keeping the direction unresolved');

const recombinationDream = 'Tôi mơ mình quay lại lớp học tiểu học cũ, nhưng bảng đen đã biến thành lịch của một cuộc họp sắp tới. Cô giáo cũ đưa cho tôi một tấm vé tàu có in tên dự án mà tôi đang thực hiện. Tôi bước lên một đoàn tàu làm bằng những bàn phím máy tính; nó chạy qua biển rồi đưa tôi tới một văn phòng trên Mặt Trăng. Ở đó tôi phải trình bày trước rất nhiều người, nhưng thay vì sử dụng slide, tôi lấy những mảnh đồ chơi trong căn bếp thời thơ ấu để ghép thành một cây cầu. Khi cây cầu hoàn thành, khán giả biến thành một đàn chim và bay xuyên qua trần nhà.';
const exploratoryCompositeRule = {
  ruleId: 'recombination-rule', ruleCode: 'KR3_RECOMBINATION',
  ruleStatement: 'Weak associations may contribute to flexible thinking in implausible future-related dreams.',
  factor: 'weak associations', outcome: 'creative and divergent thinking',
  evidenceScore: 19,
  applicationTier: 'exploratory', applicationRole: 'contextual_probe', isComposite: true,
  compositeComponents: [{
    sourceRuleId: 'weak-component', ruleCode: 'KR3_WEAK',
    statement: 'The activation of weak associations may be a component of creative, flexible, and divergent thinking.',
    subject: 'weak associations', outcome: 'creative thinking', conditions: [], limitations: [], dreamFeatureTags: [],
  }, {
    sourceRuleId: 'implausible-component', ruleCode: 'KR3_IMPLAUSIBLE',
    statement: 'Future-related dreams are often highly implausible scenarios.',
    subject: 'future-related dreams', outcome: 'highly implausible scenarios', conditions: [], limitations: [], dreamFeatureTags: [],
  }, {
    sourceRuleId: 'prospective-component', ruleCode: 'KR3_PROSPECTIVE',
    statement: 'Dreaming is not strictly the same process as waking prospective thought.',
    subject: 'dreaming', outcome: 'not strictly the same process as waking prospective thought', conditions: [], limitations: [], dreamFeatureTags: [],
  }],
};
const exploratoryContext = {
  componentD: {
    appliedRules: [exploratoryCompositeRule],
    evidenceLinks: [{
      ruleId: 'recombination-rule', sourceId: 'source-recombination', sourceTitle: 'Constructive episodic simulation in dreams',
      sourceYear: 2022, doi: '10.1371/journal.pone.0264574', chunkIds: ['chunk-recombination'],
      chunkPreview: 'The activation of weak associations may be a critical component of creative, flexible, and divergent thinking.',
    }],
  },
};
const exploratoryResponse = enrichScientificNotesForResponse({
  title: 'Tấm vé và cây cầu', summary: 'Một chuỗi cảnh phi thực tế.',
  core_analysis: 'Lớp học cũ nối với dự án hiện tại và một buổi trình bày trong bối cảnh phi thực tế.',
  real_life_hypotheses: [], scientific_context_notes: [], symbolic_notes: [], interpretive_threads: [],
}, exploratoryContext, recombinationDream);
assert.deepEqual(exploratoryResponse.real_life_hypotheses.map((item: any) => item.questionDimension), [
  'weak_association_recombination', 'creative_problem_preoccupation', 'implausible_future_scenario',
  'waking_prospective_difference', 'novel_solution_origin',
]);
assert.match(exploratoryResponse.real_life_hypotheses[0].followUpQuestion, /ít nhất hai chi tiết/iu);
assert.match(exploratoryResponse.real_life_hypotheses[1].followUpQuestion, /cách trình bày hoặc giải quyết mới/iu);
assert.equal(new Set(exploratoryResponse.real_life_hypotheses
  .map((item: any) => normalizeGroundingText(item.followUpQuestion))).size, 5,
  'all preloaded exploratory questions must collect distinct data');
assert.equal(exploratoryResponse.real_life_hypotheses.every((item: any) => item.applicationTier === 'exploratory'), true);
assert.equal(exploratoryResponse.grounding_summary.exploratoryRuleCount, 1);
assert.equal(exploratoryResponse.grounding_summary.explanatoryRuleCount, 0);
assert.match(exploratoryResponse.core_analysis, /Chưa có câu trả lời cho 5 chiều dữ kiện/);
assert.equal(exploratoryResponse.scientific_context_notes[0]?.applicationTier, 'exploratory');
assert.match(exploratoryResponse.scientific_context_notes[0]?.note || '', /liên hệ lỏng|mảnh ký ức/iu);
const exploratoryAnswered = enrichScientificNotesForResponse({
  ...exploratoryResponse,
  real_life_hypotheses: exploratoryResponse.real_life_hypotheses.map((item: any, index: number) =>
    index === 0 ? { ...item, userFeedback: 'yes' } : item),
}, exploratoryContext, recombinationDream);
assert.match(exploratoryAnswered.core_analysis, /Đã đối chiếu 1\/5 chiều dữ kiện/);
assert.match(exploratoryAnswered.scientific_context_notes[0]?.note || '', /Đã đối chiếu 1\/5 chiều dữ kiện/);

const allExploratoryYes = exploratoryResponse.real_life_hypotheses.map((item: any) => ({ ...item, userFeedback: 'yes' }));
const allYesAssessment = buildExploratoryCaseAssessment(allExploratoryYes, exploratoryCompositeRule);
assert.equal(allYesAssessment?.status, 'strong_match');
assert.equal(allYesAssessment?.answeredCount, 5);
assert.equal(allYesAssessment?.confirmedCount, 5);
assert.match(allYesAssessment?.conclusion || '', /Đã đối chiếu 5\/5/);
assert.match(allYesAssessment?.conclusion || '', /biến đổi một phương án có sẵn/,
  'a prior waking solution must prevent the dream from being credited with inventing a new solution');
const exploratoryAllAnswered = enrichScientificNotesForResponse({
  ...exploratoryResponse,
  real_life_hypotheses: allExploratoryYes,
}, exploratoryContext, recombinationDream);
assert.match(exploratoryAllAnswered.core_analysis, /buổi họp hoặc trình bày sắp tới là một sự kiện có thật|buổi trình bày sắp tới thật/);
assert.match(exploratoryAllAnswered.core_analysis, /biến đổi một phương án có sẵn/);
assert.doesNotMatch(exploratoryAllAnswered.core_analysis, /Thông tin bạn vừa xác nhận làm rõ trường hợp này: Bạn xác nhận ít nhất hai mảnh/,
  'exploratory answers must be synthesised instead of appended as raw ifYesMeaning sentences');
assert.match(exploratoryAllAnswered.case_conclusion?.conclusion || '', /không phải dự báo/);
assert.match(exploratoryAllAnswered.case_conclusion?.concern?.label || '', /Chưa thấy dấu hiệu đáng lo/);
assert.match(exploratoryAllAnswered.case_conclusion?.confidenceLabel || '', /Cao về bối cảnh.*thấp về mức chứng minh học thuật/);
assert.equal(exploratoryAllAnswered.case_conclusion?.confirmedFindings?.length, 3);
assert.match(exploratoryAllAnswered.case_conclusion?.confirmedFindings?.[0] || '', /Buổi trình bày là một việc có thật/);
assert.equal(exploratoryAllAnswered.case_conclusion?.ruledOut?.length, 3);
assert.match(exploratoryAllAnswered.case_conclusion?.ruledOut?.join(' ') || '', /dự báo tương lai.*ý nghĩa biểu tượng cố định/);
assert.match(exploratoryAllAnswered.case_conclusion?.recommendedNextStep || '', /ba ý chính.*diễn tập/);
assert.equal(exploratoryAllAnswered.case_conclusion?.evidenceBasis?.some((item: any) => item.kind === 'academic_context'), true);
assert.equal(exploratoryAllAnswered.interpretive_threads?.length, 3);
assert.match(exploratoryAllAnswered.interpretive_threads?.[0]?.title || '', /Buổi trình bày thật/);
assert.match(exploratoryAllAnswered.interpretive_threads?.[2]?.reasoning || '', /không chứng minh giấc mơ tự phát minh/);
assert.equal(exploratoryAllAnswered.grounding_summary.appliedRuleCount, exploratoryAllAnswered.scientific_context_notes.length,
  'the audit must count scientific conclusions actually shown, not every retrieved rule');
assert.equal(exploratoryAllAnswered.scientific_context_notes[0]?.academicEvidenceScore, 19);
assert.equal(exploratoryAllAnswered.scientific_context_notes[0]?.caseApplicability?.status, 'strong_match');
assert.equal(exploratoryAllAnswered.scientific_context_notes[0]?.caseApplicability?.confirmedCount, 5);
assert.match(exploratoryAllAnswered.practical_reflections?.[0]?.suggestion || '', /ba ý chính.*diễn tập/);
assert.match(exploratoryAllAnswered.practical_reflections?.[2]?.suggestion || '', /Không dùng lớp học.*dự báo/);
const exploratoryAnswerChanges = buildFeedbackChangeSet(exploratoryResponse, exploratoryAllAnswered);
assert.equal(exploratoryAnswerChanges.paths.includes('case_conclusion.conclusion'), true);
assert.equal(exploratoryAnswerChanges.paths.includes('case_conclusion.recommendedNextStep'), true);
assert.equal(exploratoryAnswerChanges.paths.includes('case_conclusion.confirmedFindings.0'), true);
assert.equal(exploratoryAnswerChanges.paths.some(path => path.startsWith('practical_reflections.')), true);

console.log('DREAM ANALYSIS GROUNDING: ALL ASSERTIONS PASSED');
