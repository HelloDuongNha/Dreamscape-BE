export type RuleV3DreamApplicationRole =
  | 'psychological_mechanism'
  | 'contextual_probe'
  | 'descriptive_pattern';

export type RuleV3VerificationKind =
  | 'multiple_future_horizons'
  | 'recent_experience_incorporation'
  | 'anticipated_event'
  | 'current_stress'
  | 'avoidance_pressure'
  | 'attachment_support_under_stress'
  | 'external_sleep_stimulus'
  | 'waking_concern_incorporation'
  | 'weak_association_recombination'
  | 'implausible_future_scenario'
  | 'waking_prospective_difference'
  | 'none';

function normalize(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function compositeApplicationText(rule: any): unknown[] {
  const components = Array.isArray(rule?.compositeComponents) ? rule.compositeComponents : [];
  return components.flatMap((component: any) => [
    component.statement,
    component.subject,
    component.outcome,
    ...(component.conditions || []),
    ...(component.dreamFeatureTags || []),
  ]);
}

/**
 * Classifies what an approved rule is allowed to do in dream analysis.
 *
 * A statistically valid description of dream form (for example, future dreams
 * being more common late at night) is not automatically a psychological
 * mechanism. Keeping the roles separate prevents descriptive papers from being
 * presented to users as explanations of their waking-life motives.
 */
export function classifyRuleV3DreamApplication(rule: any): RuleV3DreamApplicationRole {
  const text = normalize([
    rule?.statement,
    rule?.ruleStatement,
    rule?.subject,
    rule?.factor,
    rule?.outcome,
    ...(rule?.conditions || []),
    ...(rule?.dreamFeatureTags || []),
    ...compositeApplicationText(rule),
  ].join(' '));

  const psychologicalMechanism = /(?:stress|anxiety|fear|emotion|emotional|coping|attachment|social support|memory consolidation|memory processing|autobiographical memory activation|threat simulation|avoidance|self regulation|self organization|căng thẳng|lo âu|sợ hãi|cảm xúc|ứng phó|gắn bó|hỗ trợ xã hội|củng cố ký ức|xử lý ký ức|kích hoạt ký ức|mô phỏng đe dọa|né tránh|tự điều chỉnh|tự tổ chức)/iu.test(text);
  if (psychologicalMechanism) return 'psychological_mechanism';

  const contextualProbe = /(?:temporal proximity|recent events|upcoming events|past and future events|yesterday|tomorrow|episodic sources|multiple time points|combin(?:e|es|ed|ing) future events|future event combination|sự kiện gần đây|sự kiện sắp tới|hôm qua|ngày mai|nhiều mốc thời gian)/iu.test(text);
  const exploratoryStructureProbe = /(?:weak associations?|implausible scenarios?|unlikely or impossible|prospective thought|prospective cognition|liên kết yếu|kịch bản khó tin|tư duy hướng tới tương lai)/iu.test(text);
  if (contextualProbe || exploratoryStructureProbe) return 'contextual_probe';

  return 'descriptive_pattern';
}

export function canExplainPsychology(rule: any): boolean {
  return classifyRuleV3DreamApplication(rule) === 'psychological_mechanism';
}

export function classifyRuleV3VerificationKind(rule: any): RuleV3VerificationKind {
  const text = normalize([
    rule?.statement,
    rule?.ruleStatement,
    rule?.subject,
    rule?.factor,
    rule?.outcome,
    ...(rule?.conditions || []),
    ...(rule?.dreamFeatureTags || []),
    ...compositeApplicationText(rule),
  ].join(' '));

  if (/weak associations?|liên kết yếu/iu.test(text)) {
    return 'weak_association_recombination';
  }
  if (/(?:future[\s-]+related dreams?|future[\s-]+oriented dreams?).{0,90}(?:implausible|unlikely|impossible)|(?:implausible|unlikely|impossible).{0,90}(?:future[\s-]+related dreams?|future[\s-]+oriented dreams?)|kịch bản khó tin/iu.test(text)) {
    return 'implausible_future_scenario';
  }
  if (/(?:not strictly the same|different from).{0,80}(?:prospective thought|prospective cognition)|không hoàn toàn giống.{0,80}tư duy hướng tới tương lai/iu.test(text)) {
    return 'waking_prospective_difference';
  }

  if (/multiple time points|combin(?:e|es|ed|ing) future events|future event combination/iu.test(text)) {
    return 'multiple_future_horizons';
  }
  if (/external stimul|environmental sound|auditory stimul|noise incorporation|âm thanh bên ngoài|kích thích bên ngoài/iu.test(text)) {
    return 'external_sleep_stimulus';
  }
  if (/(?:current concerns?|daily (?:experiences?|activities)|waking (?:concerns?|activities)|day(?:time|time) activities|mối bận tâm hiện tại|hoạt động hằng ngày|trải nghiệm ban ngày)/iu.test(text)
    && /(?:incorporat|continuity|dream content|enter dreams?|được đưa vào|nội dung giấc mơ|xuất hiện trong giấc mơ)/iu.test(text)) {
    return 'waking_concern_incorporation';
  }
  if (/waking life experiences|selectively incorporated|episodic sources?|autobiographical memor|recent events?|temporal proximity|nguồn ký ức|trải nghiệm đời thực|sự kiện gần đây/iu.test(text)) {
    return 'recent_experience_incorporation';
  }
  if (/(?:attachment|caregiver|support figure|social support|proximity seeking|safe haven|secure base|gắn bó|người chăm sóc|người hỗ trợ|điểm tựa|nơi an toàn)/iu.test(text)
    && /(?:stress|threat|distress|fear|adversity|căng thẳng|đe dọa|sợ hãi|khó khăn)/iu.test(text)) {
    return 'attachment_support_under_stress';
  }
  if (/avoidance|avoidant|procrastinat|né tránh|trì hoãn/iu.test(text)
    && /dream|threat|chase|pursuit|giấc mơ|đe dọa|đuổi/iu.test(text)) {
    return 'avoidance_pressure';
  }
  if (/(?:stress|anxiety|fear|căng thẳng|lo âu|sợ hãi).*(?:dream|threat|giấc mơ|đe dọa)|(?:dream|threat|giấc mơ|đe dọa).*(?:stress|anxiety|fear|căng thẳng|lo âu|sợ hãi)/iu.test(text)) {
    return 'current_stress';
  }
  // A plain mention of prospective thought is not evidence that the dreamer
  // has an upcoming event. The explicit comparison case above asks about
  // deliberate waking preparation instead of inventing such an event.
  if (/upcoming events?|anticipated (?:future )?(?:events?|episodes?)|future events?|tomorrow|sự kiện sắp tới|sự kiện tương lai|ngày mai/iu.test(text)
    && !/(?:not strictly the same|different from).{0,50}(?:prospective thought|prospective cognition)/iu.test(text)) {
    return 'anticipated_event';
  }
  return 'none';
}

export function canGenerateContextQuestion(rule: any): boolean {
  return classifyRuleV3VerificationKind(rule) !== 'none';
}

export function requiresAggregateRuleValidation(rule: any): boolean {
  const text = [rule?.statement, rule?.subject, rule?.outcome].map(value => String(value || '')).join(' ');
  const hasExplicitGroupComparison = /(?:\b(?:vs\.?|versus|between)\b.{0,80}\b(?:groups?|samples?|conditions?|periods?)\b|\b(?:groups?|samples?|conditions?|periods?)\b.{0,80}\b(?:vs\.?|versus|between|compar(?:ed|ison))\b|pandemic.{0,50}pre-pandemic|pre-pandemic.{0,50}pandemic|giữa.{0,50}(?:nhóm|mẫu|giai đoạn))/iu.test(text);
  const hasAggregateMeasure = /\b(?:frequency|prevalence|rate|proportion|percentage|mean|odds|risk)\b|tần suất|tỷ lệ|phần trăm|trung bình|nguy cơ/iu.test(text);
  return rule?.claimType === 'null_finding' || (hasExplicitGroupComparison && hasAggregateMeasure);
}
