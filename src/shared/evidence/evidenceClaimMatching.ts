import {
  canonicalizeOracleEvidenceClaim,
  cleanOracleEvidenceClaim,
  normalizeOracleEvidenceText,
} from './evidenceClaim';

const STOP_WORDS = new Set([
  'khi', 'của', 'và', 'là', 'thì', 'trong', 'những', 'được', 'một', 'này', 'bạn',
  'có', 'cho', 'với', 'the', 'and', 'that', 'this', 'from', 'with', 'when', 'into',
]);

const BILINGUAL_CONCEPTS: Array<[string, RegExp]> = [
  ['dream', /giấc mơ|trong mơ|mộng|dream|dreaming/iu],
  ['sleep', /giấc ngủ|khi ngủ|tỉnh giấc|sleep|awakening/iu],
  ['memory', /ký ức|trí nhớ|mảnh nhớ|thời thơ ấu|memory|memories|childhood/iu],
  ['waking_experience', /khi thức|đời sống thức|trải nghiệm ban ngày|waking(?:-life)?|daytime experience/iu],
  ['future', /tương lai|sắp tới|dự kiến|nhiệm vụ tương lai|future|prospective|anticipated|upcoming/iu],
  ['anxiety', /lo âu|lo lắng|căng thẳng|áp lực|sợ hãi|anxiety|stress|pressure|fear/iu],
  ['creativity', /sáng tạo|linh hoạt|ứng biến|tư duy phân kỳ|creative|flexib|improvis|divergent/iu],
  ['problem_solving', /giải quyết vấn đề|phương án|giải pháp|problem.solving|solution|alternative/iu],
  ['action_planning', /hành động|chuẩn bị|lập kế hoạch|action|prepar|planning/iu],
  ['stress_reduction', /giảm căng thẳng|giải tỏa|nhẹ nhõm|tan biến|stress reduction|relief|decreas/iu],
  ['work_project', /công việc|dự án|lịch họp|buổi trình bày|work|project|meeting|presentation/iu],
  ['intrusion', /xâm lấn|mang.+vào giấc ngủ|không gian nghỉ ngơi|intrud|spillover|carry.+sleep/iu],
  ['weak_association', /liên kết yếu|kết nối xa|weak association|remote association/iu],
];

export function evidenceGapRuleSimilarity(gapClaim: string, ruleText: string): number {
  const lexical = lexicalSimilarity(gapClaim, ruleText);
  const canonicalLexical = lexicalSimilarity(
    canonicalizeOracleEvidenceClaim(gapClaim),
    canonicalizeOracleEvidenceClaim(ruleText),
  );
  const bilingualConcept = bilingualConceptSimilarity(gapClaim, ruleText);
  const gapCluster = oracleEvidenceClaimClusterKey(gapClaim);
  const ruleCluster = oracleEvidenceClaimClusterKey(ruleText);
  if (
    (gapCluster.includes('__') || ruleCluster.includes('__'))
    && gapCluster !== ruleCluster
  ) {
    return Math.min(0.24, Math.max(lexical, canonicalLexical, bilingualConcept));
  }
  const relationMatch = gapCluster && gapCluster === ruleCluster ? 0.72 : 0;
  return Math.max(lexical, canonicalLexical, bilingualConcept, relationMatch);
}

export function oracleEvidenceClaimClusterKey(claim: string): string {
  const value = normalizeOracleEvidenceText(canonicalizeOracleEvidenceClaim(claim));
  const has = (...patterns: RegExp[]) => patterns.some((pattern) => pattern.test(value));
  const anxiety = has(/lo âu|lo lắng|căng thẳng|áp lực|sợ hãi|anxiety|stress|pressure|fear/iu);
  const creativity = has(/sáng tạo|linh hoạt|ứng biến|giải pháp|tư duy phân kỳ|creative|flexib|improvis|solution|divergent/iu);
  const memory = has(/ký ức|trí nhớ|thời thơ ấu|memory|memories|childhood/iu);
  const sleepOrDream = has(/giấc mơ|trong mơ|giấc ngủ|dream|sleep/iu);
  const future = has(/tương lai|sắp tới|future|prospective|anticipated/iu);
  const work = has(/công việc|dự án|lịch họp|buổi trình bày|work|project|meeting/iu);
  const intrusion = has(/xâm lấn|mang.+vào giấc ngủ|không gian nghỉ ngơi|intrud|spillover|carry.+sleep/iu);
  const action = has(/hành động(?: cụ thể)?|chuẩn bị|lập kế hoạch|action|prepar|planning/iu);
  const reduction = has(/giảm|giải tỏa|tan biến|reduce|relief|decreas/iu);
  const weakAssociation = has(/liên kết yếu|kết nối xa|weak association|remote association/iu);
  const lateNight = has(/cuối đêm|gần sáng|(?:phần\s+)?cuối(?:\s+của)?\s+giấc ngủ|later in the night|later in the sleep period|late in sleep|final quartile/iu);
  const insight = has(/bất ngờ|sáng tỏ|tìm ra giải pháp|surpris|insight|eureka/iu);
  const informationProcessing = has(/xử lý thông tin|information processing/iu);
  const futureConstruction = has(
    /tái kết hợp|kết hợp.+(?:cấu trúc|kịch bản)|xây dựng.+kịch bản|mô phỏng.+tương lai|recombin|construct.+(?:scenario|future)|future simulation/iu,
  );

  if (action && anxiety && reduction) return 'relation:action-planning__outcome:stress-reduction';
  if (sleepOrDream && future && lateNight) return 'context:late-sleep__outcome:future-oriented-dream-prevalence';
  if (sleepOrDream && weakAssociation && creativity) return 'mechanism:weak-association__outcome:creative-divergent-thinking';
  if (sleepOrDream && insight && informationProcessing) return 'mechanism:sleep-information-processing__outcome:insight-or-surprise';
  if ((memory || futureConstruction) && sleepOrDream && future) {
    return 'mechanism:memory-recombination__context:future-oriented-dream';
  }
  if (memory && sleepOrDream) return 'mechanism:memory-incorporation__context:dream';
  if (work && anxiety && (intrusion || sleepOrDream || memory)) return 'context:work-pressure__outcome:sleep-or-memory-intrusion';
  if (anxiety && creativity) return 'state:anxiety__outcome:creative-coping-or-improvisation';
  return oracleEvidenceClaimFingerprint(claim);
}

export function oracleEvidenceClaimFingerprint(claim: string): string {
  return [...claimWords(claim)]
    .filter((word) => !STOP_WORDS.has(word))
    .sort()
    .join(' ');
}

function claimWords(value: string): Set<string> {
  return new Set(
    normalizeOracleEvidenceText(value)
      .split(/\s+/u)
      .filter((word) => word.length >= 3),
  );
}

function lexicalSimilarity(left: string, right: string): number {
  const leftWords = claimWords(left);
  const rightWords = claimWords(right);
  if (!leftWords.size || !rightWords.size) return 0;
  let shared = 0;
  for (const word of leftWords) if (rightWords.has(word)) shared += 1;
  return shared / Math.min(leftWords.size, rightWords.size);
}

function bilingualConceptSimilarity(left: string, right: string): number {
  const concepts = (value: string) => new Set(BILINGUAL_CONCEPTS
    .filter(([, pattern]) => pattern.test(cleanOracleEvidenceClaim(value)))
    .map(([concept]) => concept));
  const leftConcepts = concepts(left);
  const rightConcepts = concepts(right);
  if (leftConcepts.size < 2 || rightConcepts.size < 2) return 0;
  const shared = [...leftConcepts].filter((concept) => rightConcepts.has(concept));
  if (shared.length < 2) return 0;
  const hasAnchor = shared.some((concept) => [
    'memory', 'future', 'anxiety', 'creativity', 'problem_solving',
    'action_planning', 'stress_reduction', 'work_project', 'weak_association',
  ].includes(concept));
  if (!hasAnchor) return 0;
  return Math.min(0.68, 0.24 + (shared.length / Math.min(leftConcepts.size, rightConcepts.size)) * 0.44);
}
