import type { RuleV3VerificationKind } from './ruleV3DreamApplication.types';

interface VerificationSignalRule {
  kind: Exclude<RuleV3VerificationKind, 'none'>;
  all?: RegExp[];
  any?: RegExp[];
  none?: RegExp[];
}

const PSYCHOLOGICAL_MECHANISM = /(?:stress|anxiety|fear|emotion|emotional|coping|attachment|social support|memory consolidation|memory processing|autobiographical memory activation|threat simulation|avoidance|self regulation|self organization|căng thẳng|lo âu|sợ hãi|cảm xúc|ứng phó|gắn bó|hỗ trợ xã hội|củng cố ký ức|xử lý ký ức|kích hoạt ký ức|mô phỏng đe dọa|né tránh|tự điều chỉnh|tự tổ chức)/iu;
const CONTEXTUAL_EVIDENCE = /(?:temporal proximity|recent events|upcoming events|past and future events|yesterday|tomorrow|episodic sources|multiple time points|combin(?:e|es|ed|ing) future events|future event combination|sự kiện gần đây|sự kiện sắp tới|hôm qua|ngày mai|nhiều mốc thời gian)/iu;
const EXPLORATORY_STRUCTURE = /(?:weak associations?|implausible scenarios?|unlikely or impossible|prospective thought|prospective cognition|liên kết yếu|kịch bản khó tin|tư duy hướng tới tương lai)/iu;

const PROSPECTIVE_DIFFERENCE = /(?:not strictly the same|different from).{0,80}(?:prospective thought|prospective cognition)|không hoàn toàn giống.{0,80}tư duy hướng tới tương lai/iu;
const FUTURE_EVENT = /upcoming events?|anticipated (?:future )?(?:events?|episodes?)|future events?|tomorrow|sự kiện sắp tới|sự kiện tương lai|ngày mai/iu;
const STRESS = /stress|anxiety|fear|căng thẳng|lo âu|sợ hãi/iu;
const DREAM_OR_THREAT = /dream|threat|giấc mơ|đe dọa/iu;

// The order resolves specific observable conditions before broader categories.
const VERIFICATION_SIGNAL_RULES: VerificationSignalRule[] = [
  {
    kind: 'weak_association_recombination',
    any: [/weak associations?|liên kết yếu/iu],
  },
  {
    kind: 'implausible_future_scenario',
    any: [
      /(?:future[\s-]+related dreams?|future[\s-]+oriented dreams?).{0,90}(?:implausible|unlikely|impossible)|(?:implausible|unlikely|impossible).{0,90}(?:future[\s-]+related dreams?|future[\s-]+oriented dreams?)|kịch bản khó tin/iu,
    ],
  },
  {
    kind: 'waking_prospective_difference',
    any: [PROSPECTIVE_DIFFERENCE],
  },
  {
    kind: 'multiple_future_horizons',
    any: [/multiple time points|combin(?:e|es|ed|ing) future events|future event combination/iu],
  },
  {
    kind: 'external_sleep_stimulus',
    any: [/external stimul|environmental sound|auditory stimul|noise incorporation|âm thanh bên ngoài|kích thích bên ngoài/iu],
  },
  {
    kind: 'waking_concern_incorporation',
    all: [
      /(?:current concerns?|daily (?:experiences?|activities)|waking (?:concerns?|activities)|day(?:time|time) activities|mối bận tâm hiện tại|hoạt động hằng ngày|trải nghiệm ban ngày)/iu,
      /(?:incorporat|continuity|dream content|enter dreams?|được đưa vào|nội dung giấc mơ|xuất hiện trong giấc mơ)/iu,
    ],
  },
  {
    kind: 'recent_experience_incorporation',
    all: [
      /memory consolidation|củng cố ký ức/iu,
      /newly encoded memor|emotional experiences?|autobiographical memor|ký ức mới|trải nghiệm cảm xúc|ký ức tự truyện/iu,
    ],
  },
  {
    kind: 'recent_experience_incorporation',
    any: [/waking life experiences|selectively incorporated|episodic sources?|autobiographical memor|recent events?|temporal proximity|newly encoded memor|emotional experiences?|nguồn ký ức|trải nghiệm đời thực|sự kiện gần đây|ký ức mới|trải nghiệm cảm xúc/iu],
  },
  {
    kind: 'attachment_support_under_stress',
    all: [
      /(?:attachment|caregiver|support figure|social support|proximity seeking|safe haven|secure base|gắn bó|người chăm sóc|người hỗ trợ|điểm tựa|nơi an toàn)/iu,
      /(?:stress|threat|distress|fear|adversity|căng thẳng|đe dọa|sợ hãi|khó khăn)/iu,
    ],
  },
  {
    kind: 'avoidance_pressure',
    all: [
      /avoidance|avoidant|procrastinat|né tránh|trì hoãn/iu,
      /dream|threat|chase|pursuit|giấc mơ|đe dọa|đuổi/iu,
    ],
  },
  {
    kind: 'current_stress',
    all: [STRESS, DREAM_OR_THREAT],
  },
  {
    kind: 'anticipated_event',
    any: [FUTURE_EVENT],
    none: [PROSPECTIVE_DIFFERENCE],
  },
];

// Builds one normalized semantic surface from an atomic or composite rule.
export function buildRuleV3ApplicationText(rule: any): string {
  const components = Array.isArray(rule?.compositeComponents) ? rule.compositeComponents : [];
  const values = [
    rule?.statement,
    rule?.ruleStatement,
    rule?.subject,
    rule?.factor,
    rule?.outcome,
    ...(rule?.conditions || []),
    ...(rule?.dreamFeatureTags || []),
    ...components.flatMap((component: any) => [
      component.statement,
      component.subject,
      component.outcome,
      ...(component.conditions || []),
      ...(component.dreamFeatureTags || []),
    ]),
  ];

  return String(values.filter(Boolean).join(' '))
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function hasPsychologicalMechanismSignal(text: string): boolean {
  return PSYCHOLOGICAL_MECHANISM.test(text);
}

export function hasContextualProbeSignal(text: string): boolean {
  return CONTEXTUAL_EVIDENCE.test(text) || EXPLORATORY_STRUCTURE.test(text);
}

export function detectRuleV3VerificationKind(text: string): RuleV3VerificationKind {
  return VERIFICATION_SIGNAL_RULES.find(rule => matchesSignalRule(text, rule))?.kind || 'none';
}

export function hasAggregateComparisonSignal(rule: any): boolean {
  const text = [rule?.statement, rule?.subject, rule?.outcome]
    .map(value => String(value || ''))
    .join(' ');
  const comparesGroups = /(?:\b(?:vs\.?|versus|between)\b.{0,80}\b(?:groups?|samples?|conditions?|periods?)\b|\b(?:groups?|samples?|conditions?|periods?)\b.{0,80}\b(?:vs\.?|versus|between|compar(?:ed|ison))\b|pandemic.{0,50}pre-pandemic|pre-pandemic.{0,50}pandemic|giữa.{0,50}(?:nhóm|mẫu|giai đoạn))/iu.test(text);
  const reportsAggregate = /\b(?:frequency|prevalence|rate|proportion|percentage|mean|odds|risk)\b|tần suất|tỷ lệ|phần trăm|trung bình|nguy cơ/iu.test(text);
  return rule?.claimType === 'null_finding' || (comparesGroups && reportsAggregate);
}

function matchesSignalRule(text: string, rule: VerificationSignalRule): boolean {
  if (rule.all?.some(pattern => !pattern.test(text))) return false;
  if (rule.any && !rule.any.some(pattern => pattern.test(text))) return false;
  if (rule.none?.some(pattern => pattern.test(text))) return false;
  return Boolean(rule.all?.length || rule.any?.length);
}
