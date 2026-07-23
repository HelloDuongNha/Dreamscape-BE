import { Types } from 'mongoose';
import AcademicSource from '../../models/AcademicSource';
import SourceContribution from '../../models/SourceContribution';
import OracleEvidenceGap from '../../models/OracleEvidenceGap';
import OracleTurn from '../../models/OracleTurn';
import KnowledgeRuleEvidenceV3 from '../../models/rulesV3/KnowledgeRuleEvidence';
import type { OracleCitation } from './oracle.types';

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

function evidenceGapRuleSimilarity(gapClaim: string, ruleText: string): number {
  const lexical = lexicalSimilarity(gapClaim, ruleText);
  const canonicalLexical = lexicalSimilarity(
    canonicalizeOracleEvidenceClaim(gapClaim),
    canonicalizeOracleEvidenceClaim(ruleText),
  );
  const gapCluster = oracleEvidenceClaimClusterKey(gapClaim);
  const ruleCluster = oracleEvidenceClaimClusterKey(ruleText);
  // Cluster keys encode bilingual subject/relation/outcome concepts. Equality
  // is stronger than shared words, but remains below certainty: evidence and
  // approval gates still decide whether the gap can actually be resolved.
  const relationMatch = gapCluster && gapCluster === ruleCluster ? 0.72 : 0;
  return Math.max(lexical, canonicalLexical, relationMatch);
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
  if (NON_CLAIM_PATTERNS.some((pattern) => pattern.test(clean))) return false;
  const value = normalize(clean);
  const dreamScience = /giấc mơ|trong mơ|giấc ngủ|tỉnh giấc|dream|dreaming|sleep|awakening/iu.test(value);
  const memoryMechanism = /não bộ|brain/iu.test(value)
    && /ký ức|trí nhớ|memory|memories/iu.test(value);
  const psychologicalMechanism = /lo lắng|căng thẳng|áp lực|anxiety|stress/iu.test(value)
    && /hành động|chuẩn bị|lập kế hoạch|giảm|giải tỏa|sáng tạo|action|planning|reduce|creative/iu.test(value);
  const relation = /liên quan|kết hợp|tái kết hợp|đưa vào|xử lý|sử dụng|tăng|giảm|dẫn đến|thúc đẩy|ảnh hưởng|associated|related|combine|incorporat|process|increase|decrease|predict|affect/iu.test(value);
  return relation && (dreamScience || memoryMechanism || psychologicalMechanism);
}

export function canonicalizeOracleEvidenceClaim(claim: string): string {
  const clean = cleanOracleEvidenceClaim(claim);
  const value = normalize(clean);
  const vietnamese = /[ăâđêôơưà-ỹ]/iu.test(clean);
  const dream = /giấc mơ|trong mơ|giấc ngủ|dream|dreaming|sleep/iu.test(value);
  const brain = /não bộ|brain/iu.test(value);
  const memory = /ký ức|trí nhớ|thời thơ ấu|memory|memories|childhood/iu.test(value);
  const future = /tương lai|sắp tới|trách nhiệm|nhiệm vụ hiện tại|future|prospective|upcoming/iu.test(value);
  const anxiety = /lo lắng|căng thẳng|áp lực|anxiety|stress|pressure/iu.test(value);
  const creativity = /sáng tạo|linh hoạt|ứng biến|giải pháp|creative|flexib|improvis|solution/iu.test(value);
  const action = /hành động|chuẩn bị|lập kế hoạch|action|prepar|planning/iu.test(value);
  const reduction = /giảm|giải tỏa|tan biến|reduce|relief|decreas/iu.test(value);

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

  const anxiety = has(/lo lắng|căng thẳng|áp lực|sợ hãi|anxiety|stress|pressure|fear/iu);
  const creativity = has(/sáng tạo|linh hoạt|ứng biến|giải pháp|creative|flexib|improvis|solution/iu);
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

  if (action && anxiety && reduction) return 'relation:action-planning__outcome:stress-reduction';
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
  return { key, vi: cleanClaim, en: cleanClaim };
}

function academicSearchQueries(claim: string): string[] {
  const normalizedClaim = normalize(claim);
  const clusterKey = oracleEvidenceClaimClusterKey(claim);
  if (clusterKey === 'mechanism:memory-recombination__context:future-oriented-dream') {
    return [
      '"constructive episodic simulation" dreams autobiographical memory',
      '"future-oriented dreams" prospective cognition memory',
      '"prospective dreaming" anticipated future events past memory',
      '"episodic future simulation" sleep dreaming',
    ];
  }
  if (clusterKey === 'mechanism:memory-incorporation__context:dream') {
    return [
      '"memory sources of dreams" waking experience',
      '"memory incorporation in dreams" episodic fragments',
      '"day residue" dreams memory',
      '"dream-lag effect" autobiographical memory',
    ];
  }
  if (clusterKey === 'state:anxiety__outcome:creative-coping-or-improvisation') {
    return [
      '"dream incubation" creative problem solving anxiety',
      '"sleep-dependent creative problem solving" affect',
      '"dreaming" divergent thinking emotional arousal',
      '"dream affect" creative cognition problem solving',
    ];
  }
  if (clusterKey === 'relation:action-planning__outcome:stress-reduction') {
    return [
      '"action planning" perceived stress reduction',
      '"implementation intentions" anxiety stress',
      '"problem-focused coping" anxiety reduction',
      '"concrete planning" psychological stress intervention',
    ];
  }
  const concepts: string[] = [];
  const add = (...items: string[]) => concepts.push(...items);
  if (/lo lắng|căng thẳng|áp lực|anxiety|stress/iu.test(normalizedClaim)) {
    add('"anxiety reduction"', '"psychological stress"');
  }
  if (/hành động|chuẩn bị|lập kế hoạch|action|planning|prepare/iu.test(normalizedClaim)) {
    add('"action planning"', '"problem-focused coping"', '"implementation intentions"');
  }
  if (/ký ức|trí nhớ|memory|memories/iu.test(normalizedClaim)) {
    add('"dream memory"', '"memory incorporation in dreams"');
  }
  if (/tương lai|sắp tới|future|prospective/iu.test(normalizedClaim)) {
    add('"prospective dreaming"', '"future-oriented dreams"');
  }
  if (/sáng tạo|creative|creativity/iu.test(normalizedClaim)) {
    add('"dream creativity"', '"creative problem solving during sleep"');
  }
  const fallback = [...words(claim)]
    .filter((word) => !EVIDENCE_GAP_STOP_WORDS.has(word))
    .slice(0, 7)
    .join(' ');
  const base = [...new Set(concepts)];
  if (base.length >= 2) {
    return [
      `${base[0]} ${base[1]}`,
      base.slice(1, 4).join(' '),
      `${base[0]} dream study`,
    ].filter(Boolean);
  }
  return [
    `"${claim.replace(/"/gu, '').slice(0, 160)}"`,
    `${fallback} peer reviewed dream study`.trim(),
  ];
}

function buildDeepResearchPrompt(
  cleanClaim: string,
  searchTerms: string[],
  language: 'vi' | 'en',
  relatedClaims: string[] = [],
): string {
  const variants = relatedClaims
    .map(cleanOracleEvidenceClaim)
    .filter((claim, index, claims) => claim && claim !== cleanClaim && claims.indexOf(claim) === index);
  if (language === 'en') {
    return [
      'Conduct a focused Deep Research review to verify or refute this exact claim:',
      `"${cleanClaim}"`,
      ...(variants.length ? ['', 'Merged phrasings of the same evidence need:', ...variants.map((claim) => `- ${claim}`)] : []),
      '',
      'If the claim is not in English, first translate its meaning into precise academic English without broadening or changing the relationship being claimed.',
      'Search for English-language evidence in at least two scholarly indexes: Crossref, OpenAlex, PubMed/PMC, Semantic Scholar, Google Scholar, DOAJ, or an official publisher website.',
      'Verify every DOI through doi.org or Crossref. Verify any open-access full text through Unpaywall, PMC, DOAJ, an institutional repository, or the publisher. Never invent a DOI or PDF URL.',
      '',
      `Suggested concept-level queries:\n${searchTerms.map((query) => `- ${query}`).join('\n')}`,
      '',
      'Prioritize peer-reviewed studies and academic reviews. You may also include reputable university or research-institute articles, professional-association publications, government reports, and established science journalism when they accurately report a traceable study.',
      'Keep web/news material in a separate “context only” section. It must never replace the primary research used to support an academic rule.',
      'Exclude dream-symbol dictionaries, personal blogs, SEO content, anonymous posts, and sources whose underlying study cannot be identified.',
      '',
      'For every result provide: title, authors or organization, year, source type, verified DOI when one exists, publisher URL, verified open-access URL when one exists, study design, sample, method, relevant result, an exact supporting or refuting quotation with its location, and limitations.',
      'Classify each result as direct support, partial support, contradictory evidence, or irrelevant. A broad statement must not be used to prove a more specific claim.',
      'Finish with the narrowest defensible rule: subject/factor → outcome, scope, observable conditions, limitations, and the verified quotations that support it.',
    ].join('\n');
  }
  return [
    'Hãy thực hiện một lượt Deep Research có trọng tâm để kiểm chứng hoặc phản bác trực tiếp nhận định sau:',
    `"${cleanClaim}"`,
    ...(variants.length ? ['', 'Các cách diễn đạt đã được gộp vào cùng nhu cầu bằng chứng:', ...variants.map((claim) => `- ${claim}`)] : []),
    '',
    'Nếu nhận định không phải tiếng Việt, hãy dịch đúng phạm vi của nó sang tiếng Việt trước khi tìm; không được mở rộng hoặc đổi hướng quan hệ đang được nêu.',
    'Tìm bằng chứng bằng tiếng Việt trong các tạp chí, kho học thuật, trường đại học, viện nghiên cứu và cơ quan chuyên môn đáng tin cậy. Đồng thời tìm nghiên cứu quốc tế bằng tiếng Anh nếu nguồn tiếng Việt chưa đủ.',
    'Nguồn học thuật phải được đối chiếu từ ít nhất hai hệ thống như Crossref, OpenAlex, PubMed/PMC, Semantic Scholar, Google Scholar, DOAJ hoặc trang chính thức của nhà xuất bản.',
    'Mỗi DOI phải được xác minh bằng doi.org hoặc Crossref. Đường dẫn toàn văn mở phải được kiểm tra qua Unpaywall, PMC, DOAJ, kho lưu trữ của trường/viện hoặc nhà xuất bản; không được tự đoán DOI hay URL PDF.',
    '',
    `Các truy vấn theo cụm khái niệm nên thử:\n${searchTerms.map((query) => `- ${query}`).join('\n')}`,
    '',
    'Ưu tiên nghiên cứu bình duyệt và tổng quan học thuật. Có thể bổ sung bài viết của trường đại học, viện nghiên cứu, hiệp hội chuyên môn, cơ quan nhà nước và báo chí khoa học uy tín nếu bài đó dẫn rõ nghiên cứu gốc có thể kiểm tra.',
    'Tách các bài báo/tin nghiên cứu vào mục “chỉ dùng làm bối cảnh”; không được dùng chúng thay cho nghiên cứu gốc khi tạo rule học thuật.',
    'Không dùng từ điển biểu tượng giấc mơ, blog cá nhân, nội dung SEO, bài ẩn danh hoặc bài không truy được nghiên cứu gốc.',
    '',
    'Với từng kết quả, hãy cung cấp: tiêu đề, tác giả hoặc tổ chức, năm, loại nguồn, DOI đã kiểm chứng nếu có, URL nhà xuất bản, URL toàn văn mở đã kiểm tra nếu có, thiết kế nghiên cứu, cỡ mẫu, phương pháp, kết quả liên quan, trích đoạn nguyên văn hỗ trợ hoặc phản bác kèm vị trí và giới hạn.',
    'Phân loại từng nguồn thành: hỗ trợ trực tiếp, hỗ trợ một phần, bằng chứng trái chiều hoặc không liên quan. Không dùng một câu quá rộng để chứng minh một kết luận cụ thể hơn.',
    'Cuối cùng đề xuất rule hẹp nhất có thể bảo vệ: yếu tố/chủ thể → kết quả/hiện tượng, phạm vi, điều kiện quan sát được, giới hạn và các trích dẫn nguyên văn đã kiểm chứng.',
  ].join('\n');
}

export function buildOracleEvidenceGapResearchBrief(claim: string, relatedClaims: string[] = []) {
  const cleanClaim = cleanOracleEvidenceClaim(claim);
  const localizedClaim = localizeOracleEvidenceClaim(cleanClaim);
  const searchTerms = academicSearchQueries(cleanClaim);
  const localizedRelatedClaims = {
    vi: relatedClaims.map((item) => localizeOracleEvidenceClaim(item).vi),
    en: relatedClaims.map((item) => localizeOracleEvidenceClaim(item).en),
  };
  const deepResearchPrompts = {
    vi: buildDeepResearchPrompt(localizedClaim.vi, searchTerms, 'vi', localizedRelatedClaims.vi),
    en: buildDeepResearchPrompt(localizedClaim.en, searchTerms, 'en', localizedRelatedClaims.en),
  };
  return {
    claim: cleanClaim,
    claimKey: localizedClaim.key,
    localizedClaims: {
      vi: localizedClaim.vi,
      en: localizedClaim.en,
    },
    meaning: `Oracle đang sử dụng nhận định “${cleanClaim}”, nhưng thư viện hiện chưa có nguồn đã duyệt hỗ trợ trực tiếp cho quan hệ này.`,
    evidenceNeeded: [
      'Nghiên cứu bình duyệt trực tiếp đo hoặc mô tả đúng mối quan hệ trong nhận định, không chỉ giải thích biểu tượng chung.',
      'Phương pháp phải nêu rõ mẫu nghiên cứu, cách thu thập báo cáo giấc mơ và biến kết quả được đo.',
      'Cần trích đoạn nguyên văn, DOI hoặc định danh ổn định, cùng giới hạn và bằng chứng trái chiều nếu có.',
      'Ưu tiên từ hai nguồn độc lập; phân biệt rõ kết quả thực nghiệm với giả thuyết lý thuyết.',
    ],
    expectedRule: {
      subject: 'Điều kiện ngoài đời hoặc đặc trưng giấc mơ được nêu trong nhận định',
      outcome: cleanClaim,
      requiredFields: [
        'phạm vi áp dụng',
        'đặc trưng quan sát được',
        'hướng quan hệ',
        'điều kiện và giới hạn',
        'trích dẫn nguyên văn đã kiểm chứng',
      ],
    },
    searchTerms,
    deepResearchPrompt: deepResearchPrompts.vi,
    deepResearchPrompts,
  };
}

async function resolveGapInOracleTurn(
  gap: {
    userId: Types.ObjectId;
    turnId: Types.ObjectId;
    occurrenceTurnIds?: Types.ObjectId[];
    claim: string;
    relatedClaims?: string[];
  },
  rule: { _id: Types.ObjectId; statement?: string },
): Promise<number | null> {
  const evidence = await KnowledgeRuleEvidenceV3.findOne({
    ruleId: rule._id,
    stance: 'supports',
  }).sort({ verificationScore: -1, createdAt: 1 }).lean();
  if (!evidence) return null;
  const [academicSource, contribution] = await Promise.all([
    AcademicSource.findById(evidence.sourceId).lean(),
    SourceContribution.findById(evidence.sourceId).lean(),
  ]);
  const approvedFromContribution = !academicSource && contribution
    ? await AcademicSource.findOne({ sourceContributionId: contribution._id }).lean()
    : null;
  const source = academicSource || approvedFromContribution || contribution;
  if (!source) return null;
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
    const updatedBlocks = turn.contentBlocks.map((block) => {
      if (block.type !== 'text') return block;
      let text = block.text;
      for (const variant of claimVariants) {
        const stem = variant.replace(/[.!?]+\s*$/u, '').trim();
        if (!stem) continue;
        const escaped = stem.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const markerPattern = new RegExp(`(${escaped})(\\s*)\\[\\?\\]([.!?]?)`, 'u');
        if (!markerPattern.test(text)) continue;
        text = text.replace(markerPattern, `$1 [${citationIndex}]$3`);
        break;
      }
      return text === block.text ? block : { ...block, text };
    });
    if (!updatedBlocks.some((block, index) => block.text !== turn.contentBlocks[index]?.text)) {
      continue;
    }
    const citations: OracleCitation[] = existingCitation
      ? turn.citations
      : [
        ...turn.citations,
        {
          index: citationIndex,
          sourceType: 'academic_source',
          sourceId,
          title: String((source as any).title || (source as any).metadata?.title || 'Nguồn học thuật đã duyệt'),
          excerpt: evidence.exactQuote,
          detail: rule.statement?.slice(0, 500),
        },
      ];
    turn.set({ contentBlocks: updatedBlocks, citations });
    await turn.save();
    firstCitationIndex ??= citationIndex;
  }
  return firstCitationIndex;
}

export async function captureOracleEvidenceGaps(input: {
  userId: Types.ObjectId;
  threadId: Types.ObjectId;
  turnId: Types.ObjectId;
  answer: string;
}): Promise<void> {
  const sourceClaims = input.answer
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
    await OracleEvidenceGap.updateOne(
      { userId: input.userId, normalizedClaim },
      {
        $setOnInsert: {
          userId: input.userId,
          threadId: input.threadId,
          turnId: input.turnId,
          claim: group.claim,
          candidateRuleIds: [],
          resolvedRuleIds: [],
        },
        $addToSet: {
          relatedClaims: { $each: [...group.variants] },
          occurrenceTurnIds: input.turnId,
        },
        $inc: { occurrenceCount: 1 },
      },
      { upsert: true },
    );
  }
}

export async function reconcileOracleEvidenceGapsForRule(rule: {
  _id: Types.ObjectId;
  statement?: string;
  subject?: string;
  outcome?: string;
  evidenceScore?: number;
  supportingSourceCount?: number;
}): Promise<void> {
  const ruleText = [rule.statement, rule.subject, rule.outcome].filter(Boolean).join(' ');
  if (!ruleText) return;
  const gapCursor = OracleEvidenceGap.find({ status: { $ne: 'resolved' } })
    .sort({ updatedAt: -1 })
    .cursor();
  for await (const gap of gapCursor) {
    const similarity = evidenceGapRuleSimilarity(gap.claim, ruleText);
    if (similarity < 0.28) continue;
    const independentlySupported = Number(rule.evidenceScore) >= 60
      && Number(rule.supportingSourceCount) >= 2
      && similarity >= 0.5;
    if (!independentlySupported) {
      await OracleEvidenceGap.updateOne(
        { _id: gap._id },
        { $set: { status: 'candidate_found' }, $addToSet: { candidateRuleIds: rule._id } },
      );
      continue;
    }
    const citationIndex = await resolveGapInOracleTurn(gap, rule);
    if (!citationIndex) {
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
          resolutionCitationIndex: citationIndex,
        },
        $addToSet: { resolvedRuleIds: rule._id },
      },
    );
  }
}

export async function linkOracleEvidenceGapCandidatesForRules(rules: Array<{
  _id: Types.ObjectId;
  statement?: string;
  subject?: string;
  outcome?: string;
  status?: string;
  evidenceScore?: number;
  supportingSourceCount?: number;
}>): Promise<void> {
  if (!rules.length) return;
  const gapCursor = OracleEvidenceGap.find({ status: { $ne: 'resolved' } })
    .sort({ updatedAt: -1 })
    .cursor();
  for await (const gap of gapCursor) {
    const matches = rules
      .map((rule) => {
        const ruleText = [rule.statement, rule.subject, rule.outcome].filter(Boolean).join(' ');
        return { rule, similarity: ruleText ? evidenceGapRuleSimilarity(gap.claim, ruleText) : 0 };
      })
      .filter((match) => match.similarity >= 0.28)
      .sort((left, right) => right.similarity - left.similarity);
    const matchingRuleIds = matches.map((match) => match.rule._id);
    if (!matchingRuleIds.length) continue;

    const resolvable = matches.find(({ rule, similarity }) => (
      rule.status === 'verified'
      && Number(rule.evidenceScore) >= 60
      && Number(rule.supportingSourceCount) >= 2
      && similarity >= 0.5
    ));
    if (resolvable) {
      const citationIndex = await resolveGapInOracleTurn(gap, resolvable.rule);
      if (citationIndex) {
        await OracleEvidenceGap.updateOne(
          { _id: gap._id },
          {
            $set: {
              status: 'resolved',
              resolvedAt: new Date(),
              resolutionCitationIndex: citationIndex,
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
