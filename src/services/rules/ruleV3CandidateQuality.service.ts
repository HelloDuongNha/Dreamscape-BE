import type {
  RuleV3ClaimType,
  RuleV3EffectPolarity,
  RuleV3EvidenceInterpretation
} from './ruleV3GenerationProvider.types';

export type RuleV3QualityReasonCode =
  | 'document_navigation'
  | 'research_recommendation'
  | 'claim_type_evidence_mismatch'
  | 'evidence_does_not_entail_claim'
  | 'generic_subject_or_outcome'
  | 'case_specific_narrative'
  | 'historical_or_biographical_fact'
  | 'generic_relation_wording'
  | 'not_applicable_to_dream_analysis'
  | 'fixed_symbol_dictionary'
  | 'unfalsifiable_prediction'
  | 'identity_stereotype'
  | 'book_claim_lacks_generalizable_mechanism'
  | 'non_operational_theory';

export type RuleV3SemanticSupportLevel = 'direct' | 'partial' | 'none';
export type RuleV3ApplicationReadiness = 'direct' | 'conditional' | 'background' | 'not_usable';

export interface RuleV3QualityCandidate {
  statement: string;
  claimType: RuleV3ClaimType | string;
  effectPolarity: RuleV3EffectPolarity | string;
  evidenceInterpretation: RuleV3EvidenceInterpretation | string;
  subject: string;
  outcome: string;
  conditions?: string[];
  limitations?: string[];
  dreamFeatureTags?: string[];
}

export interface RuleV3QualityEvidence {
  exactQuote?: string;
  stance: 'supports' | 'refutes' | 'limits';
}

export interface RuleV3CandidateQualityResult {
  accepted: boolean;
  reasonCodes: RuleV3QualityReasonCode[];
  semanticSupportLevel: RuleV3SemanticSupportLevel;
  semanticSupportScore: number;
  semanticSupportReason: string;
  applicationReadiness: RuleV3ApplicationReadiness;
  normalizedEffectPolarity: RuleV3EffectPolarity | string;
  normalizedEvidenceInterpretation: RuleV3EvidenceInterpretation | string;
  summary: string;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'by', 'for', 'from', 'in', 'into', 'is', 'it',
  'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'were', 'which', 'with',
  'các', 'có', 'của', 'đã', 'được', 'là', 'một', 'những', 'trong', 'và', 'về', 'với'
]);

const NAVIGATION_PATTERNS = [
  /\b(?:descriptive\s+statistics|summary\s+statistics)\b.{0,100}\b(?:table|figure|appendix)\s*\d*/iu,
  /\b(?:shown|presented|listed|reported|summari[sz]ed)\s+in\s+(?:table|figure|appendix)\b/iu,
  /\b(?:see|refer\s+to)\s+(?:table|figure|appendix)\b/iu,
  /\b(?:table|figure)\s*\d+\s*[|:.-].*\b(?:statistics|characteristics|results)\b/iu,
  /\b(?:thống\s+kê\s+mô\s+tả|kết\s+quả)\b.{0,100}\b(?:bảng|hình|phụ\s+lục)\b/iu,
  /\b(?:được\s+trình\s+bày|được\s+thể\s+hiện|xem)\b.{0,80}\b(?:bảng|hình|phụ\s+lục)\b/iu
];

const RESEARCH_RECOMMENDATION_PATTERNS = [
  /\b(?:further|future|additional)\s+(?:research|stud(?:y|ies))\b.{0,100}\b(?:needed|required|should|could)\b/iu,
  /\b(?:research|stud(?:y|ies))\b.{0,100}\b(?:is|are)\s+needed\b/iu,
  /\b(?:nghiên\s+cứu)\b.{0,100}\b(?:tiếp\s+theo|trong\s+tương\s+lai|cần\s+được\s+thực\s+hiện)\b/iu
];

const GENERIC_FIELD_PATTERNS = [
  /^(?:descriptive|summary)\s+statistics$/iu,
  /^(?:table|figure|appendix|results?|analysis|data)$/iu,
  /^(?:thống\s+kê\s+mô\s+tả|bảng|hình|kết\s+quả|phân\s+tích|dữ\s+liệu)$/iu
];

const CASE_SPECIFIC_PATTERNS = [
  /\b(?:first|last|next|previous)\s+dream\b/iu,
  /\b(?:his|her|their)\s+dream\b/iu,
  /\b(?:case|patient|participant)\s+(?:of|named|called)\b/iu,
  /\b(?:dream|giấc\s+mơ)\s+(?:of|của)\s+(?:the\s+patient|a\s+patient|bệnh\s+nhân|henry|một\s+người)\b/iu,
  /\b(?:giấc\s+mơ\s+(?:đầu\s+tiên|cuối\s+cùng|sau\s+cùng|tiếp\s+theo)|trong\s+giấc\s+mơ\s+này)\b/iu,
  /\b(?:bốn\s+người\s+bạn|cô\s+gái\s+bí\s+mật|tổng\s+thống\s+cộng\s+hòa\s+pháp|henry)\b/iu,
  /\b(?:ariadne|theseus|artemis)\b/iu,
];

const HISTORICAL_FACT_PATTERNS = [
  /\b(?:century|bce|bc|ad|ancient\s+greek|greek\s+philosopher)\b/iu,
  /\b(?:thế\s+kỷ|trước\s+công\s+nguyên|triết\s+gia\s+hy\s+lạp|môn\s+đồ)\b/iu,
];

const GENERIC_RELATION_PATTERNS = [
  /\b(?:has|have|had)\s+(?:a\s+)?(?:relationship|connection|link)\s+with\b/iu,
  /(?:có|cho\s+thấy)\s+(?:một\s+)?(?:liên\s+hệ|liên\s+kết|mối\s+liên\s+hệ)\s+với/iu,
];

const HUMAN_GENERALIZATION_ANCHORS = /\b(?:people|persons?|individuals?|participants?|patients?|dreamers?|humans?|con\s+người|cá\s+nhân|người\s+tham\s+gia|bệnh\s+nhân|người\s+mơ)\b/iu;
const PSYCHOLOGY_ANCHORS = /(?:\b(?:psycholog(?:y|ical)|unconscious|subconscious|stress|anxiety|fear|attachment|coping|support|trauma|threat|behavior|emotion|memory|recall|cognition|self-regulation)\b|tâm\s+lý|vô\s+thức|tiềm\s+thức|căng\s+thẳng|lo\s+âu|sợ\s+hãi|gắn\s+bó|ứng\s+phó|hỗ\s+trợ|sang\s+chấn|đe\s+dọa|hành\s+vi|cảm\s+xúc|ký\s+ức|trí\s+nhớ|nhận\s+thức|tự\s+điều\s+chỉnh)/iu;
const FIXED_SYMBOL_MAPPING_PATTERNS = [
  /(?:\bin\s+dreams?\b|trong\s+giấc\s+mơ).{0,100}(?:\brepresents?\b|\bsymboli[sz]es?\b|\bstands?\s+for\b|\bindicates?\b|đại\s+diện|tượng\s+trưng|ám\s+chỉ|biểu\s+thị)/iu,
  /(?:\bsymbol\b|biểu\s+tượng).{0,80}(?:\bmeans?\b|\bmeaning\b|\brepresents?\b|tượng\s+trưng|đại\s+diện|ý\s+nghĩa)/iu,
];
const UNFALSIFIABLE_PREDICTION_PATTERNS = [
  /\b(?:prophe(?:cy|tic)|foretell|precognit|predict\s+the\s+future)\b/iu,
  /\b(?:tiên\s+tri|đoán\s+trước|tiên\s+lượng|cảnh\s+báo\s+về\s+những\s+tình\s+huống\s+sắp\s+xảy\s+ra)\b/iu,
];
const IDENTITY_STEREOTYPE_PATTERNS = [
  /\b(?:black\s+(?:man|person)|người\s+da\s+đen)\b.{0,120}\b(?:primitive|unconscious|impulse|nguyên\s+thủy|vô\s+thức|xung\s+lực)\b/iu,
];
const GENERALIZABLE_MECHANISM_PATTERNS = /(?:\b(?:when|during|because|through|leads?\s+to|helps?|activates?|regulates?|coping)\b|\bkhi\b|trong\s+giai\s+đoạn|bởi\s+vì|thông\s+qua|dẫn\s+đến|giúp|kích\s+hoạt|điều\s+chỉnh|ứng\s+phó)/iu;
const GENERIC_SYMBOL_SUBJECT = /^(?:dream\s+symbols?|symbols?|biểu\s+tượng|các\s+biểu\s+tượng|biểu\s+tượng\s+trong\s+giấc\s+mơ)$/iu;
const NON_OPERATIONAL_THEORY_PATTERNS = [
  /\b(?:archetype|collective\s+unconscious|anima|animus|individuation|initiation|mytholog|sacrifice)\b/iu,
  /(?:cổ\s+mẫu|vô\s+thức\s+tập\s+thể|tự\s+ngã|ẩn\s+nữ\s+tính|ẩn\s+nam|cá\s+nhân\s+hóa|khai\s+tâm|thần\s+thoại|hiến\s+tế)/iu,
  /(?:nhà\s+tâm\s+lý.{0,60}\bcần\b|bác\s+sĩ.{0,60}\bcần\b|therapist.{0,60}\bshould\b)/iu,
  /(?:cái\s+bóng|mặt\s+tối|khuyết\s+điểm\s+trong\s+cái\s+bóng|shadow\s+self)/iu,
  /(?:biến\s+đổi\s+nhân\s+dạng|vị\s+thánh|đời\s+sống\s+khổ\s+hạnh|ascetic|saint)/iu,
];

const DREAM_ANCHORS = /(?:\b(?:dream(?:s|ing|t|ed)?|nightmare(?:s)?|dream[- ]?recall|dream[- ]?content|oneiric)\b|giấc\s*mơ|nằm\s*mơ|ác\s*mộng|mộng\s*mị)/iu;
const SLEEP_CONTEXT_ANCHORS = /(?:\b(?:sleep|REM|NREM|sleeping|memory|memories|emotion|emotional|waking)\b|giấc\s*ngủ|ngủ|ký\s*ức|trí\s*nhớ|cảm\s*xúc|thức\s*giấc)/iu;
const INTERVENTION_ANCHORS = /\b(?:intervention|treatment|therapy|training|randomi[sz](?:ed|ation)?|assigned|experimental|manipulat(?:ed|ion)|can\s*thiệp|điều\s*trị|trị\s*liệu|huấn\s*luyện|ngẫu\s*nhiên|thực\s*nghiệm)\b/iu;
const PREDICTION_ANCHORS = /\b(?:predict(?:s|ed|or|ors|ive|ion)?|forecast|prospective|dự\s*báo|dự\s*đoán|yếu\s*tố\s*dự\s*báo)\b/iu;
const MODERATION_ANCHORS = /\b(?:moderat(?:e|es|ed|ion|or)|interaction\s+effect|điều\s*tiết|tương\s*tác)\b/iu;
const MEDIATION_ANCHORS = /\b(?:mediat(?:e|es|ed|ion|or)|indirect\s+effect|trung\s*gian|tác\s*động\s*gián\s*tiếp)\b/iu;
const DIRECTIONAL_ANCHORS = /\b(?:increase(?:s|d)?|decrease(?:s|d)?|higher|lower|more|less|positive(?:ly)?|negative(?:ly)?|tăng|giảm|cao\s*hơn|thấp\s*hơn|nhiều\s*hơn|ít\s*hơn|tích\s*cực|tiêu\s*cực)\b/iu;
const CONTEXT_ANCHORS = /(?:during|among|within|when|under|participants?|patients?|sample|population|REM|NREM|sleep|ở|trong|khi|đối\s+với|người\s+tham\s+gia|mẫu|quần\s+thể|giấc\s+ngủ)/iu;
const LIMITATION_ANCHORS = /(?:may|might|could|cannot|not\s+establish|limited|limitation|single|sample|association|caus|uncertain|lack|only|có\s+thể|không\s+thể|giới\s+hạn|một\s+nghiên\s+cứu|mẫu|liên\s+hệ|nhân\s+quả|chưa\s+chắc)/iu;

export function hasSpecificRuleCondition(items: string[] | undefined): boolean {
  return Boolean(items?.some(item => {
    const value = String(item || '').trim();
    if (value.split(/\s+/u).length < 2 || /^(?:function|effect|role|relationship)\s+of\b/iu.test(value)) return false;
    return CONTEXT_ANCHORS.test(value);
  }));
}

export function hasSpecificRuleLimitation(items: string[] | undefined): boolean {
  return Boolean(items?.some(item => {
    const value = String(item || '').trim();
    return value.split(/\s+/u).length >= 2 && LIMITATION_ANCHORS.test(value);
  }));
}

function normalizeText(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentTokens(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter(token => token.length >= 2 && !STOP_WORDS.has(token));
}

function coverage(needle: string, haystack: string): number {
  const tokens = [...new Set(contentTokens(needle))];
  if (tokens.length === 0) return 0;
  const haystackTokens = new Set(contentTokens(haystack));
  return tokens.filter(token => haystackTokens.has(token)).length / tokens.length;
}

interface AtomicSupportAssessment {
  level: RuleV3SemanticSupportLevel;
  score: number;
  reason: string;
}

function quotePreview(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 150 ? `${compact.slice(0, 147)}…` : compact;
}

function percent(value: number): number {
  return Math.round(value * 100);
}

function assessAtomicSupport(candidate: RuleV3QualityCandidate, evidence: RuleV3QualityEvidence[]): AtomicSupportAssessment {
  const supportQuotes = evidence
    .filter(item => item.stance === 'supports' && item.exactQuote?.trim())
    .map(item => item.exactQuote!.trim());
  let best: { quote: string; statement: number; subject: number; outcome: number } | null = null;

  for (const quote of supportQuotes) {
    const normalizedStatement = normalizeText(candidate.statement);
    const normalizedQuote = normalizeText(quote);
    if (normalizedQuote.includes(normalizedStatement) || normalizedStatement.includes(normalizedQuote)) {
      return {
        level: 'direct',
        score: 1,
        reason: `Kết luận và trích dẫn có nội dung bao hàm trực tiếp: “${quotePreview(quote)}”`
      };
    }

    const statementCoverage = coverage(candidate.statement, quote);
    const subjectCoverage = coverage(candidate.subject, quote);
    const outcomeCoverage = coverage(candidate.outcome, quote);
    const candidateMatch = { quote, statement: statementCoverage, subject: subjectCoverage, outcome: outcomeCoverage };
    if (!best || statementCoverage + subjectCoverage + outcomeCoverage > best.statement + best.subject + best.outcome) {
      best = candidateMatch;
    }
    if (statementCoverage >= 0.62 || (subjectCoverage >= 0.6 && outcomeCoverage >= 0.55)) {
      return {
        level: 'direct',
        score: Math.min(1, Math.max(statementCoverage, (subjectCoverage + outcomeCoverage) / 2)),
        reason: `Trích dẫn “${quotePreview(quote)}” bao phủ ${percent(statementCoverage)}% nội dung kết luận; chủ thể ${percent(subjectCoverage)}% và kết quả ${percent(outcomeCoverage)}%. Mức này đạt ngưỡng hỗ trợ trực tiếp.`
      };
    }
  }
  if (best && (best.statement >= 0.4 || (best.subject >= 0.5 && best.outcome >= 0.3))) {
    return {
      level: 'partial',
      score: Math.min(0.6, Math.max(best.statement, (best.subject + best.outcome) / 2)),
      reason: `Trích dẫn gần nhất “${quotePreview(best.quote)}” chỉ bao phủ ${percent(best.statement)}% kết luận; chủ thể ${percent(best.subject)}% và kết quả ${percent(best.outcome)}%. Mức này chỉ đạt hỗ trợ một phần.`
    };
  }
  return {
    level: 'none',
    score: best ? Math.min(0.35, Math.max(best.statement, (best.subject + best.outcome) / 2)) : 0,
    reason: best
      ? `Trích dẫn gần nhất chỉ bao phủ ${percent(best.statement)}% kết luận; chủ thể ${percent(best.subject)}% và kết quả ${percent(best.outcome)}%, dưới ngưỡng hỗ trợ.`
      : 'Không có trích dẫn mang vai trò hỗ trợ để đối chiếu với kết luận.'
  };
}

function hasClaimTypeMismatch(candidate: RuleV3QualityCandidate, combinedText: string): boolean {
  if (candidate.claimType === 'intervention_effect') return !INTERVENTION_ANCHORS.test(combinedText);
  if (candidate.claimType === 'prediction') return !PREDICTION_ANCHORS.test(combinedText);
  if (candidate.claimType === 'moderation') return !MODERATION_ANCHORS.test(combinedText);
  if (candidate.claimType === 'mediation') return !MEDIATION_ANCHORS.test(combinedText);
  return false;
}

export function assessRuleV3CandidateQuality(
  candidate: RuleV3QualityCandidate,
  evidence: RuleV3QualityEvidence[],
  context: { documentType?: string } = {},
): RuleV3CandidateQualityResult {
  const supportText = evidence.filter(item => item.stance === 'supports').map(item => item.exactQuote || '').join('\n');
  const combinedText = [candidate.statement, candidate.subject, candidate.outcome, supportText].join('\n');
  const reasonCodes: RuleV3QualityReasonCode[] = [];

  if (NAVIGATION_PATTERNS.some(pattern => pattern.test(combinedText))) reasonCodes.push('document_navigation');
  if (RESEARCH_RECOMMENDATION_PATTERNS.some(pattern => pattern.test(candidate.statement))) reasonCodes.push('research_recommendation');
  if (GENERIC_FIELD_PATTERNS.some(pattern => pattern.test(candidate.subject.trim()) || pattern.test(candidate.outcome.trim()))) {
    reasonCodes.push('generic_subject_or_outcome');
  }
  if (CASE_SPECIFIC_PATTERNS.some(pattern => pattern.test(combinedText))) reasonCodes.push('case_specific_narrative');
  if (HISTORICAL_FACT_PATTERNS.some(pattern => pattern.test(combinedText))) reasonCodes.push('historical_or_biographical_fact');
  if (FIXED_SYMBOL_MAPPING_PATTERNS.some(pattern => pattern.test(combinedText))
    && !GENERIC_SYMBOL_SUBJECT.test(candidate.subject.trim())) {
    reasonCodes.push('fixed_symbol_dictionary');
  }
  if (UNFALSIFIABLE_PREDICTION_PATTERNS.some(pattern => pattern.test(combinedText))) reasonCodes.push('unfalsifiable_prediction');
  if (IDENTITY_STEREOTYPE_PATTERNS.some(pattern => pattern.test(combinedText))) reasonCodes.push('identity_stereotype');
  if (NON_OPERATIONAL_THEORY_PATTERNS.some(pattern => pattern.test(combinedText))) reasonCodes.push('non_operational_theory');
  if (GENERIC_RELATION_PATTERNS.some(pattern => pattern.test(candidate.statement))
    && !DIRECTIONAL_ANCHORS.test(combinedText)
    && !PREDICTION_ANCHORS.test(combinedText)
    && !INTERVENTION_ANCHORS.test(combinedText)
    && !HUMAN_GENERALIZATION_ANCHORS.test(combinedText)) {
    reasonCodes.push('generic_relation_wording');
  }
  if (hasClaimTypeMismatch(candidate, combinedText)) reasonCodes.push('claim_type_evidence_mismatch');

  const semanticSupport = assessAtomicSupport(candidate, evidence);
  const semanticSupportLevel = semanticSupport.level;
  if (semanticSupportLevel !== 'direct') reasonCodes.push('evidence_does_not_entail_claim');

  const hasDreamAnchor = DREAM_ANCHORS.test(combinedText);
  const hasSleepContext = SLEEP_CONTEXT_ANCHORS.test(combinedText);
  const actionableClaim = ['association', 'prediction', 'intervention_effect', 'moderation', 'mediation', 'null_finding']
    .includes(candidate.claimType);

  const hasPsychologyAnchor = PSYCHOLOGY_ANCHORS.test(combinedText);
  if (!hasDreamAnchor && !hasSleepContext && !hasPsychologyAnchor) reasonCodes.push('not_applicable_to_dream_analysis');
  if (context.documentType === 'book_or_monograph'
    && !hasSpecificRuleCondition(candidate.conditions)
    && !GENERALIZABLE_MECHANISM_PATTERNS.test(candidate.statement)) {
    reasonCodes.push('book_claim_lacks_generalizable_mechanism');
  }
  const accepted = reasonCodes.length === 0;

  let applicationReadiness: RuleV3ApplicationReadiness = 'not_usable';
  if (accepted && hasDreamAnchor && actionableClaim) applicationReadiness = 'direct';
  else if (accepted && (hasDreamAnchor || hasSleepContext || hasPsychologyAnchor)) applicationReadiness = 'conditional';

  const polarityHasOperationalMeaning = ['association', 'prediction', 'intervention_effect', 'moderation', 'mediation']
    .includes(candidate.claimType);
  const normalizedEffectPolarity = polarityHasOperationalMeaning && DIRECTIONAL_ANCHORS.test(combinedText)
    ? candidate.effectPolarity
    : candidate.claimType === 'null_finding'
      ? 'neutral'
      : (candidate.effectPolarity === 'positive' || candidate.effectPolarity === 'negative') ? 'unknown' : candidate.effectPolarity;
  const normalizedEvidenceInterpretation: RuleV3EvidenceInterpretation | string = ({
    association: 'associational',
    prediction: 'predictive',
    intervention_effect: 'causal',
    moderation: 'associational',
    mediation: 'associational',
    qualitative_theme: 'interpretive',
    theoretical_proposition: 'interpretive',
    review_synthesis: 'descriptive',
    null_finding: 'not_applicable'
  } as Record<string, RuleV3EvidenceInterpretation>)[candidate.claimType] || candidate.evidenceInterpretation;

  const summaries: Record<RuleV3QualityReasonCode, string> = {
    document_navigation: 'Câu này chỉ điều hướng tới bảng, hình hoặc phần khác của tài liệu.',
    research_recommendation: 'Câu này là đề xuất nghiên cứu tiếp theo, không phải kết luận đã được chứng minh.',
    claim_type_evidence_mismatch: 'Loại quan hệ được gán không phù hợp với nội dung bằng chứng.',
    evidence_does_not_entail_claim: 'Không có một trích dẫn hỗ trợ nào tự nó chứng minh đầy đủ kết luận.',
    generic_subject_or_outcome: 'Chủ thể hoặc kết quả quá chung chung để trở thành quy luật có thể sử dụng.',
    case_specific_narrative: 'Câu này mô tả một nhân vật, ca hoặc tình tiết riêng; tài liệu chưa khái quát nó thành quy luật cho người khác.',
    historical_or_biographical_fact: 'Câu này là thông tin lịch sử hoặc tiểu sử, không phải kết luận tâm lý có thể áp dụng cho giấc mơ.',
    generic_relation_wording: 'Câu chỉ nói hai khái niệm “có liên hệ” nhưng không nêu cơ chế, hướng tác động hoặc điều kiện kiểm chứng.',
    not_applicable_to_dream_analysis: 'Kết luận không liên quan trực tiếp tới giấc mơ, giấc ngủ, ký ức hoặc cảm xúc có thể dùng trong phân tích.',
    fixed_symbol_dictionary: 'Câu gán một ý nghĩa cố định cho biểu tượng; ví dụ riêng không đủ để dùng như từ điển cho mọi giấc mơ.',
    unfalsifiable_prediction: 'Câu đưa ra dự báo hoặc tiên tri không có điều kiện kiểm chứng khoa học.',
    identity_stereotype: 'Câu gán đặc điểm tâm lý cho bản sắc con người và không an toàn để khái quát.',
    book_claim_lacks_generalizable_mechanism: 'Kết luận từ sách chưa nêu điều kiện hoặc cơ chế đủ khái quát để áp dụng cho trường hợp khác.',
    non_operational_theory: 'Nội dung là hệ biểu tượng hoặc khái niệm lý thuyết không có điều kiện quan sát để dùng như một quy luật Oracle.'
  };

  return {
    accepted,
    reasonCodes: [...new Set(reasonCodes)],
    semanticSupportLevel,
    semanticSupportScore: semanticSupport.score,
    semanticSupportReason: semanticSupport.reason,
    applicationReadiness,
    normalizedEffectPolarity,
    normalizedEvidenceInterpretation,
    summary: accepted
      ? 'Kết luận có một trích dẫn hỗ trợ trực tiếp và vượt qua các kiểm tra cấu trúc.'
      : summaries[reasonCodes[0]]
  };
}
