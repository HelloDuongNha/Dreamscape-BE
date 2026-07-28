import { Types } from 'mongoose';
import AcademicSource from '../../academic/models/AcademicSource';
import SourceContribution from '../../academic/models/SourceContribution';
import Dream from '../../dream/models/Dream';
import OracleEvidenceGap from '../models/OracleEvidenceGap';
import OracleTurn from '../models/OracleTurn';
import KnowledgeRuleV3 from '../../rules_v3/models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../rules_v3/models/KnowledgeRuleEvidence';
import { inferDocumentLanguage } from '../../rules_v3/services/documentLanguage.service';
import { retrieveApprovedRuleV3 } from '../../rules_v3/services/ruleV3Retrieval.service';
import type { OracleCitation } from './oracle.types';
import {
  buildOracleCitationVerificationQuestion,
  localizeOracleRuleStatement,
  ORACLE_CITATION_QUESTION_VERSION,
} from './oracleRulePresentation.service';

function normalize(value: string): string {
  return cleanOracleEvidenceClaim(value).normalize('NFKC').toLocaleLowerCase('vi')
    .replace(/\[\?\]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function cleanOracleEvidenceClaim(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\[\?\]/gu, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^\s*(?:#{1,6}|>|[-+*]|\d+[.)])\s+/u, '')
    .replace(/[*_~`]+/gu, '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

function words(value: string): Set<string> {
  return new Set(normalize(value).split(/\s+/u).filter((word) => word.length >= 3));
}

function lexicalSimilarity(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

const BILINGUAL_EVIDENCE_CONCEPTS: Array<[string, RegExp]> = [
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
  ['uncertainty', /bất trắc|thiếu ổn định|không chắc chắn|chưa rõ|uncertain|unstable|unknown/iu],
  ['navigation', /hành trình|định hướng|đường đi|tàu|biển|journey|navigat|train|sea/iu],
  ['technology', /công nghệ|kỹ thuật số|bàn phím|kỹ năng chuyên môn|technology|digital|keyboard|technical/iu],
  ['presentation', /trình bày|thuyết phục|slide|khán giả|người nghe|presentation|audience/iu],
  ['connection', /kết nối|cầu nối|gần gũi|chân thật|connect|bridge|authentic/iu],
  ['surprise', /bất ngờ|ngoài dự kiến|vượt khỏi khuôn khổ|surpris|unexpected/iu],
  ['weak_association', /liên kết yếu|kết nối xa|weak association|remote association/iu],
];

function bilingualConceptSimilarity(left: string, right: string): number {
  const concepts = (value: string) => new Set(
    BILINGUAL_EVIDENCE_CONCEPTS
      .filter(([, pattern]) => pattern.test(value))
      .map(([concept]) => concept),
  );
  const a = concepts(cleanOracleEvidenceClaim(left));
  const b = concepts(cleanOracleEvidenceClaim(right));
  if (a.size < 2 || b.size < 2) return 0;
  const shared = [...a].filter(concept => b.has(concept));
  if (shared.length < 2) return 0;
  const anchorShared = shared.some(concept => [
    'memory', 'future', 'anxiety', 'creativity', 'problem_solving',
    'action_planning', 'stress_reduction', 'work_project', 'weak_association',
  ].includes(concept));
  if (!anchorShared) return 0;
  const coverage = shared.length / Math.min(a.size, b.size);
  return Math.min(0.68, 0.24 + coverage * 0.44);
}

export function evidenceGapRuleSimilarity(gapClaim: string, ruleText: string): number {
  const lexical = lexicalSimilarity(gapClaim, ruleText);
  const canonicalLexical = lexicalSimilarity(
    canonicalizeOracleEvidenceClaim(gapClaim),
    canonicalizeOracleEvidenceClaim(ruleText),
  );
  const bilingualConcept = bilingualConceptSimilarity(gapClaim, ruleText);
  const gapCluster = oracleEvidenceClaimClusterKey(gapClaim);
  const ruleCluster = oracleEvidenceClaimClusterKey(ruleText);
  const gapHasSemanticCluster = gapCluster.includes('__');
  if (gapHasSemanticCluster && gapCluster !== ruleCluster) {
    // A structured evidence need must preserve its relation and outcome.
    // Shared topic words alone cannot replace a missing semantic facet.
    return Math.min(0.24, Math.max(lexical, canonicalLexical, bilingualConcept));
  }
  // Cluster keys encode bilingual subject/relation/outcome concepts. Equality
  // is stronger than shared words, but remains below certainty: evidence and
  // approval gates still decide whether the gap can actually be resolved.
  const relationMatch = gapCluster && gapCluster === ruleCluster ? 0.72 : 0;
  return Math.max(lexical, canonicalLexical, bilingualConcept, relationMatch);
}

export async function findOracleEvidenceNeedsForTexts(
  texts: string[],
  limit = 8,
  sourceLanguage = 'en',
): Promise<Array<{ gapId: string; claim: string; similarity: number }>> {
  const searchableText = texts
    .map(text => String(text || '').replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
    .join('\n');
  if (!searchableText) return [];

  const gaps = await OracleEvidenceGap.find({ status: { $ne: 'resolved' } })
    .sort({ updatedAt: -1 })
    .select('_id claim')
    .lean();

  const wantsVietnamese = sourceLanguage.toLowerCase().startsWith('vi');
  const matches = gaps
    .filter(gap => isResearchableOracleEvidenceClaim(String(gap.claim || '')))
    .map(gap => {
      const rawClaim = String(gap.claim || '');
      const localized = localizeOracleEvidenceClaim(rawClaim);
      const claim = wantsVietnamese ? localized.vi : localized.en;
      return {
        gapId: String(gap._id),
        claimKey: localized.key,
        claim,
        similarity: evidenceGapRuleSimilarity(rawClaim, searchableText),
      };
    })
    .filter(match => wantsVietnamese || inferDocumentLanguage([match.claim]) !== 'vi')
    .filter(match => match.similarity >= 0.28)
    .sort((left, right) => right.similarity - left.similarity);

  const deduplicated = new Map<string, typeof matches[number]>();
  for (const match of matches) {
    if (!deduplicated.has(match.claimKey)) deduplicated.set(match.claimKey, match);
  }
  return [...deduplicated.values()]
    .slice(0, Math.max(0, Math.min(20, limit)))
    .map(({ gapId, claim, similarity }) => ({ gapId, claim, similarity }));
}

const EVIDENCE_GAP_STOP_WORDS = new Set([
  'khi', 'của', 'và', 'là', 'thì', 'trong', 'những', 'được', 'một', 'này', 'bạn',
  'có', 'cho', 'với', 'the', 'and', 'that', 'this', 'from', 'with', 'when', 'into',
]);

const NON_CLAIM_PATTERNS = [
  /^(?:dưới đây|sau đây) là (?:phần |một )?(?:phân tích|tóm tắt|giải thích)/iu,
  /^(?:phân tích|tóm tắt|kết luận|lời khuyên)(?: chi tiết)?\s*:?$/iu,
  /^(?:hãy|vui lòng) (?:cho tôi biết|chia sẻ|trả lời)/iu,
  /^(?:bạn có|do you|would you|can you)\b.*\?$/iu,
  /^(?:thay vì|hãy|bạn nên|lời khuyên|gợi ý hành động|try|consider|you should)\b/iu,
  /(?:tiềm thức (?:đang )?gợi ý|niềm tin tiềm ẩn|chìa khóa thành công|hướng bạn đến|tiếng nói nội tâm|được cấp ["“]?phép đi)/iu,
  /(?:chim|biển|tàu|cây cầu|bàn phím|đồ chơi|mặt trăng)\s*:\s*(?:thường )?(?:tượng trưng|đại diện)/iu,
  /(?:tượng trưng|đại diện cho|biểu tượng của|ám chỉ).*(?:tự do|tiềm thức|cô đơn|thẩm quyền|phê bình|đường đời|thoát ly)/iu,
];

export function isResearchableOracleEvidenceClaim(claim: string): boolean {
  const clean = cleanOracleEvidenceClaim(claim);
  if (clean.length < 35) return false;
  if (/[?？]\s*$/u.test(clean)) return false;
  if (NON_CLAIM_PATTERNS.some((pattern) => pattern.test(clean))) return false;
  if (/tượng trưng|biểu tượng của|đại diện cho|ám chỉ/iu.test(clean)) return false;
  const personalizedInterpretation = /\b(?:bạn|của bạn|your)\b/iu.test(clean)
    && /phản ánh|cho thấy|minh họa|gợi ý|khuyến khích|reflect|suggest|indicat/iu.test(clean);
  if (personalizedInterpretation) return false;
  const canonicalClaim = canonicalizeOracleEvidenceClaim(clean);
  const remainsPersonalized = /\b(?:bạn|của bạn|you|your)\b/iu.test(clean)
    && normalize(canonicalClaim) === normalize(clean);
  if (remainsPersonalized) return false;
  const caseSpecificInterpretation = /^(?:trong mơ,?\s*)?việc\b|^hình ảnh\b/iu.test(clean)
    && /phản ánh|cho thấy|minh họa|gợi ý|reflect|suggest|illustrat|indicat/iu.test(clean);
  if (
    caseSpecificInterpretation
    && normalize(canonicalClaim) === normalize(clean)
  ) return false;
  const value = normalize(clean);
  const dreamScience = /giấc mơ|trong mơ|giấc ngủ|tỉnh giấc|dream|dreaming|sleep|awakening/iu.test(value);
  const memoryMechanism = /não bộ|brain/iu.test(value)
    && /ký ức|trí nhớ|memory|memories/iu.test(value);
  const psychologicalMechanism = /lo lắng|căng thẳng|áp lực|anxiety|stress/iu.test(value)
    && /hành động|chuẩn bị|lập kế hoạch|giảm|giải tỏa|sáng tạo|action|planning|reduce|creative/iu.test(value);
  const relationText = `${value} ${normalize(canonicalClaim)}`;
  const relation = /liên quan|kết hợp|tái kết hợp|đưa vào|xử lý|sử dụng|tăng|giảm|dẫn đến|thúc đẩy|ảnh hưởng|phổ biến|xuất hiện|associated|related|combine|incorporat|process|increase|decrease|predict|affect|common|prevalen|frequen|occur/iu.test(relationText);
  const conceptCount = BILINGUAL_EVIDENCE_CONCEPTS
    .filter(([, pattern]) => pattern.test(clean))
    .length;
  return relation
    && (dreamScience || memoryMechanism || psychologicalMechanism || conceptCount >= 2);
}

function keepMarkerOnlyForResearchableClaim(
  text: string,
  marker: RegExp,
  researchableMarker: string,
): string {
  const updatedText = text.replace(marker, (_match, offset: number) => {
    const prefix = text.slice(0, offset).trimEnd();
    const contentBeforeTerminalPunctuation = /[.!?？]$/u.test(prefix)
      ? prefix.slice(0, -1)
      : prefix;
    const boundary = Math.max(
      contentBeforeTerminalPunctuation.lastIndexOf('\n'),
      contentBeforeTerminalPunctuation.lastIndexOf('. '),
      contentBeforeTerminalPunctuation.lastIndexOf('! '),
      contentBeforeTerminalPunctuation.lastIndexOf('? '),
    );
    const surroundingClaim = prefix.slice(boundary + 1).trim();
    return isResearchableOracleEvidenceClaim(surroundingClaim) ? researchableMarker : '';
  });
  return updatedText
    .replace(/[ \t]+([.,!?;:])/gu, '$1')
    .replace(/[ \t]{2,}/gu, ' ');
}

// Replaces an invalid citation only when the surrounding text is an academic claim.
export function invalidateOracleCitationMarker(text: string, citationIndex: number): string {
  return keepMarkerOnlyForResearchableClaim(
    text,
    new RegExp(`\\[${citationIndex}\\]`, 'gu'),
    '[?]',
  );
}

// Removes unresolved markers that were attached to questions or personal advice.
export function sanitizeOracleUnresolvedMarkers(text: string): string {
  return keepMarkerOnlyForResearchableClaim(text, /\[\?\]/gu, '[?]');
}

export function canonicalizeOracleEvidenceClaim(claim: string): string {
  const clean = cleanOracleEvidenceClaim(claim);
  const value = normalize(clean);
  const vietnamese = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/iu
    .test(clean)
    || /\b(?:giấc mơ|trong mơ|ký ức|tương lai|lo âu|sáng tạo)\b/iu.test(clean);
  const dream = /giấc mơ|trong mơ|giấc ngủ|dream|dreaming|sleep/iu.test(value);
  const brain = /não bộ|brain/iu.test(value);
  const memory = /ký ức|trí nhớ|thời thơ ấu|memory|memories|childhood/iu.test(value);
  const future = /tương lai|sắp tới|trách nhiệm|nhiệm vụ hiện tại|future|prospective|upcoming/iu.test(value);
  const anxiety = /lo âu|lo lắng|căng thẳng|áp lực|anxiety|stress|pressure/iu.test(value);
  const creativity = /sáng tạo|linh hoạt|ứng biến|giải pháp|tư duy phân kỳ|creative|flexib|improvis|solution|divergent/iu.test(value);
  const action = /hành động|chuẩn bị|lập kế hoạch|action|prepar|planning/iu.test(value);
  const reduction = /giảm|giải tỏa|tan biến|reduce|relief|decreas/iu.test(value);
  const weakAssociation = /liên kết yếu|kết nối xa|weak association|remote association/iu.test(value);
  const lateNight = /cuối đêm|gần sáng|(?:phần\s+)?cuối(?:\s+của)?\s+giấc ngủ|later in the night|later in the sleep period|late in sleep|final quartile/iu.test(value);

  if (dream && future && lateNight) {
    return vietnamese
      ? 'Giấc mơ hướng tới tương lai có thể trở nên phổ biến hơn vào phần cuối của giấc ngủ.'
      : 'Future-oriented dreams may become more common later in the sleep period.';
  }
  if (dream && weakAssociation && creativity) {
    return vietnamese
      ? 'Kích hoạt các liên kết yếu trong giấc mơ có thể liên quan đến tư duy sáng tạo, linh hoạt hoặc phân kỳ.'
      : 'Activation of weak associations in dreams may be related to creative, flexible, or divergent thinking.';
  }
  if (memory && (dream || brain) && future) {
    return vietnamese
      ? 'Nội dung giấc mơ có thể tái kết hợp ký ức quá khứ với mối quan tâm hoặc nhiệm vụ tương lai.'
      : 'Dream content may recombine past memories with future concerns or anticipated tasks.';
  }
  if (memory && (dream || brain)) {
    return vietnamese
      ? 'Nội dung giấc mơ có thể tái kết hợp các mảnh ký ức từ trải nghiệm khi thức.'
      : 'Dream content may recombine memory fragments from waking experience.';
  }
  if (dream && anxiety && creativity) {
    return vietnamese
      ? 'Lo âu trong giấc mơ có thể liên quan đến việc thử nghiệm các phương án giải quyết vấn đề sáng tạo.'
      : 'Anxiety in dreams may be associated with exploring creative problem-solving alternatives.';
  }
  if (anxiety && action && reduction) {
    return vietnamese
      ? 'Chuyển lo âu thành hành động hoặc kế hoạch cụ thể có thể liên quan đến việc giảm căng thẳng.'
      : 'Turning anxiety into concrete action or planning may be associated with reduced stress.';
  }
  return clean;
}

function hasAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function oracleEvidenceClaimClusterKey(claim: string): string {
  const value = normalize(canonicalizeOracleEvidenceClaim(claim));
  const has = (...patterns: RegExp[]) => hasAny(value, patterns);

  const anxiety = has(/lo âu|lo lắng|căng thẳng|áp lực|sợ hãi|anxiety|stress|pressure|fear/iu);
  const creativity = has(/sáng tạo|linh hoạt|ứng biến|giải pháp|tư duy phân kỳ|creative|flexib|improvis|solution|divergent/iu);
  const presentation = has(/trình bày|thuyết phục|slide|khán giả|người nghe|presentation|audience/iu);
  const uncertainty = has(/bất trắc|thiếu ổn định|không ổn định|chưa rõ|uncertain|unstable|unknown/iu);
  const navigation = has(/tàu|biển|đường ray|lái|hành trình|train|sea|rail|navigat|journey/iu);
  const technology = has(/bàn phím|kỹ thuật số|kỹ năng chuyên môn|công nghệ|keyboard|digital|technical/iu);
  const memory = has(/ký ức|trí nhớ|thời thơ ấu|memory|memories|childhood/iu);
  const sleepOrDream = has(/giấc mơ|trong mơ|giấc ngủ|dream|sleep/iu);
  const future = has(/tương lai|sắp tới|future|prospective|anticipated/iu);
  const work = has(/công việc|dự án|lịch họp|buổi trình bày|work|project|meeting/iu);
  const intrusion = has(/xâm lấn|mang.+vào giấc ngủ|không gian nghỉ ngơi|intrud|spillover|carry.+sleep/iu);
  const action = has(/hành động cụ thể|chuẩn bị|lập kế hoạch|action|prepar|planning/iu);
  const reduction = has(/giảm|giải tỏa|tan biến|reduce|relief|decreas/iu);
  const surprise = has(/bất ngờ|khác biệt|vượt khỏi khuôn khổ|surpris|unexpected|different impact/iu);
  const connection = has(/kết nối|cầu nối|chân thật|cá nhân hóa|connect|authentic|personal/iu);
  const weakAssociation = has(/liên kết yếu|kết nối xa|weak association|remote association/iu);
  const lateNight = has(/cuối đêm|gần sáng|(?:phần\s+)?cuối(?:\s+của)?\s+giấc ngủ|later in the night|later in the sleep period|late in sleep|final quartile/iu);

  if (action && anxiety && reduction) return 'relation:action-planning__outcome:stress-reduction';
  if (sleepOrDream && future && lateNight) {
    return 'context:late-sleep__outcome:future-oriented-dream-prevalence';
  }
  if (sleepOrDream && weakAssociation && creativity) {
    return 'mechanism:weak-association__outcome:creative-divergent-thinking';
  }
  if (memory && sleepOrDream && future) return 'mechanism:memory-recombination__context:future-oriented-dream';
  if (memory && sleepOrDream) return 'mechanism:memory-incorporation__context:dream';
  if (work && anxiety && (intrusion || sleepOrDream || memory)) return 'context:work-pressure__outcome:sleep-or-memory-intrusion';
  if (uncertainty && navigation && (technology || work)) return 'metaphor:technical-navigation__outcome:project-uncertainty';
  if (anxiety && creativity) return 'state:anxiety__outcome:creative-coping-or-improvisation';
  if (presentation && (creativity || connection) && (connection || /cứng nhắc|khô khan|truyền thống|rigid|traditional/iu.test(value))) {
    return 'strategy:creative-flexible-presentation__outcome:audience-connection';
  }
  if (technology && creativity) return 'mechanism:technical-and-creative-integration__outcome:problem-solving';
  if (surprise && sleepOrDream) return 'dream-affect:surprise__inference:anticipated-impact';
  if (navigation && work) return 'metaphor:journey__subject:ongoing-work';

  return oracleEvidenceClaimFingerprint(claim);
}

export function oracleEvidenceClaimFingerprint(claim: string): string {
  return [...words(claim)]
    .filter((word) => !EVIDENCE_GAP_STOP_WORDS.has(word))
    .sort()
    .join(' ');
}

export interface LocalizedOracleEvidenceClaim {
  key: string;
  vi: string;
  en: string;
}

interface EvidenceGapRuleInput {
  _id: Types.ObjectId;
  ruleCode?: string;
  statement?: string;
  subject?: string;
  outcome?: string;
  status?: string;
  evidenceScore?: number;
  supportingSourceCount?: number;
  compositeComponents?: Array<{
    sourceRuleId?: Types.ObjectId;
    statement?: string;
    subject?: string;
    outcome?: string;
  }>;
}

/** Tạo văn bản đối chiếu từ toàn bộ mệnh đề của một lập luận tổng hợp. */
function buildEvidenceGapRuleText(rule: EvidenceGapRuleInput): string {
  return [
    rule.statement,
    rule.subject,
    rule.outcome,
    ...(rule.compositeComponents || []).flatMap(component => [
      component.statement,
      component.subject,
      component.outcome,
    ]),
  ].filter(Boolean).join(' ');
}

const DIRECT_CLAIM_MATCH = 0.5;
const STRONG_MULTILINGUAL_VECTOR_MATCH = 0.82;

// Finds a verified rule only when semantic retrieval and stored evidence agree.
async function findGroundedRuleForClaim(claim: string): Promise<EvidenceGapRuleInput | null> {
  const result = await retrieveApprovedRuleV3(claim, 5);
  for (const rule of result.rules as any[]) {
    const ruleId = String(rule.ruleId || rule._id);
    const hasSupportingEvidence = result.evidenceLinks.some(
      (link: any) => String(link.ruleId) === ruleId && String(link.quote || '').trim(),
    );
    if (!hasSupportingEvidence) continue;

    const ruleText = buildEvidenceGapRuleText(rule as EvidenceGapRuleInput);
    const relationScore = evidenceGapRuleSimilarity(claim, ruleText);
    const vectorScore = Number(rule.retrievalSignals?.vector) || 0;
    if (
      relationScore >= DIRECT_CLAIM_MATCH
      || vectorScore >= STRONG_MULTILINGUAL_VECTOR_MATCH
    ) {
      return rule as EvidenceGapRuleInput;
    }
  }
  return null;
}

/** Chọn đúng chủ sở hữu dẫn chứng cho mệnh đề thành phần khớp nhất. */
function findEvidenceOwnerRuleId(claim: string, rule: EvidenceGapRuleInput): Types.ObjectId {
  const matchingComponent = (rule.compositeComponents || [])
    .filter(component => component.sourceRuleId)
    .map(component => ({
      sourceRuleId: component.sourceRuleId as Types.ObjectId,
      similarity: evidenceGapRuleSimilarity(
        claim,
        [component.statement, component.subject, component.outcome].filter(Boolean).join(' '),
      ),
    }))
    .sort((left, right) => right.similarity - left.similarity)[0];

  return matchingComponent?.sourceRuleId || rule._id;
}

export function localizeOracleEvidenceClaim(claim: string): LocalizedOracleEvidenceClaim {
  const cleanClaim = cleanOracleEvidenceClaim(claim);
  const key = oracleEvidenceClaimClusterKey(cleanClaim);
  if (key === 'mechanism:memory-incorporation__context:dream') {
    return {
      key,
      vi: 'Nội dung giấc mơ có thể tái kết hợp các mảnh ký ức từ trải nghiệm khi thức.',
      en: 'Dream content may recombine memory fragments from waking experience.',
    };
  }
  if (key === 'mechanism:memory-recombination__context:future-oriented-dream') {
    return {
      key,
      vi: 'Nội dung giấc mơ có thể tái kết hợp ký ức quá khứ với mối quan tâm hoặc nhiệm vụ tương lai.',
      en: 'Dream content may recombine past memories with future concerns or anticipated tasks.',
    };
  }
  if (key === 'context:late-sleep__outcome:future-oriented-dream-prevalence') {
    return {
      key,
      vi: 'Giấc mơ hướng tới tương lai có thể trở nên phổ biến hơn vào phần cuối của giấc ngủ.',
      en: 'Future-oriented dreams may become more common later in the sleep period.',
    };
  }
  if (key === 'state:anxiety__outcome:creative-coping-or-improvisation') {
    return {
      key,
      vi: 'Lo âu trong giấc mơ có thể liên quan đến việc thử nghiệm các phương án giải quyết vấn đề sáng tạo.',
      en: 'Anxiety in dreams may be associated with exploring creative problem-solving alternatives.',
    };
  }
  if (key === 'relation:action-planning__outcome:stress-reduction') {
    return {
      key,
      vi: 'Chuyển lo âu thành hành động hoặc kế hoạch cụ thể có thể liên quan đến việc giảm căng thẳng.',
      en: 'Turning anxiety into concrete action or planning may be associated with reduced stress.',
    };
  }
  if (key === 'mechanism:weak-association__outcome:creative-divergent-thinking') {
    return {
      key,
      vi: 'Kích hoạt các liên kết yếu trong giấc mơ có thể liên quan đến tư duy sáng tạo, linh hoạt hoặc phân kỳ.',
      en: 'Activation of weak associations in dreams may be related to creative, flexible, or divergent thinking.',
    };
  }
  if (key === 'context:work-pressure__outcome:sleep-or-memory-intrusion') {
    return {
      key,
      vi: 'Áp lực công việc có thể liên quan đến việc các mối bận tâm khi thức xuất hiện trong giấc ngủ hoặc nội dung giấc mơ.',
      en: 'Work pressure may be associated with waking concerns carrying into sleep or dream content.',
    };
  }
  if (key === 'metaphor:technical-navigation__outcome:project-uncertainty') {
    return {
      key,
      vi: 'Hình ảnh điều hướng bằng công cụ kỹ thuật trong giấc mơ có thể liên quan đến cảm giác không chắc chắn về một dự án.',
      en: 'Dream imagery of navigating with technical tools may be associated with uncertainty about a project.',
    };
  }
  if (key === 'strategy:creative-flexible-presentation__outcome:audience-connection') {
    return {
      key,
      vi: 'Cách trình bày sáng tạo và linh hoạt có thể liên quan đến khả năng kết nối tốt hơn với người nghe.',
      en: 'Creative and flexible presentation strategies may be associated with stronger audience connection.',
    };
  }
  if (key === 'mechanism:technical-and-creative-integration__outcome:problem-solving') {
    return {
      key,
      vi: 'Việc kết hợp nguồn lực kỹ thuật và sáng tạo có thể liên quan đến khả năng giải quyết vấn đề.',
      en: 'Combining technical and creative resources may be associated with problem solving.',
    };
  }
  if (key === 'dream-affect:surprise__inference:anticipated-impact') {
    return {
      key,
      vi: 'Cảm giác bất ngờ trong giấc mơ có thể liên quan đến việc dự kiến một kết quả hoặc tác động khác thường.',
      en: 'Surprise in a dream may be associated with anticipating an unusual result or impact.',
    };
  }
  if (key === 'metaphor:journey__subject:ongoing-work') {
    return {
      key,
      vi: 'Hình ảnh hành trình trong giấc mơ có thể liên quan đến cách người mơ hình dung một công việc hoặc dự án đang diễn ra.',
      en: 'Journey imagery in dreams may be associated with how an ongoing task or project is represented.',
    };
  }
  return { key, vi: cleanClaim, en: cleanClaim };
}

async function loadRuleEvidenceSupport(claim: string, rule: EvidenceGapRuleInput) {
  const evidenceOwnerRuleId = findEvidenceOwnerRuleId(claim, rule);
  const evidenceCandidates = await KnowledgeRuleEvidenceV3.find({
    ruleId: evidenceOwnerRuleId,
    stance: 'supports',
  }).sort({ verificationScore: -1, createdAt: 1 }).lean();
  const evidence = evidenceCandidates
    .map((item) => ({
      item,
      similarity: evidenceGapRuleSimilarity(claim, String(item.exactQuote || '')),
    }))
    .sort((left, right) => right.similarity - left.similarity)[0];
  if (!evidence || evidence.similarity < DIRECT_CLAIM_MATCH) return null;

  const [academicSource, contribution] = await Promise.all([
    AcademicSource.findById(evidence.item.sourceId).lean(),
    SourceContribution.findById(evidence.item.sourceId).lean(),
  ]);
  const approvedFromContribution = !academicSource && contribution
    ? await AcademicSource.findOne({ sourceContributionId: contribution._id }).lean()
    : null;
  // Citation chỉ dùng ID tài liệu đã duyệt để luôn mở được trong Library.
  const source = academicSource || approvedFromContribution;
  return source ? { evidence: evidence.item, source } : null;
}

async function resolveGapInOracleTurn(
  gap: {
    userId: Types.ObjectId;
    turnId: Types.ObjectId;
    occurrenceTurnIds?: Types.ObjectId[];
    claim: string;
    relatedClaims?: string[];
  },
  rule: EvidenceGapRuleInput,
): Promise<number | null> {
  const support = await loadRuleEvidenceSupport(gap.claim, rule);
  if (!support) return null;
  const { evidence, source } = support;
  const verificationQuestion = buildOracleCitationVerificationQuestion(rule);
  const ruleLink = {
    ruleId: String(rule._id),
    ruleCode: String(rule.ruleCode || rule._id),
    statement: String(rule.statement || ''),
    localizedStatement: localizeOracleRuleStatement(rule),
    quote: String(evidence.exactQuote || ''),
    evidenceScore: Number(rule.evidenceScore) || 0,
    supportingSourceCount: Number(rule.supportingSourceCount) || 0,
    verificationKey: `${String(rule._id)}:${String(evidence._id)}:oracle-citation-${ORACLE_CITATION_QUESTION_VERSION}`,
    verificationQuestion: verificationQuestion.vi,
    localizedVerificationQuestion: verificationQuestion,
    currentUserAnswer: null,
  };
  const claimVariants = [...new Set([gap.claim, ...(gap.relatedClaims || [])])]
    .map(cleanOracleEvidenceClaim)
    .filter(Boolean);
  const claimMarkerPatterns = claimVariants
    .map((variant) => variant.replace(/[.!?]+\s*$/u, '').trim())
    .filter(Boolean)
    .map((stem) => new RegExp(
      `${stem.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*\\[\\?\\]`,
      'u',
    ));
  const legacyOccurrences = claimMarkerPatterns.length
    ? await OracleTurn.find({
      userId: gap.userId,
      'contentBlocks.text': { $in: claimMarkerPatterns },
    }).select('_id').lean()
    : [];
  const turnIds = [...new Set([
    String(gap.turnId),
    ...(gap.occurrenceTurnIds || []).map(String),
    ...legacyOccurrences.map((turn) => String(turn._id)),
  ])];
  let firstCitationIndex: number | null = null;

  for (const turnId of turnIds) {
    const turn = await OracleTurn.findById(turnId);
    if (!turn) continue;
    const sourceId = String(source._id);
    const existingCitation = turn.citations.find((item) => (
      item.sourceType === 'academic_source' && item.sourceId === sourceId
    ));
    const citationIndex = existingCitation?.index
      || Math.max(0, ...turn.citations.map((item) => item.index)) + 1;
    let citationInserted = false;
    const updatedBlocks = turn.contentBlocks.map((block) => {
      if (block.type !== 'text') return block;
      let text = sanitizeOracleUnresolvedMarkers(block.text);
      for (const variant of claimVariants) {
        const stem = variant.replace(/[.!?]+\s*$/u, '').trim();
        if (!stem) continue;
        const escaped = stem.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const markerPattern = new RegExp(`(${escaped})(\\s*)\\[\\?\\]([.!?]?)`, 'u');
        if (!markerPattern.test(text)) continue;
        text = text.replace(markerPattern, `$1 [${citationIndex}]$3`);
        citationInserted = true;
        break;
      }
      return text === block.text ? block : { ...block, text };
    });
    if (!citationInserted) {
      if (updatedBlocks.some((block, index) => block.text !== turn.contentBlocks[index]?.text)) {
        turn.set({ contentBlocks: updatedBlocks });
        await turn.save();
      }
      continue;
    }
    const citations: OracleCitation[] = existingCitation
      ? turn.citations.map((citation) => {
        if (citation !== existingCitation) return citation;
        const otherLinks = (citation.ruleLinks || []).filter(
          (link) => link.ruleId !== ruleLink.ruleId,
        );
        return { ...citation, ruleLinks: [...otherLinks, ruleLink] };
      })
      : [
        ...turn.citations,
        {
          index: citationIndex,
          sourceType: 'academic_source',
          sourceId,
          title: String((source as any).title || (source as any).metadata?.title || 'Nguồn học thuật đã duyệt'),
          year: Number((source as any).year) || undefined,
          excerpt: evidence.exactQuote,
          detail: rule.statement?.slice(0, 500),
          ruleLinks: [ruleLink],
        },
      ];
    turn.set({ contentBlocks: updatedBlocks, citations });
    await turn.save();
    firstCitationIndex ??= citationIndex;
  }
  return firstCitationIndex;
}

function replaceClaimMarker(text: string, variants: string[], citationIndex: number): string {
  for (const variant of variants) {
    const stem = variant.replace(/[.!?]+\s*$/u, '').trim();
    if (!stem) continue;
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const marker = new RegExp(`(${escaped})(\\s*)\\[\\?\\]([.!?]?)`, 'iu');
    if (marker.test(text)) return text.replace(marker, `$1 [${citationIndex}]$3`);
  }
  return text;
}

// Updates persisted Dream analyses that used the same unresolved claim.
async function resolveGapInDreamPosts(gap: any, rule: EvidenceGapRuleInput): Promise<number> {
  const support = await loadRuleEvidenceSupport(String(gap.claim || ''), rule);
  if (!support) return 0;
  const variants = [...new Set([gap.claim, ...(gap.relatedClaims || [])])]
    .map(cleanOracleEvidenceClaim)
    .filter(Boolean);
  const stems = variants
    .map((variant) => variant.replace(/[.!?]+\s*$/u, '').trim())
    .filter(Boolean)
    .map((stem) => stem.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  if (!stems.length) return 0;

  const markerPattern = new RegExp(`(?:${stems.join('|')})\\s*\\[\\?\\]`, 'iu');
  const dreams = await Dream.find({
    ai_status: 'completed',
    $or: [
      { 'ai_result.core_analysis': markerPattern },
      { 'ai_result.summary': markerPattern },
      { 'ai_result.interpretive_threads.reasoning': markerPattern },
      { 'ai_result.scientific_context_notes.note': markerPattern },
    ],
  }).limit(500);

  let resolvedCount = 0;
  for (const dream of dreams) {
    const analysis = dream.ai_result as any;
    if (!analysis || typeof analysis !== 'object') continue;
    const notes = Array.isArray(analysis.scientific_context_notes)
      ? analysis.scientific_context_notes
      : [];
    const sourceId = String(support.source._id);
    const orderedSourceIds: string[] = [];
    for (const note of notes) {
      for (const source of note.sources || []) {
        const key = String(source.sourceId || source.doi || source.title || '').trim();
        if (key && !orderedSourceIds.includes(key)) orderedSourceIds.push(key);
      }
    }
    if (!orderedSourceIds.includes(sourceId)) orderedSourceIds.push(sourceId);
    const citationIndex = orderedSourceIds.indexOf(sourceId) + 1;

    let changed = false;
    for (const field of ['core_analysis', 'summary'] as const) {
      const current = String(analysis[field] || '');
      const next = replaceClaimMarker(current, variants, citationIndex);
      if (next !== current) {
        analysis[field] = next;
        changed = true;
      }
    }
    for (const thread of analysis.interpretive_threads || []) {
      const current = String(thread.reasoning || '');
      const next = replaceClaimMarker(current, variants, citationIndex);
      if (next !== current) {
        thread.reasoning = next;
        changed = true;
      }
    }
    if (!changed) continue;

    const ruleId = String(rule._id);
    if (!notes.some((note: any) => String(note.ruleId || '') === ruleId)) {
      notes.push({
        ruleId,
        ruleCode: rule.ruleCode,
        ruleStatement: rule.statement,
        note: rule.statement,
        confidence: Math.min(1, Math.max(0, Number(rule.evidenceScore || 0) / 100)),
        evidenceQuotes: [{
          sourceId,
          chunkId: String(support.evidence.chunkId),
          quote: support.evidence.exactQuote,
        }],
        sources: [{
          sourceId,
          title: String((support.source as any).title || (support.source as any).metadata?.title || 'Academic source'),
          authors: (support.source as any).authors || (support.source as any).metadata?.authors || [],
          year: (support.source as any).year || (support.source as any).metadata?.year,
          journal: (support.source as any).journal || (support.source as any).publisher,
          doi: (support.source as any).doi || (support.source as any).metadata?.doi,
          chunkIds: [String(support.evidence.chunkId)],
        }],
      });
      analysis.scientific_context_notes = notes;
    }
    dream.markModified('ai_result');
    await dream.save();
    resolvedCount += 1;
  }
  return resolvedCount;
}

// Reuses an already-grounded rule when a later Oracle turn emits the same claim.
async function resolveCapturedGap(gap: any, preferredRule?: EvidenceGapRuleInput | null): Promise<void> {
  let rule = preferredRule || null;
  if (!rule && gap.resolvedRuleIds?.length) {
    rule = await KnowledgeRuleV3.findById(gap.resolvedRuleIds[0]).lean() as EvidenceGapRuleInput | null;
  }
  if (!rule) rule = await findGroundedRuleForClaim(String(gap.claim || ''));
  if (!rule) return;

  const [citationIndex, resolvedDreamCount] = await Promise.all([
    resolveGapInOracleTurn(gap, rule),
    resolveGapInDreamPosts(gap, rule),
  ]);
  if (!citationIndex && resolvedDreamCount === 0) return;
  await OracleEvidenceGap.updateOne(
    { _id: gap._id },
    {
      $set: {
        status: 'resolved',
        resolvedAt: gap.resolvedAt || new Date(),
        ...(citationIndex ? { resolutionCitationIndex: citationIndex } : {}),
      },
      $addToSet: { resolvedRuleIds: rule._id },
    },
  );
}

// Removes active records that are questions, advice, or symbolic interpretations rather than claims.
async function pruneNonResearchableOracleEvidenceGaps(): Promise<void> {
  const rows = await OracleEvidenceGap.find({})
    .select(
      '_id userId claim normalizedClaim relatedClaims occurrenceTurnIds occurrenceCount '
      + 'status candidateRuleIds resolvedRuleIds',
    )
    .lean();
  const invalidIds: Types.ObjectId[] = [];
  const sanitizedRows: any[] = [];
  for (const gap of rows) {
    const validClaims = [...new Set([gap.claim, ...(gap.relatedClaims || [])])]
      .map((claim) => cleanOracleEvidenceClaim(String(claim || '')))
      .filter(isResearchableOracleEvidenceClaim);
    if (!validClaims.length) {
      invalidIds.push(gap._id as Types.ObjectId);
      continue;
    }
    const claim = canonicalizeOracleEvidenceClaim(validClaims[0]);
    const normalizedClaim = oracleEvidenceClaimClusterKey(claim) || normalize(claim);
    const equivalentClaims = validClaims.filter((candidate) => (
      oracleEvidenceClaimClusterKey(candidate) === normalizedClaim
    ));
    sanitizedRows.push({
      ...gap,
      claim,
      normalizedClaim,
      relatedClaims: equivalentClaims.length ? equivalentClaims : [claim],
    });
  }
  if (invalidIds.length) {
    await OracleEvidenceGap.deleteMany({ _id: { $in: invalidIds } });
  }

  const groups = new Map<string, any[]>();
  for (const gap of sanitizedRows) {
    const key = `${String(gap.userId)}:${gap.normalizedClaim}`;
    groups.set(key, [...(groups.get(key) || []), gap]);
  }
  for (const equivalentGaps of groups.values()) {
    const [primary, ...duplicates] = equivalentGaps;
    const all = [primary, ...duplicates];
    const occurrenceTurnIds = [...new Set(all.flatMap((gap) =>
      (gap.occurrenceTurnIds || []).map(String)))];
    await OracleEvidenceGap.updateOne(
      { _id: primary._id },
      {
        $set: {
          claim: primary.claim,
          normalizedClaim: primary.normalizedClaim,
          relatedClaims: [...new Set(all.flatMap((gap) => gap.relatedClaims || []))],
          occurrenceTurnIds,
          occurrenceCount: all.reduce(
            (total, gap) => total + Math.max(1, Number(gap.occurrenceCount) || 1),
            0,
          ),
          status: all.some((gap) => gap.status === 'resolved')
            ? 'resolved'
            : all.some((gap) => gap.status === 'candidate_found')
              ? 'candidate_found'
              : 'unresolved',
          candidateRuleIds: [...new Set(all.flatMap((gap) =>
            (gap.candidateRuleIds || []).map(String)))],
          resolvedRuleIds: [...new Set(all.flatMap((gap) =>
            (gap.resolvedRuleIds || []).map(String)))],
        },
      },
    );
    if (duplicates.length) {
      await OracleEvidenceGap.deleteMany({ _id: { $in: duplicates.map((gap) => gap._id) } });
    }
  }
}

export async function captureOracleEvidenceGaps(input: {
  userId: Types.ObjectId;
  threadId: Types.ObjectId;
  turnId: Types.ObjectId;
  answer: string;
}): Promise<void> {
  const turn = await OracleTurn.findById(input.turnId);
  let answer = input.answer;
  if (turn) {
    let changed = false;
    turn.contentBlocks = turn.contentBlocks.map((block) => {
      const text = sanitizeOracleUnresolvedMarkers(block.text);
      if (text === block.text) return block;
      changed = true;
      return { ...block, text };
    });
    if (changed) {
      turn.markModified('contentBlocks');
      await turn.save();
    }
    answer = turn.contentBlocks.map((block) => block.text).join('\n');
  }

  const existingForTurn = await OracleEvidenceGap.find({
    $or: [
      { turnId: input.turnId },
      { occurrenceTurnIds: input.turnId },
    ],
  }).select('_id claim relatedClaims').lean();
  const invalidGapIds = existingForTurn
    .filter((gap) => ![gap.claim, ...(gap.relatedClaims || [])].some((claim) =>
      isResearchableOracleEvidenceClaim(String(claim || ''))))
    .map((gap) => gap._id);
  if (invalidGapIds.length) {
    await OracleEvidenceGap.deleteMany({ _id: { $in: invalidGapIds } });
  }

  const sourceClaims = answer
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((item) => item.trim())
    .filter((item) => item.includes('[?]'))
    .map((item) => cleanOracleEvidenceClaim(item).replace(/\s+/gu, ' ').slice(0, 1200))
    .filter(isResearchableOracleEvidenceClaim);
  const groupedClaims = new Map<string, { claim: string; variants: Set<string> }>();
  for (const sourceClaim of [...new Set(sourceClaims)]) {
    const claim = canonicalizeOracleEvidenceClaim(sourceClaim);
    const normalizedClaim = oracleEvidenceClaimClusterKey(claim) || normalize(claim);
    const existing = groupedClaims.get(normalizedClaim);
    if (existing) {
      existing.variants.add(sourceClaim);
    } else {
      groupedClaims.set(normalizedClaim, { claim, variants: new Set([sourceClaim]) });
    }
  }
  for (const [normalizedClaim, group] of [...groupedClaims].slice(0, 4)) {
    let gap = await OracleEvidenceGap.findOne({ userId: input.userId, normalizedClaim });
    let groundedRule: EvidenceGapRuleInput | null = null;
    if (!gap) {
      groundedRule = await findGroundedRuleForClaim(group.claim);
      if (groundedRule) {
        gap = await OracleEvidenceGap.findOne({
          userId: input.userId,
          resolvedRuleIds: groundedRule._id,
        });
      }
    }

    if (!gap) {
      gap = await OracleEvidenceGap.create({
        userId: input.userId,
        threadId: input.threadId,
        turnId: input.turnId,
        occurrenceTurnIds: [input.turnId],
        claim: group.claim,
        normalizedClaim,
        relatedClaims: [...group.variants],
        occurrenceCount: 1,
        status: 'unresolved',
        candidateRuleIds: [],
        resolvedRuleIds: [],
      });
    } else {
      const alreadyRecorded = gap.occurrenceTurnIds.some(
        (turnId: Types.ObjectId) => String(turnId) === String(input.turnId),
      );
      await OracleEvidenceGap.updateOne(
        { _id: gap._id },
        {
          $addToSet: {
            relatedClaims: { $each: [...group.variants] },
            occurrenceTurnIds: input.turnId,
          },
          ...(!alreadyRecorded ? { $inc: { occurrenceCount: 1 } } : {}),
        },
      );
      gap = await OracleEvidenceGap.findById(gap._id);
    }

    if (gap) await resolveCapturedGap(gap, groundedRule);
  }
}

export async function reconcileOracleEvidenceGapsForRule(rule: EvidenceGapRuleInput): Promise<void> {
  const ruleText = buildEvidenceGapRuleText(rule);
  if (!ruleText) return;
  const gapCursor = OracleEvidenceGap.find({ status: { $ne: 'resolved' } })
    .sort({ updatedAt: -1 })
    .cursor();
  for await (const gap of gapCursor) {
    const similarity = evidenceGapRuleSimilarity(gap.claim, ruleText);
    if (similarity < 0.28) continue;
    const [citationIndex, resolvedDreamCount] = await Promise.all([
      resolveGapInOracleTurn(gap, rule),
      resolveGapInDreamPosts(gap, rule),
    ]);
    if (!citationIndex && resolvedDreamCount === 0) {
      await OracleEvidenceGap.updateOne(
        { _id: gap._id },
        { $set: { status: 'candidate_found' }, $addToSet: { candidateRuleIds: rule._id } },
      );
      continue;
    }
    await OracleEvidenceGap.updateOne(
      { _id: gap._id },
      {
        $set: {
          status: 'resolved',
          resolvedAt: new Date(),
          ...(citationIndex ? { resolutionCitationIndex: citationIndex } : {}),
        },
        $addToSet: { resolvedRuleIds: rule._id },
      },
    );
  }
}

export interface OracleEvidenceGapRuleMatch {
  gapId: string;
  claim: LocalizedOracleEvidenceClaim;
  status: 'unresolved' | 'candidate_found' | 'resolved';
  occurrenceCount: number;
  similarity: number;
  linkedAsCandidate: boolean;
  resolvedByRule: boolean;
  resolutionReady: boolean;
  blockers: Array<'similarity'>;
}

export async function getOracleEvidenceGapMatchesForRule(
  rule: EvidenceGapRuleInput,
): Promise<OracleEvidenceGapRuleMatch[]> {
  const ruleText = buildEvidenceGapRuleText(rule);
  if (!ruleText) return [];
  const gaps = await OracleEvidenceGap.find({
    $or: [
      { status: { $ne: 'resolved' } },
      { resolvedRuleIds: rule._id },
    ],
  })
    .sort({ updatedAt: -1 })
    .select('_id claim status occurrenceCount candidateRuleIds resolvedRuleIds')
    .lean();

  return gaps
    .map((gap) => {
      if (!isResearchableOracleEvidenceClaim(String(gap.claim || ''))) return null;
      const similarity = evidenceGapRuleSimilarity(String(gap.claim || ''), ruleText);
      const linkedAsCandidate = (gap.candidateRuleIds || []).some(id => String(id) === String(rule._id));
      const resolvedByRule = (gap.resolvedRuleIds || []).some(id => String(id) === String(rule._id));
      if (!linkedAsCandidate && !resolvedByRule && similarity < 0.28) return null;
      const blockers: OracleEvidenceGapRuleMatch['blockers'] = [];
      if (similarity < 0.5) blockers.push('similarity');
      return {
        gapId: String(gap._id),
        claim: localizeOracleEvidenceClaim(String(gap.claim || '')),
        status: gap.status,
        occurrenceCount: Number(gap.occurrenceCount || 0),
        similarity,
        linkedAsCandidate,
        resolvedByRule,
        resolutionReady: resolvedByRule || blockers.length === 0,
        blockers,
      };
    })
    .filter((match): match is OracleEvidenceGapRuleMatch => Boolean(match))
    .sort((left, right) => Number(right.resolvedByRule) - Number(left.resolvedByRule)
      || Number(right.linkedAsCandidate) - Number(left.linkedAsCandidate)
      || right.similarity - left.similarity)
    .slice(0, 12);
}

export async function linkOracleEvidenceGapCandidatesForRules(
  rules: EvidenceGapRuleInput[],
): Promise<void> {
  await pruneNonResearchableOracleEvidenceGaps();
  if (!rules.length) return;
  const gapCursor = OracleEvidenceGap.find({ status: { $ne: 'resolved' } })
    .sort({ updatedAt: -1 })
    .cursor();
  for await (const gap of gapCursor) {
    const matches = rules
      .map((rule) => {
        const ruleText = buildEvidenceGapRuleText(rule);
        return { rule, similarity: ruleText ? evidenceGapRuleSimilarity(gap.claim, ruleText) : 0 };
      })
      .filter((match) => match.similarity >= 0.28)
      .sort((left, right) => right.similarity - left.similarity);
    const matchingRuleIds = matches.map((match) => match.rule._id);
    if (!matchingRuleIds.length) continue;

    const resolvable = matches.find(({ similarity }) => similarity >= 0.5);
    if (resolvable) {
      const [citationIndex, resolvedDreamCount] = await Promise.all([
        resolveGapInOracleTurn(gap, resolvable.rule),
        resolveGapInDreamPosts(gap, resolvable.rule),
      ]);
      if (citationIndex || resolvedDreamCount > 0) {
        await OracleEvidenceGap.updateOne(
          { _id: gap._id },
          {
            $set: {
              status: 'resolved',
              resolvedAt: new Date(),
              ...(citationIndex ? { resolutionCitationIndex: citationIndex } : {}),
            },
            $addToSet: {
              candidateRuleIds: { $each: matchingRuleIds },
              resolvedRuleIds: resolvable.rule._id,
            },
          },
        );
        continue;
      }
    }
    await OracleEvidenceGap.updateOne(
      { _id: gap._id },
      {
        $set: { status: 'candidate_found' },
        $addToSet: { candidateRuleIds: { $each: matchingRuleIds } },
      },
    );
  }
}

// Rechecks pending arguments as soon as their academic source becomes available.
export async function reconcileOracleEvidenceGapsForSources(
  sourceIds: Array<string | Types.ObjectId>,
): Promise<void> {
  const normalizedSourceIds = sourceIds
    .map(String)
    .filter(Types.ObjectId.isValid)
    .map((sourceId) => new Types.ObjectId(sourceId));
  if (!normalizedSourceIds.length) return;
  const evidence = await KnowledgeRuleEvidenceV3.find({
    sourceId: { $in: normalizedSourceIds },
    stance: 'supports',
  }).select('ruleId').lean();
  const evidenceOwnerIds = [...new Set(evidence.map((item) => String(item.ruleId)))]
    .map((ruleId) => new Types.ObjectId(ruleId));
  if (!evidenceOwnerIds.length) return;
  const rules = await KnowledgeRuleV3.find({
    status: { $in: ['pending', 'verified'] },
    $or: [
      { _id: { $in: evidenceOwnerIds } },
      { 'compositeComponents.sourceRuleId': { $in: evidenceOwnerIds } },
    ],
  }).select(
    '_id ruleCode statement subject outcome conditions dreamFeatureTags '
    + 'status evidenceScore supportingSourceCount compositeComponents',
  ).lean() as EvidenceGapRuleInput[];
  await linkOracleEvidenceGapCandidatesForRules(rules);
}
