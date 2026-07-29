import {
  classifyRuleV3VerificationKind,
  requiresAggregateRuleValidation,
} from '../retrieval/ruleV3DreamApplication.service';
import { cleanSourceMetadataText } from './ruleV3SourceSummary.service';

// Dựng các câu hỏi cần thiết để kiểm tra một lập luận trong trường hợp thực tế.
function buildProbeBlueprint(rule: any) {
  const verificationKind = classifyRuleV3VerificationKind(rule);
  const condition = (rule.conditions || []).filter((item: string) => item.trim()).join('; ');
  const requiresAggregateComparison = requiresAggregateRuleValidation(rule);
  if (requiresAggregateComparison) {
    const subject = cleanSourceMetadataText(rule.subject) || 'chi tiết mục tiêu';
    const outcome = cleanSourceMetadataText(rule.outcome) || 'nhóm so sánh';
    const isNullFinding = rule.claimType === 'null_finding';
    const expectedPattern = cleanSourceMetadataText(rule.statement);
    return {
      verificationKind: 'aggregate_group_comparison',
      verificationMode: 'aggregate_dataset',
      checkable: false,
      conditionSummary: condition || null,
      explanation: 'Kết luận này so sánh tần suất giữa các nhóm và không thể được xác nhận bằng một câu trả lời Có/Không của một người.',
      requiredData: `Với mỗi nhóm trong “${outcome}”, cần ghi: tổng số báo cáo đủ điều kiện, số báo cáo có “${subject}”, tỷ lệ trên tổng số và metadata xác định nhóm. Mọi báo cáo phải dùng cùng một tiêu chuẩn mã hóa; kết quả phải kèm chênh lệch ước lượng và khoảng bất định.`,
      expectedPattern: expectedPattern || `${subject} được đối chiếu giữa ${outcome}.`,
      supportCriterion: isNullFinding
        ? `Phù hợp với kết luận khi phép so sánh đủ công suất vẫn không phát hiện chênh lệch đáng tin cậy về “${subject}” giữa “${outcome}”. Nếu khoảng bất định quá rộng, kết quả chỉ là chưa đủ thông tin—không được tính là xác nhận. `
        : `Phù hợp khi hướng và quy mô chênh lệch quan sát được nhất quán với kết luận: “${expectedPattern}”.`,
      weakeningCriterion: isNullFinding
        ? `Làm yếu kết luận nếu dữ liệu đủ lớn, được mã hóa nhất quán lại cho thấy chênh lệch ổn định và đáng tin cậy về “${subject}” giữa các nhóm.`
        : `Làm yếu kết luận nếu chênh lệch đáng tin cậy đi ngược hướng được nêu, hoặc biến mất khi kiểm soát cùng điều kiện và cách mã hóa.`,
      inconclusiveCriterion: 'Giữ ở trạng thái chưa đủ thông tin khi số ca quá ít, nhãn nhóm không rõ, cách mã hóa không nhất quán hoặc khoảng bất định còn quá rộng.',
      questionDimensions: [
        {
          type: 'dream_feature_confirmation',
          questionPattern: 'Trong giấc mơ này, bạn có thực sự cảm nhận __DREAM_FEATURE__ là một mối đe dọa không?',
          purpose: 'Xác nhận việc hệ thống mã hóa đúng đặc trưng trong lời kể, thay vì tự suy diễn từ khóa.',
          collectedField: `presence:${subject}`
        },
        {
          type: 'comparison_group_context',
          questionPattern: 'Giấc mơ này có thuộc __COMPARISON_CONTEXT__ không?',
          purpose: 'Xác nhận nhóm so sánh của từng quan sát; chỉ hỏi khi metadata thời gian hoặc bối cảnh chưa đủ rõ.',
          collectedField: `comparison_context:${outcome}`
        }
      ],
      feedbackEffect: 'Phản hồi cá nhân không củng cố hay làm yếu kết luận này. Chỉ kết quả tổng hợp đủ nhiều trường hợp mới có thể đối chiếu nó.'
    };
  }

  if (verificationKind === 'none') {
    const observableAnchor = cleanSourceMetadataText(rule.dreamFeatureTags?.[0])
      || cleanSourceMetadataText(rule.subject)
      || 'chi tiết liên quan';
    return {
      verificationKind,
      verificationMode: 'background_only',
      checkable: false,
      conditionSummary: condition || null,
      explanation: 'Lập luận này chỉ cung cấp kiến thức nền. Dữ liệu nguồn chưa nêu điều kiện có thể hỏi người kể để kiểm tra việc áp dụng vào một giấc mơ cụ thể.',
      expectedPattern: cleanSourceMetadataText(rule.statement),
      supportCriterion: 'Câu trả lời cá nhân chỉ xác nhận hệ thống đã nhận diện đúng chi tiết; chưa có tiêu chí từ nguồn để tính nó là một ca ủng hộ kết luận.',
      weakeningCriterion: 'Nếu người kể liên tục bác bỏ chi tiết mà hệ thống đã khớp, điều đó làm yếu cách truy hồi/áp dụng rule—không tự nó bác bỏ kết luận học thuật.',
      inconclusiveCriterion: 'Giữ rule ở vai trò kiến thức nền cho đến khi có điều kiện quan sát được và bằng chứng đủ mạnh để kiểm nghiệm.',
      questionDimensions: [{
        type: 'dream_feature_confirmation',
        questionPattern: 'Trong giấc mơ này, __DREAM_FEATURE__ có đúng là cách bạn nhớ và cảm nhận về tình tiết đó không?',
        purpose: 'Kiểm tra hệ thống có nhận diện đúng chi tiết trong lời kể hay không. Câu trả lời này chưa kiểm chứng được kết luận học thuật.',
        collectedField: `presence:${observableAnchor}`
      }, {
        type: 'dream_reaction_confirmation',
        questionPattern: 'Cảm xúc hoặc hành động của bạn ngay sau __DREAM_FEATURE__ có đúng là __DREAM_REACTION__ không?',
        purpose: 'Kiểm tra vai trò của chi tiết trong chuỗi sự kiện, tách việc nhận đúng hình ảnh khỏi việc hiểu đúng phản ứng của người kể.',
        collectedField: 'presence:dream_reaction'
      }],
      feedbackEffect: 'Phản hồi chỉ giúp xác nhận hệ thống đã nhận diện đúng chi tiết trong giấc mơ; nó không được tính là bằng chứng ủng hộ kết luận học thuật.'
    };
  }

  const descriptions: Record<string, string> = {
    multiple_future_horizons: 'Kiểm tra xem nhiều mốc tương lai trong mơ có tương ứng với nhiều kế hoạch thật đang cùng đòi hỏi sự chú ý hay không.',
    recent_experience_incorporation: 'Kiểm tra xem một chi tiết cụ thể trong mơ có nguồn trải nghiệm gần đây ngoài đời hay không.',
    anticipated_event: 'Kiểm tra xem sự kiện được dự kiến trong mơ có tương ứng với một việc thật đang được chờ đợi hay chuẩn bị hay không.',
    current_stress: 'Kiểm tra xem điều kiện căng thẳng đời thực mà nghiên cứu nêu có tồn tại trong trường hợp này hay không.',
    avoidance_pressure: 'Kiểm tra xem điều kiện né tránh hoặc trì hoãn mà nghiên cứu nêu có tồn tại trong trường hợp này hay không.',
    attachment_support_under_stress: 'Kiểm tra xem nhân vật được tìm tới trong lúc căng thẳng có thật sự từng là một người mang lại cảm giác an toàn hoặc hỗ trợ cho người kể hay không.',
    external_sleep_stimulus: 'Kiểm tra xem kích thích thật trong môi trường ngủ có được ghép vào nội dung giấc mơ hay không.',
    waking_concern_incorporation: 'Kiểm tra xem một chi tiết cụ thể trong giấc mơ có liên quan trực tiếp đến hoạt động hằng ngày hoặc mối bận tâm hiện tại của người kể hay không.',
    weak_association_recombination: 'Kiểm tra xem các mảnh hình ảnh được ghép trong mơ có đến từ những nguồn đời thực riêng biệt gần thời điểm ngủ hay không.',
    implausible_future_scenario: 'Kiểm tra xem kịch bản phi thực tế trong mơ có đang xoay quanh một sự kiện tương lai có thật hay không.',
    waking_prospective_difference: 'Phân biệt việc chuẩn bị có chủ đích khi thức với cách giấc mơ tự do kết hợp lại cùng chất liệu.'
  };
  const questionPatterns: Record<string, string> = {
    multiple_future_horizons: 'Hiện tại, bạn có đang đồng thời chuẩn bị cho __NEAR_TERM_EVENT__ và __LONG_TERM_PLAN__ không?',
    recent_experience_incorporation: 'Trong ba ngày trước giấc mơ, có sự việc thật nào gợi bạn nghĩ tới __DREAM_FEATURE__ không?',
    anticipated_event: 'Trong bảy ngày tới, bạn có __UPCOMING_EVENT__ không?',
    current_stress: 'Hiện tại, bạn có đang chịu __CURRENT_PRESSURE__ không?',
    avoidance_pressure: 'Trong hai tuần gần đây, bạn có đang trì hoãn hoặc né tránh __MATCHED_PROBLEM__ không?',
    attachment_support_under_stress: 'Trước đây, khi gặp khó khăn, __MATCHED_PERSON__ có thường khiến bạn cảm thấy an toàn hơn không?',
    external_sleep_stimulus: 'Trong đêm đó hoặc ngay lúc tỉnh dậy, bạn có nghe hoặc cảm nhận __SLEEP_STIMULUS__ không?',
    waking_concern_incorporation: 'Trong bảy ngày trước giấc mơ, bạn có thường xuyên nghĩ hoặc lo về một việc ngoài đời liên quan trực tiếp đến __DREAM_FEATURE__ không?',
    weak_association_recombination: 'Trong bảy ngày trước giấc mơ, ít nhất hai chi tiết trong __MATCHED_FRAGMENTS__ có được gợi lại từ những sự việc riêng biệt ngoài đời không?',
    implausible_future_scenario: 'Trong bảy ngày tới, bạn có __MATCHED_FUTURE_EVENT__ thật tương ứng với phần hướng tới tương lai trong giấc mơ không?',
    waking_prospective_difference: 'Trong hai mươi bốn giờ trước khi ngủ, bạn có chủ động diễn tập hoặc lập kế hoạch cho __MATCHED_FUTURE_EVENT__ không?'
  };
  const alternateQuestions: Record<string, { type: string; pattern: string; purpose: string; field: string }> = {
    multiple_future_horizons: { type: 'priority_pressure', pattern: 'Trong bảy ngày tới, bạn có một hạn chót cụ thể khiến bạn phải tạm gác __LONG_TERM_PLAN__ không?', purpose: 'Kiểm tra xung đột ưu tiên thay vì chỉ xác nhận hai kế hoạch cùng tồn tại.', field: 'case_applicability:priority_pressure' },
    recent_experience_incorporation: { type: 'recent_direct_exposure', pattern: 'Trong bảy ngày trước giấc mơ, bạn có nhìn thấy, nghe nhắc tới hoặc trực tiếp tiếp xúc với __DREAM_FEATURE__ không?', purpose: 'Tìm nguồn tiếp xúc trực tiếp khi người kể không nhớ một sự việc gợi nhớ cụ thể.', field: 'case_applicability:recent_direct_exposure' },
    anticipated_event: { type: 'preparation_behavior', pattern: 'Trong ba ngày gần đây, bạn có thực hiện một việc chuẩn bị cụ thể cho __UPCOMING_EVENT__ không?', purpose: 'Kiểm tra hành vi chuẩn bị hiện tại thay vì hỏi lại sự kiện có tồn tại hay không.', field: 'case_applicability:preparation_behavior' },
    current_stress: { type: 'stress_impact', pattern: 'Trong bảy ngày gần đây, __CURRENT_PRESSURE__ có làm bạn khó tập trung hoặc khó thư giãn trước khi ngủ không?', purpose: 'Kiểm tra ảnh hưởng cụ thể của áp lực thay vì lặp lại câu hỏi có căng thẳng hay không.', field: 'case_applicability:stress_impact' },
    avoidance_pressure: { type: 'approaching_consequence', pattern: 'Trong bảy ngày tới, __MATCHED_PROBLEM__ có một hậu quả hoặc hạn chót mà bạn không thể tiếp tục trì hoãn không?', purpose: 'Kiểm tra áp lực đang tiến gần, khác với việc chỉ xác nhận hành vi né tránh.', field: 'case_applicability:approaching_consequence' },
    attachment_support_under_stress: { type: 'recent_support_seeking', pattern: 'Trong lần gần nhất bạn gặp khó khăn, bạn có nghĩ tới hoặc muốn liên hệ __MATCHED_PERSON__ không?', purpose: 'Kiểm tra hành vi tìm hỗ trợ gần đây thay vì chỉ hỏi về vai trò trong quá khứ.', field: 'case_applicability:recent_support_seeking' },
    external_sleep_stimulus: { type: 'sleep_environment_context', pattern: 'Trong đêm đó, phòng ngủ có tiếng ồn, ánh sáng, nhiệt độ hoặc cảm giác cơ thể bất thường nào gần với __SLEEP_STIMULUS__ không?', purpose: 'Kiểm tra toàn bộ bối cảnh ngủ khi người kể không nhớ một âm thanh cụ thể.', field: 'case_applicability:sleep_environment_context' },
    waking_concern_incorporation: { type: 'recent_day_activity', pattern: 'Trong hai mươi bốn giờ trước khi ngủ, bạn có làm một hoạt động cụ thể liên quan tới __DREAM_FEATURE__ không?', purpose: 'Kiểm tra hoạt động gần giờ ngủ, khác với việc hỏi về mối lo lắng lặp lại.', field: 'case_applicability:recent_day_activity' },
    weak_association_recombination: { type: 'creative_problem_preoccupation', pattern: 'Trong ba ngày trước giấc mơ, bạn có chủ động tìm một cách trình bày hoặc giải quyết mới cho __MATCHED_PROBLEM__ không?', purpose: 'Kiểm tra có bài toán sáng tạo khi thức hay không, khác với việc xác định nguồn của các mảnh hình ảnh.', field: 'case_applicability:creative_problem_preoccupation' },
    waking_prospective_difference: { type: 'novel_solution_origin', pattern: 'Trước giấc mơ này, bạn đã từng nghĩ tới __MATCHED_SOLUTION__ khi thức chưa?', purpose: 'Kiểm tra giải pháp đã tồn tại khi thức hay chỉ xuất hiện lần đầu trong chuỗi mơ.', field: 'case_applicability:novel_solution_origin' }
  };
  const alternate = alternateQuestions[verificationKind];
  return {
    verificationKind,
    verificationMode: 'individual_question',
    checkable: true,
    conditionSummary: condition || null,
    applicabilityCheck: descriptions[verificationKind],
    questionPattern: questionPatterns[verificationKind],
    questionDimensions: [{
      type: verificationKind,
      questionPattern: questionPatterns[verificationKind],
      purpose: descriptions[verificationKind],
      collectedField: `case_applicability:${verificationKind}`
    }, ...(alternate ? [{ type: alternate.type, questionPattern: alternate.pattern, purpose: alternate.purpose, collectedField: alternate.field }] : [])],
    expectedPattern: cleanSourceMetadataText(rule.statement),
    supportCriterion: 'Phù hợp trong ca này khi người kể xác nhận đúng điều kiện ngoài đời mà câu hỏi đã nối với chi tiết trong mơ.',
    weakeningCriterion: 'Làm yếu việc áp dụng trong ca này khi người kể phủ nhận điều kiện đó; hệ thống phải loại hướng diễn giải tương ứng.',
    inconclusiveCriterion: 'Giữ chưa xác định khi người kể chọn Chưa biết hoặc câu trả lời không đủ phân biệt; nếu còn căn cứ, hệ thống chuyển sang một chiều hỏi khác.',
    feedbackEffect: 'Mỗi câu trả lời kiểm tra một mắt xích cụ thể: chi tiết trong mơ có thật sự nối với điều kiện ngoài đời mà tài liệu mô tả hay không. Có giữ hướng áp dụng cho ca này; Không loại hướng đó khỏi ca này; Chưa biết giữ trạng thái chưa xác định.'
  };
}

// Giữ từng câu hỏi riêng nếu chúng thu thập các loại dữ kiện khác nhau.
export function buildCompositeProbeBlueprint(rule: any) {
  const components = Array.isArray(rule?.compositeComponents) ? rule.compositeComponents : [];
  if (!rule?.isComposite || components.length < 2) return buildProbeBlueprint(rule);

  const blueprints = components.map((component: any) => ({
    component,
    blueprint: buildProbeBlueprint(component),
  }));
  const questionByPurpose = new Map<string, any>();
  for (const { component, blueprint } of blueprints) {
    for (const question of blueprint.questionDimensions || []) {
      const signature = [question.type, question.questionPattern, question.purpose]
        .map(value => cleanSourceMetadataText(String(value || '')).toLocaleLowerCase('vi'))
        .join('|');
      const existing = questionByPurpose.get(signature);
      if (existing) {
        existing.componentRuleCodes = [...new Set([...(existing.componentRuleCodes || []), component.ruleCode])];
      } else {
        questionByPurpose.set(signature, { ...question, componentRuleCodes: [component.ruleCode] });
      }
    }
  }

  const checkable = blueprints.some(({ blueprint }: any) => blueprint.checkable);
  return {
    verificationKind: 'composite_rule',
    verificationMode: checkable ? 'individual_question' : 'background_only',
    checkable,
    conditionSummary: [...new Set(blueprints.map(({ blueprint }: any) => blueprint.conditionSummary).filter(Boolean))].join('; ') || null,
    explanation: 'Lập luận tổng hợp giữ các mệnh đề nguyên tử và chỉ gộp những câu hỏi kiểm tra cùng một loại dữ kiện.',
    expectedPattern: components.map((component: any) => component.statement).join('\n'),
    supportCriterion: 'Mỗi mệnh đề con chỉ được giữ khi dữ liệu phù hợp với đúng điều kiện và trích dẫn gắn với mệnh đề đó.',
    weakeningCriterion: 'Một câu trả lời chỉ làm yếu mệnh đề con mà nó kiểm tra; không tự động bác bỏ toàn bộ lập luận tổng hợp.',
    inconclusiveCriterion: 'Mệnh đề chưa có dữ liệu phân biệt vẫn giữ trạng thái chưa đủ thông tin, không được suy rộng từ mệnh đề khác.',
    questionDimensions: [...questionByPurpose.values()],
    feedbackEffect: 'Các câu hỏi trùng mục đích được hợp nhất; câu hỏi thu một loại dữ kiện khác vẫn được giữ riêng và liên kết với mệnh đề tương ứng.',
  };
}
