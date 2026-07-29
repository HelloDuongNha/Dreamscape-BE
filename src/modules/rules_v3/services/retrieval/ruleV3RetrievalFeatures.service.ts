export type DreamRuleFeatureCategory =
  | 'past_time'
  | 'future_time'
  | 'multiple_future_horizons'
  | 'implausible_transformation'
  | 'late_sleep_period'
  | 'memory_process'
  | 'threat_or_fear';

const STOP_WORDS = new Set([
  'the', 'and', 'that', 'this', 'for', 'with', 'from', 'into', 'than', 'are', 'was', 'were', 'can', 'may', 'will',
  'của', 'và', 'cho', 'với', 'trong', 'những', 'một', 'này', 'được', 'các', 'như', 'bởi', 'tại', 'trên', 'dưới',
]);

const FEATURE_PATTERNS: ReadonlyArray<{
  category: DreamRuleFeatureCategory;
  pattern: RegExp;
}> = [
  {
    category: 'past_time',
    pattern: /(?:hôm\s+qua|trước\s+đây|ngày\s+xưa|quá\s+khứ|tuổi\s+thơ|đã\s+từng|cũ|yesterday|previously|formerly|past|childhood|ago)/iu,
  },
  {
    category: 'future_time',
    pattern: /(?:ngày\s+mai|tuần\s+tới|tháng\s+tới|năm\s+sau|sắp\s+tới|tương\s+lai|sẽ|dự\s+định|tomorrow|upcoming|next\s+(?:week|month|year)|future|anticipated|prospective)/iu,
  },
  {
    category: 'multiple_future_horizons',
    pattern: /(?:ngày\s+mai|tuần\s+tới|tomorrow|next\s+week)[\s\S]{0,180}(?:tháng\s+tới|năm\s+sau|tương\s+lai|next\s+(?:month|year)|months?\s+from\s+now|future)/iu,
  },
  {
    category: 'implausible_transformation',
    pattern: /(?:biến\s+thành|hóa\s+thành|phi\s+lý|không\s+thể|lơ\s+lửng|bay|transform(?:ed|s|ing)?|impossible|implausible|unrealistic|floating|flying)/iu,
  },
  {
    category: 'late_sleep_period',
    pattern: /(?:gần\s+sáng|cuối\s+đêm|về\s+sáng|near\s+dawn|late\s+in\s+the\s+night|toward\s+morning)/iu,
  },
  {
    category: 'memory_process',
    pattern: /(?:quên|nhớ|ký\s+ức|trí\s+nhớ|hồi\s+ức|forget(?:ting)?|remember(?:ed|ing)?|memory|recall)/iu,
  },
  {
    category: 'threat_or_fear',
    pattern: /(?:đuổi|rượt|chạy\s+trốn|sợ|hoảng|đe\s+dọa|chase(?:d|s|ing)?|pursu(?:e|ed|ing|it)|fear|panic|threat)/iu,
  },
];

const FEATURE_TERMS: Record<DreamRuleFeatureCategory, readonly string[]> = {
  past_time: ['past events', 'past episode', 'past event reference', 'autobiographical memory', 'recent events'],
  future_time: ['future events', 'future anticipation', 'future-oriented dreams', 'prospective dreams', 'upcoming events', 'general future concerns'],
  multiple_future_horizons: ['future event combination', 'multiple time points', 'temporal proximity'],
  implausible_transformation: ['implausible scenarios', 'weak associations', 'unrealistic dream content'],
  late_sleep_period: ['later in the night', 'time of night', 'temporal orientation'],
  memory_process: ['memory', 'forgetting', 'memory consolidation', 'memory reactivation'],
  threat_or_fear: ['threat', 'anxiety', 'avoidance', 'threat simulation'],
};

export function extractDreamRuleFeatureCategories(dreamText: string): DreamRuleFeatureCategory[] {
  const normalized = dreamText.normalize('NFKC').toLocaleLowerCase('vi');
  return FEATURE_PATTERNS
    .filter(feature => feature.pattern.test(normalized))
    .map(feature => feature.category);
}

export function extractDreamRuleFeatures(dreamText: string): string[] {
  const categories = extractDreamRuleFeatureCategories(dreamText);
  const features = categories.flatMap(category => FEATURE_TERMS[category]);
  if (categories.includes('past_time') && categories.includes('future_time')) {
    features.push('past and future events', 'episodic sources');
  }
  return [...new Set(features)];
}

export function lexicalOverlap(leftText: string, rightText: string): number {
  const left = contentWords(leftText);
  const right = contentWords(rightText);
  if (left.size === 0 || right.size === 0) return 0;
  let matched = 0;
  for (const token of right) if (left.has(token)) matched += 1;
  return matched / Math.min(12, right.size);
}

export function expandDreamRetrievalConcepts(dreamText: string): string {
  const features = extractDreamRuleFeatures(dreamText);
  return features.length > 0
    ? `${dreamText}\n[RETRIEVAL_FEATURES] ${features.join(', ')}`
    : dreamText;
}

function contentWords(value: string): Set<string> {
  return new Set(value
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/u)
    .filter(word => word.length >= 3 && !STOP_WORDS.has(word)));
}
