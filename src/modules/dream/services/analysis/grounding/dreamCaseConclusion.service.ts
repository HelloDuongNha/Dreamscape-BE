import {
  normalizeGroundingText,
  removeInternalAnalysisVocabulary,
} from './dreamGroundingText.service';
import { polishGeneratedDreamProse } from './dreamFeedbackRevision.service';
import { buildFeedbackAppliedAnalysis } from './dreamCaseAssessment.service';

export interface ExploratoryCaseAssessment {
  status: 'strong_match' | 'partial_match' | 'mixed' | 'weakened' | 'unresolved';
  answeredCount: number;
  totalCount: number;
  confirmedCount: number;
  weakenedCount: number;
  unresolvedCount: number;
  conclusion: string;
}

export interface DreamCaseConclusion {
  status: 'preliminary' | 'clarified';
  headline: string;
  conclusion: string;
  reasoning: string;
  confidenceLabel: string;
  confirmedFindings: string[];
  ruledOut: string[];
  recommendedNextStep: string;
  concern: {
    level: 'no_clear_warning';
    label: string;
    explanation: string;
    watchFor: string[];
    helpSource: { title: string; url: string };
  };
  evidenceBasis: Array<{
    kind: 'confirmed_context' | 'academic_context' | 'boundary';
    title: string;
    detail: string;
    sources?: Array<{ sourceId: string; title: string; year?: number; doi?: string }>;
  }>;
}

function ruleAndComponentIds(rule: any): Set<string> {
  return new Set([
    String(rule?.ruleId || rule?._id || '').trim(),
    ...(Array.isArray(rule?.compositeComponents)
      ? rule.compositeComponents.map((component: any) => String(component?.sourceRuleId || '').trim())
      : []),
  ].filter(Boolean));
}

// Summarizes case answers without treating one person's response as study evidence.
export function buildExploratoryCaseAssessment(
  hypotheses: any[],
  rule?: any,
): ExploratoryCaseAssessment | null {
  const allowedRuleIds = rule ? ruleAndComponentIds(rule) : null;
  const candidates = (Array.isArray(hypotheses) ? hypotheses : []).filter(item => {
    if (!allowedRuleIds?.size) return true;
    const itemIds = [item?.ruleId, ...(Array.isArray(item?.ruleIds) ? item.ruleIds : [])]
      .map(value => String(value || '').trim())
      .filter(Boolean);
    return itemIds.some(id => allowedRuleIds.has(id));
  });
  if (candidates.length === 0) return null;

  const unique = new Map<string, any>();
  for (const item of candidates) {
    const key = normalizeGroundingText(item?.followUpQuestion || item?.hypothesis || '');
    if (key && !unique.has(key)) unique.set(key, item);
  }
  const values = [...unique.values()];
  const answers = values
    .map(item => item?.userFeedback)
    .filter(value => ['yes', 'no', 'unsure'].includes(value));
  const confirmedCount = answers.filter(value => value === 'yes').length;
  const weakenedCount = answers.filter(value => value === 'no').length;
  const unresolvedCount = answers.filter(value => value === 'unsure').length;
  const answeredCount = answers.length;
  const totalCount = values.length;
  const status: ExploratoryCaseAssessment['status'] = answeredCount === 0 || unresolvedCount === answeredCount
    ? 'unresolved'
    : weakenedCount === 0 && unresolvedCount === 0 && confirmedCount === totalCount
      ? 'strong_match'
      : confirmedCount > weakenedCount
        ? 'partial_match'
        : weakenedCount > confirmedCount ? 'weakened' : 'mixed';
  return {
    status,
    answeredCount,
    totalCount,
    confirmedCount,
    weakenedCount,
    unresolvedCount,
    conclusion: answeredCount > 0
      ? `Đã đối chiếu ${answeredCount}/${totalCount} câu hỏi bối cảnh: ${confirmedCount} phù hợp, ${weakenedCount} không phù hợp và ${unresolvedCount} chưa chắc.`
      : `Chưa có câu trả lời cho ${totalCount} câu hỏi bối cảnh đã chuẩn bị.`,
  };
}

// Builds the concise case-boundary summary shown after dream feedback.
export function buildDreamCaseConclusion(
  _narrative: string,
  hypotheses: any[],
  scientificNotes: any[] = [],
  centralAnalysis?: unknown,
): DreamCaseConclusion {
  const assessment = buildExploratoryCaseAssessment(hypotheses);
  const feedback = buildFeedbackAppliedAnalysis(hypotheses);
  const clarified = Boolean(assessment?.answeredCount);
  const academicSources = [...new Map((scientificNotes || [])
    .flatMap(note => note?.sources || [])
    .map((source: any) => [String(source?.sourceId || source?.doi || source?.title || ''), {
      sourceId: String(source?.sourceId || ''),
      title: String(source?.title || 'Tài liệu học thuật'),
      ...(source?.year ? { year: Number(source.year) } : {}),
      ...(source?.doi ? { doi: String(source.doi) } : {}),
    }]))
    .values()].filter(source => source.sourceId || source.doi || source.title);
  const preliminaryConclusion = polishGeneratedDreamProse(centralAnalysis)
    .split(/(?<=[.!?])\s+/u)
    .map(sentence => sentence.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
  const evidenceBasis: DreamCaseConclusion['evidenceBasis'] = [{
    kind: 'confirmed_context',
    title: clarified ? 'Dữ kiện do bạn xác nhận' : 'Dữ kiện còn cần xác nhận',
    detail: assessment?.conclusion || 'Chưa có câu hỏi bối cảnh đủ điều kiện để đối chiếu.',
  }];
  if (academicSources.length > 0) evidenceBasis.push({
    kind: 'academic_context',
    title: 'Nguồn học thuật được liên kết',
    detail: 'Nguồn chỉ hỗ trợ lập luận được trích dẫn; nguồn không tự quyết định ý nghĩa của trường hợp cá nhân.',
    sources: academicSources,
  });
  evidenceBasis.push({
    kind: 'boundary',
    title: 'Giới hạn của kết luận',
    detail: 'Câu trả lời cá nhân giúp kiểm tra độ phù hợp của lập luận, nhưng không tạo thêm bằng chứng nghiên cứu, dự báo tương lai hay chẩn đoán tâm lý.',
  });
  return {
    status: clarified ? 'clarified' : 'preliminary',
    headline: clarified ? 'Kết luận sau khi đối chiếu câu trả lời' : 'Kết luận ban đầu',
    conclusion: feedback?.interpretation
      || preliminaryConclusion
      || 'Các chi tiết trong lời kể tạo thành một hướng diễn giải ban đầu; hoàn cảnh ngoài đời vẫn do bạn xác nhận.',
    reasoning: assessment?.conclusion
      || 'Chưa có đủ câu trả lời để phân biệt dữ kiện đời thực với phần chỉ tồn tại trong câu chuyện của giấc mơ.',
    confidenceLabel: clarified
      ? 'Đã có dữ kiện trường hợp; vẫn giữ giới hạn của bằng chứng học thuật.'
      : 'Diễn giải phản tư dựa trên lời kể, không phải kết luận về hoàn cảnh ngoài đời.',
    confirmedFindings: feedback?.confirmedFacts || [],
    ruledOut: feedback?.rejectedDirections || [],
    recommendedNextStep: feedback?.unresolvedQuestions?.length
      ? 'Trả lời các câu hỏi còn mở bằng dữ kiện đời thực.'
      : 'Xem phần phản tư thực tế do mô hình đề xuất và chỉ chọn điều phù hợp với hoàn cảnh của bạn.',
    concern: {
      level: 'no_clear_warning',
      label: 'Chưa thể kết luận có dấu hiệu đáng lo chỉ từ nội dung giấc mơ',
      explanation: 'Mức độ ảnh hưởng tới giấc ngủ và sinh hoạt quan trọng hơn bản thân một hình ảnh phi thực tế trong mơ.',
      watchFor: [
        'Giấc mơ lặp lại thường xuyên và gây sợ hãi hoặc mất ngủ.',
        'Khó chịu sau khi tỉnh kéo dài hoặc cản trở sinh hoạt.',
        'Nội dung liên quan đến một sự kiện gây tổn thương và tiếp tục gây khó chịu rõ rệt.',
      ],
      helpSource: {
        title: 'Hướng dẫn NHS về ác mộng và khi nào nên tìm hỗ trợ',
        url: 'https://www.nhs.uk/conditions/night-terrors/',
      },
    },
    evidenceBasis,
  };
}
