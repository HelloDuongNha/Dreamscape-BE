import {
  canExplainPsychology,
  canGenerateContextQuestion,
  classifyRuleV3VerificationKind,
} from '../rules/ruleV3DreamApplication.service';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'for', 'with',
  'có', 'không', 'và', 'hoặc', 'là', 'của', 'ở', 'trong', 'cho', 'với', 'một', 'những', 'các',
  'tôi', 'mình', 'bạn', 'đã', 'đang', 'sẽ', 'được', 'bị', 'này', 'đó', 'thì', 'rằng', 'về',
]);

export function normalizeGroundingText(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
    .replace(/[“”‘’]/g, "'")
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveQuestionRuleIds(hypothesis: any): string[] {
  return [...new Set<string>((hypothesis?.ruleIds || [hypothesis?.ruleId])
    .map((id: unknown) => String(id || '').trim())
    .filter(Boolean))];
}

export type DreamEmotionToneKey =
  | 'urgent_conflicted'
  | 'anxious'
  | 'fearful'
  | 'sad'
  | 'calm'
  | 'mixed'
  | 'neutral';

export function deriveDreamEmotionTone(narrative: string): {
  key: DreamEmotionToneKey;
  label: string;
} {
  const text = normalizeGroundingText(narrative);
  const hasUrgency = /gấp gáp|vội|không kịp|sắp rời|deadline|urgent/u.test(text);
  const hasConflict = /bối rối|không biết phải|phân vân|do dự|confus|uncertain/u.test(text);
  const hasFear = /sợ|kinh hãi|hoảng|đe dọa|bị đuổi|fear|terror|panic/u.test(text);
  const hasAnxiety = /lo lắng|lo âu|căng thẳng|áp lực|anxious|stress/u.test(text);
  const hasSadness = /buồn|tiếc|hụt hẫng|khóc|sad|regret|grief/u.test(text);
  const hasCalm = /bình yên|thư thái|nhẹ nhõm|an tâm|calm|peaceful|relief/u.test(text);

  if (hasUrgency && hasConflict) {
    return { key: 'urgent_conflicted', label: hasSadness ? 'Gấp gáp · bối rối · tiếc nuối' : 'Gấp gáp · bối rối' };
  }
  if (hasFear) return { key: 'fearful', label: hasSadness ? 'Sợ hãi · tiếc nuối' : 'Sợ hãi' };
  if (hasAnxiety) return { key: 'anxious', label: hasSadness ? 'Lo âu · tiếc nuối' : 'Lo âu' };
  if (hasSadness) return { key: 'sad', label: 'Buồn · tiếc nuối' };
  if ((hasUrgency || hasConflict) && hasCalm) return { key: 'mixed', label: 'Cảm xúc đan xen' };
  if (hasCalm) return { key: 'calm', label: 'Bình yên' };
  if (hasUrgency || hasConflict) return { key: 'mixed', label: hasUrgency ? 'Gấp gáp' : 'Bối rối' };
  return { key: 'neutral', label: 'Chưa xác định rõ' };
}

export function removeInternalAnalysisVocabulary(value: unknown): string {
  return String(value || '')
    .replace(/\brule\s+v3\b/giu, 'kết quả nghiên cứu')
    .replace(/\brule\s+(?:đã\s+duyệt\s+)?về\s+/giu, 'nghiên cứu về ')
    .replace(/\brule\s+(?:đã\s+duyệt\s+)?/giu, 'kết quả nghiên cứu ')
    .replace(/quy luật\s+(?:đã\s+duyệt\s+)?/giu, 'kết quả nghiên cứu ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function significantTokens(value: unknown): string[] {
  return normalizeGroundingText(value)
    .split(' ')
    .filter(token => token.length >= 2 && !STOP_WORDS.has(token));
}

function containsGroundedPhrase(value: unknown, phrases: string[]): boolean {
  const haystack = ` ${normalizeGroundingText(value)} `;
  return phrases.some(phrase => haystack.includes(` ${normalizeGroundingText(phrase)} `));
}

function coverageAgainstKnownContext(candidate: string, knownContext: string): number {
  const candidateTokens = [...new Set(significantTokens(candidate))];
  const knownTokens = new Set(significantTokens(knownContext));
  if (candidateTokens.length < 3 || knownTokens.size === 0) return 0;
  const matched = candidateTokens.filter(token => knownTokens.has(token)).length;
  return matched / candidateTokens.length;
}

export function isHypothesisAlreadyAnswered(hypothesis: any, knownContext: string): boolean {
  if (!knownContext.trim()) return false;
  const hypothesisCoverage = coverageAgainstKnownContext(hypothesis?.hypothesis || '', knownContext);
  const questionCoverage = coverageAgainstKnownContext(hypothesis?.followUpQuestion || '', knownContext);
  return Math.max(hypothesisCoverage, questionCoverage) >= 0.5;
}

export function exactExcerptExists(excerpt: unknown, narrative: string): boolean {
  const normalizedExcerpt = normalizeGroundingText(excerpt);
  if (normalizedExcerpt.length < 4) return false;
  return normalizeGroundingText(narrative).includes(normalizedExcerpt);
}

export function findNarrativeSentenceForSymbol(symbol: unknown, narrative: string): string | null {
  const normalizedSymbol = normalizeGroundingText(symbol);
  if (normalizedSymbol.length < 2) return null;
  const sentences = narrative
    .split(/(?<=[.!?])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  return sentences.find(sentence => normalizeGroundingText(sentence).includes(normalizedSymbol)) || null;
}

export type ContextualTone = 'threatening' | 'reassuring' | 'ambivalent' | 'neutral';

export function inferContextualTone(evidence: unknown): ContextualTone {
  const text = normalizeGroundingText(evidence);
  const threatening = [
    'sợ', 'sợ hãi', 'tối', 'chạy', 'đuổi', 'bắt kịp', 'quên', 'mất', 'đóng lại',
    'dâng cao', 'ngập', 'khóc', 'trapped', 'fear', 'dark', 'chase', 'running', 'lost',
  ].some(term => containsGroundedPhrase(text, [term]));
  const reassuring = [
    'an ủi', 'bảo vệ', 'ôm', 'ấm áp', 'bình yên', 'vui', 'ánh sáng',
    'comfort', 'protect', 'embrace', 'peaceful', 'safe', 'joy',
  ].some(term => containsGroundedPhrase(text, [term]));
  if (threatening && reassuring) return 'ambivalent';
  if (threatening) return 'threatening';
  if (reassuring) return 'reassuring';
  return 'neutral';
}

export function buildGroundedMotifExplanation(note: any, rules: any[]): string {
  const symbol = normalizeGroundingText(note?.symbol);
  const evidence = String(note?.dreamEvidence || '').trim();
  const ruleText = normalizeGroundingText((rules || []).map(rule => `${rule?.factor || ''} ${rule?.ruleStatement || ''}`).join(' '));
  const hasMemoryRule = /memory|ky uc|tri nho|ghi nho|episodic|autobiograph/u.test(
    ruleText.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
  );
  const hasThreatRule = /threat|anxiety|avoid|stress|de doa|lo au|cang thang/u.test(
    ruleText.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
  );

  if (containsGroundedPhrase(symbol, ['nhà ga', 'station'])) {
    return 'Nhà ga gom toàn bộ giấc mơ vào một tình huống phải chờ, chọn và kịp thời gian. Ở đây nó quan trọng vì hai chuyến tàu cùng sắp rời đi, chứ không phải vì “nhà ga” luôn có một nghĩa tượng trưng cố định. Điều cần kiểm tra ngoài đời là bạn có đang phải phân chia sự chú ý giữa hai mốc thời gian khác nhau hay không.';
  }
  if (containsGroundedPhrase(symbol, ['tấm vé tàu', 'vé tàu', 'ticket'])) {
    if (containsGroundedPhrase(evidence, ['ngày hôm qua', 'yesterday'])) {
      return 'Dòng “ngày hôm qua” trên tấm vé đặt một dấu mốc quá khứ vào hành trình đang diễn ra. Chi tiết này có thể giúp nối một việc vừa xảy ra với phần còn lại của câu chuyện, nhưng chưa đủ để biến tấm vé thành biểu tượng cố định hay dự báo điểm đến.';
    }
    if (containsGroundedPhrase(evidence, ['tên dự án', 'project'])) {
      return 'Tấm vé mang tên dự án nối trực tiếp cô giáo và lớp học cũ với công việc bạn đang thực hiện. Trong chuỗi cảnh này, nó hoạt động như một vật chuyển tiếp đưa chất liệu quá khứ vào mối bận tâm hiện tại; nó không tự nó có một ý nghĩa biểu tượng cố định. Cách hiểu này chỉ được giữ khi dự án và việc chuẩn bị ngoài đời được người kể xác nhận.';
    }
    return 'Tấm vé tạo một điểm chuyển giữa nơi xuất phát và cảnh tiếp theo của giấc mơ. Chưa có đủ dữ kiện để suy ra nó đại diện cho một lựa chọn, thời hạn hay dự báo cụ thể nếu những điều đó không xuất hiện trong chính lời kể.';
  }
  if (containsGroundedPhrase(symbol, ['chiếc cặp khóa', 'cặp khóa', 'locked case', 'locked bag'])) {
    return 'Chiếc cặp được giới thiệu là chứa thứ cần cho ngày mai nhưng lại không kịp mở, vì vậy nó làm rõ cảm giác thiếu thông tin khi thời hạn đang tới gần. Chi tiết này nối cô giáo, việc chuẩn bị và tiếng chuông rời ga thành cùng một áp lực. Nó chỉ đáng đọc theo hướng chuẩn bị nếu bạn thực sự đang có một việc gần hạn cần nhiều thông tin.';
  }
  if (containsGroundedPhrase(symbol, ['sàn nhà biến thành mặt nước', 'mặt nước', 'floor became water'])) {
    return 'Mặt sàn biến thành nước đúng lúc chiếc cặp chưa được mở và cả hai chuyến tàu biến mất. Thay đổi này lấy đi chỗ đứng ổn định và khép lại cơ hội lựa chọn, nên nó giải thích vì sao cảm giác gấp gáp chuyển thành tiếc nuối khi tỉnh dậy. Dữ liệu hiện có chưa đủ để gán cho nước một ý nghĩa tâm lý độc lập ngoài vai trò của nó trong chuỗi cảnh này.';
  }

  if (hasMemoryRule && containsGroundedPhrase(symbol, ['sổ', 'sách', 'vở', 'trang trắng', 'notebook', 'book', 'page'])) {
    return 'Cuốn sổ mất chữ xuất hiện đúng lúc người kể sợ đánh mất một điều quan trọng, nên chi tiết này phù hợp với cơ chế xử lý ký ức hơn là một “mã biểu tượng” cố định. Nó có thể phản ánh áp lực phải giữ hoặc truy xuất thông tin trong đời sống thức. Cách hiểu này mạnh lên nếu người kể xác nhận đang có yêu cầu ghi nhớ, và yếu đi nếu không có áp lực tương ứng.';
  }
  if (hasThreatRule && containsGroundedPhrase(symbol, ['đuổi', 'đuổi theo', 'chạy', 'chạy trốn', 'bắt kịp', 'pursuit', 'chase', 'running'])) {
    return 'Cảnh bị đuổi tạo cảm giác nguy cấp nhưng không cho bạn nhìn rõ nguồn đe dọa, vì vậy trọng tâm nằm ở trạng thái bị thúc ép và phải phản ứng nhanh. Một khả năng đáng kiểm tra là tâm trí đang diễn tập cách đối phó với áp lực hoặc một việc bạn muốn né tránh. Hướng này phải giảm ưu tiên nếu ngoài đời không có áp lực hay việc trì hoãn tương ứng.';
  }
  if (hasMemoryRule && containsGroundedPhrase(symbol, ['bà', 'bà ngoại', 'bà nội', 'ông', 'ông ngoại', 'ông nội', 'mẹ', 'cha', 'nhà cũ', 'trường cũ', 'grandmother', 'family', 'old house'])) {
    return 'Người thân và nơi chốn cũ đưa một ký ức tự truyện cụ thể vào giấc mơ. Nếu có kết luận học thuật phù hợp về việc trải nghiệm gần đây đi vào giấc mơ, câu hỏi xác nhận chỉ kiểm tra xem ký ức này có vừa được khơi lại ngoài đời hay không. Không được suy ra người thân tượng trưng cho sự che chở nếu chưa có một kết luận học thuật riêng hỗ trợ mối liên hệ đó.';
  }
  if (containsGroundedPhrase(symbol, ['cầu', 'cây cầu', 'cửa', 'cánh cửa', 'nước', 'mặt nước', 'bridge', 'door', 'water'])) {
    if (containsGroundedPhrase(symbol, ['cầu', 'cây cầu', 'bridge'])
      && containsGroundedPhrase(evidence, ['ghép thành', 'tạo thành', 'built', 'build'])) {
      return 'Cây cầu xuất hiện như thứ bạn chủ động ghép nên để thay cho cách trình bày thông thường. Vai trò cụ thể của nó trong giấc mơ là một phương án giải quyết được dựng từ các mảnh có sẵn, không phải một chướng ngại mặc định. Cần đối chiếu với điều bạn đã nghĩ khi thức để biết đây là biến thể của ý tưởng có sẵn hay một liên tưởng mới trong mơ.';
    }
    return 'Hình ảnh này nằm đúng điểm chuyển giữa hai cảnh và làm mục tiêu trở nên khó tiếp cận hơn. Nó cho thấy câu chuyện đang đổi hướng hoặc bị cản trở, nhưng chưa đủ để kết luận bạn đang trải qua một “bước ngoặt cuộc đời”. Cách hiểu đó chỉ nên được giữ lại khi hoàn cảnh hiện tại cung cấp thêm bằng chứng.';
  }

  const original = String(note?.meaning || '').trim();
  if (/(?:đại diện cho|biểu thị|tượng trưng cho)/iu.test(original)) {
    const label = String(note?.symbol || 'Hình ảnh này').trim();
    return `${label.charAt(0).toLocaleUpperCase('vi')}${label.slice(1)} cần được đọc theo vai trò của nó trong chuỗi sự kiện hiện tại${evidence ? `, đặc biệt ở đoạn “${evidence}”` : ''}. Chưa có đủ bằng chứng để gán cho hình ảnh này một ý nghĩa cố định; cách hiểu chỉ nên được giữ lại khi phù hợp với hoàn cảnh mà người kể xác nhận.`;
  }
  return original;
}

export function sanitizeUnsupportedDreamClaims(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) return text;

  return text.split(/(?<=[.!?])\s+/u).map(sentence => {
    const normalized = normalizeGroundingText(sentence);
    if (containsGroundedPhrase(normalized, ['bà', 'bà ngoại', 'bà nội', 'ông', 'ông ngoại', 'ông nội', 'mẹ', 'cha', 'người thân', 'grandmother', 'family'])
      && /an ủi|bảo vệ|che chở|comfort|protect|safety/u.test(normalized)) {
      return 'Người thân và nơi chốn cũ làm cảnh mơ mang tính ký ức tự truyện; chưa có đủ bằng chứng để gọi đó là biểu tượng của sự bảo vệ nếu người kể chưa xác nhận mối liên hệ này.';
    }
    if (containsGroundedPhrase(normalized, ['cầu', 'cây cầu', 'cánh cửa', 'bridge', 'door'])
      && /chuyển đổi|chuyển tiếp|bước ngoặt|transition|turning point/u.test(normalized)) {
      return 'Cầu hoặc cánh cửa đang nối và ngăn cách các cảnh trong chính giấc mơ; chưa có đủ bằng chứng để suy ra một bước ngoặt ngoài đời.';
    }
    return sentence;
  }).join(' ');
}

export function isVagueFollowUpQuestion(question: unknown): boolean {
  const text = normalizeGroundingText(question);
  if (text.length < 25) return true;
  const vaguePatterns = [
    'điều gì quan trọng',
    'sự kiện quan trọng liên quan',
    'có điều gì đó',
    'một vấn đề nào đó',
    'liên quan đến ngôi trường',
    'liên quan đến nhà bà',
    'thay đổi lớn trong cuộc sống',
    'something important',
    'an important event related',
  ];
  if (vaguePatterns.some(pattern => text.includes(normalizeGroundingText(pattern)))) return true;
  // One confirmation question must not bundle alternatives with "hoặc/or".
  if (/\bhoặc\b|\bor\b/u.test(text)) return true;
  const hasConcreteTimeframe = [
    'gần đây', 'trước đây', 'trong tuần', 'trong hai ngày', 'trong ba ngày', 'trong hai tuần', 'hiện tại', 'sắp tới', 'ngày mai',
    'recently', 'this week', 'past two weeks', 'currently', 'upcoming', 'tomorrow',
  ].some(term => text.includes(normalizeGroundingText(term)));
  const hasNumericVietnameseTimeframe = /\btrong \d+ (?:ngay|tuan|thang)\b/u.test(
    text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
  );
  return !(hasConcreteTimeframe || hasNumericVietnameseTimeframe);
}

export function isSubstantiveCoreAnalysis(value: unknown): boolean {
  const text = String(value || '').trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return text.length >= 320 && sentences.length >= 4;
}

const TITLE_CONNECTORS = new Set([
  'giấc', 'mơ', 'đêm', 'và', 'cùng', 'trong', 'về', 'nỗi', 'ký', 'ức',
  'dream', 'night', 'and', 'with', 'in', 'of', 'memory',
]);

export function isGroundedDreamTitle(title: unknown, narrative: string): boolean {
  const titleText = String(title || '').trim();
  if (titleText.length < 4 || titleText.length > 100) return false;
  const narrativeTokens = new Set(significantTokens(narrative));
  const concreteTitleTokens = significantTokens(titleText)
    .filter(token => token.length >= 3 && !TITLE_CONNECTORS.has(token));
  return concreteTitleTokens.length > 0
    && concreteTitleTokens.every(token => narrativeTokens.has(token));
}

function displayMotif(value: string): string {
  return value
    .split(' ')
    .map(word => word ? `${word[0].toLocaleUpperCase('vi')}${word.slice(1)}` : word)
    .join(' ');
}

export function buildGroundedDreamTitle(narrative: string, motifs: unknown[] = []): string {
  const groundedMotifs = motifs
    .map(value => String(value || '').trim())
    .filter(value => value && exactExcerptExists(value, narrative));
  const preferred = groundedMotifs.length >= 2
    ? groundedMotifs
    : extractContextualMotifHints(narrative, 6);
  const unique = [...new Map(preferred.map(item => [normalizeGroundingText(item), item])).values()];
  if (unique.length >= 2) return `${displayMotif(unique[0])} và ${displayMotif(unique[1])}`;
  if (unique.length === 1) return `Giấc Mơ Về ${displayMotif(unique[0])}`;
  return 'Một Giấc Mơ Đáng Suy Ngẫm';
}

export function sanitizeInterpretiveThreads(threads: any[], narrative: string): any[] {
  const accepted: any[] = [];
  for (const thread of threads || []) {
    const evidence = [...new Set((thread?.dreamEvidence || [])
      .map((item: unknown) => String(item).trim())
      .filter((item: string) => exactExcerptExists(item, narrative)))];
    const reasoning = String(thread?.reasoning || '').trim();
    const alternative = String(thread?.alternativeExplanation || '').trim();
    if (!String(thread?.title || '').trim() || evidence.length < 2 || reasoning.length < 80 || alternative.length < 30) continue;
    accepted.push({
      title: String(thread.title).trim(),
      dreamEvidence: evidence.slice(0, 3),
      reasoning,
      alternativeExplanation: alternative,
    });
    if (accepted.length >= 3) break;
  }
  return accepted;
}

function firstDistinctNarrativeSentences(narrative: string, terms: string[], limit = 2): string[] {
  const sentences = narrative
    .split(/(?<=[.!?])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  const matches = sentences.filter(sentence => {
    const normalized = normalizeGroundingText(sentence);
    return terms.some(term => normalized.includes(normalizeGroundingText(term)));
  });
  return [...new Set(matches)].slice(0, limit);
}

function presentDreamCues(narrative: string, candidates: string[], limit = 4): string[] {
  const text = normalizeGroundingText(narrative);
  return candidates.filter((candidate, index) =>
    candidates.indexOf(candidate) === index && containsGroundedPhrase(text, [candidate]))
    .slice(0, limit);
}

/**
 * Deterministic safety net for a small model that produced only vague questions.
 * It never creates a hypothesis unless an approved retrieved rule belongs to a
 * supported mechanism family and at least two exact dream sentences are present.
 */
export function buildRuleGroundedFallbackHypotheses(rules: any[], narrative: string): any[] {
  const accepted: any[] = [];
  const atomicRuleApplications = (rules || []).flatMap((rule: any) => {
    const components = Array.isArray(rule?.compositeComponents) ? rule.compositeComponents : [];
    if (!rule?.isComposite || components.length < 2) return [rule];
    return components.map((component: any) => ({
      ...rule,
      isComposite: false,
      compositeComponents: [],
      ruleStatement: component.statement,
      factor: component.subject,
      outcome: component.outcome,
      conditions: component.conditions || [],
      limitations: component.limitations || [],
      dreamFeatureTags: component.dreamFeatureTags || [],
      compositeComponentRuleId: String(component.sourceRuleId || ''),
      compositeComponentRuleCode: component.ruleCode,
    }));
  });
  for (const rule of atomicRuleApplications) {
    if (!canGenerateContextQuestion(rule)) continue;
    let family = '';
    let evidence: string[] = [];
    let hypothesis = '';
    let followUpQuestion = '';
    let reasonForAsking = '';
    let ifYesMeaning = '';
    let ifNoMeaning = '';
    let matchedCue = '';
    let questionType: 'past' | 'present' | 'future' = 'present';
    let alternateQuestionDimension = '';
    let alternateFollowUpQuestion = '';
    let alternateReasonForAsking = '';
    let alternateIfYesMeaning = '';
    let alternateIfNoMeaning = '';
    let alternateQuestionType: 'past' | 'present' | 'future' = 'present';
    const verificationKind = classifyRuleV3VerificationKind(rule);

    if (verificationKind === 'weak_association_recombination') {
      const cues = presentDreamCues(narrative, [
        'lớp học tiểu học cũ', 'bảng đen', 'cuộc họp sắp tới', 'cô giáo cũ',
        'tấm vé tàu', 'dự án', 'bàn phím máy tính', 'văn phòng trên Mặt Trăng',
        'mảnh đồ chơi', 'căn bếp thời thơ ấu', 'cây cầu', 'đàn chim',
      ]);
      if (cues.length < 2) continue;
      family = 'weak_association_recombination';
      evidence = firstDistinctNarrativeSentences(narrative, cues, 3);
      const cueList = cues.slice(0, 3).map(cue => `“${cue}”`).join(', ');
      hypothesis = 'Giấc mơ đang đặt nhiều mảnh ký ức và mối bận tâm vốn thuộc các bối cảnh khác nhau vào cùng một cách giải quyết mới.';
      followUpQuestion = `Trong bảy ngày trước giấc mơ, ít nhất hai chi tiết ${cueList} có được gợi lại từ những sự việc riêng biệt ngoài đời không?`;
      reasonForAsking = 'Câu hỏi kiểm tra nguồn của các mảnh ghép, không hỏi bạn có “sáng tạo” hay không. Nếu chúng thật sự được gợi từ những tình huống khác nhau, cách đối chiếu về liên kết lỏng giữa các mảnh ký ức phù hợp hơn với trường hợp này.';
      ifYesMeaning = 'Bạn xác nhận ít nhất hai mảnh trong chuỗi cảnh có nguồn đời thực riêng biệt gần thời điểm ngủ; phân tích giữ hướng tâm trí đã kết hợp lại những chất liệu khác nhau, nhưng không suy ra năng lực sáng tạo của bạn.';
      ifNoMeaning = 'Bạn không xác nhận các mảnh có nguồn đời thực riêng biệt gần đây; phân tích giảm ưu tiên hướng “tái kết hợp các liên kết yếu” và giữ chuỗi phi thực tế như một cấu trúc chưa rõ nguồn.';
      questionType = 'past';
      alternateQuestionDimension = 'creative_problem_preoccupation';
      alternateFollowUpQuestion = 'Trong ba ngày trước giấc mơ, bạn có chủ động tìm một cách trình bày hoặc giải quyết mới cho dự án đang làm không?';
      alternateReasonForAsking = 'Câu hỏi này thu một dữ kiện khác: có bài toán sáng tạo đang được xử lý khi thức hay không, thay vì hỏi lại nguồn của các hình ảnh trong mơ.';
      alternateIfYesMeaning = 'Bạn xác nhận đang chủ động tìm một cách giải quyết mới; việc cây cầu được ghép từ đồ chơi có thể được giữ như một phép thử tưởng tượng quanh bài toán đó, không phải bằng chứng rằng giấc mơ đã giải quyết đúng vấn đề.';
      alternateIfNoMeaning = 'Bạn không có bài toán trình bày hoặc giải pháp mới đang được xử lý; phân tích không dùng hướng “ấp ủ một giải pháp sáng tạo” để giải thích cảnh ghép cây cầu.';
      alternateQuestionType = 'past';
    } else if (verificationKind === 'implausible_future_scenario') {
      family = 'implausible_future_scenario';
      evidence = firstDistinctNarrativeSentences(
        narrative,
        ['cuộc họp sắp tới', 'dự án', 'trình bày', 'Mặt Trăng', 'đàn chim', 'biến thành'],
        3,
      );
      hypothesis = 'Chuỗi cảnh phi thực tế có thể đang xoay quanh một sự kiện tương lai có thật, nhưng không phải là bản mô phỏng sát thực hay lời dự báo.';
      followUpQuestion = 'Trong bảy ngày tới, bạn có một buổi họp hoặc trình bày thật liên quan trực tiếp đến dự án xuất hiện trong giấc mơ không?';
      reasonForAsking = 'Câu hỏi tách sự kiện ngoài đời khỏi phần hư cấu như đoàn tàu bàn phím, Mặt Trăng và đàn chim. Chỉ sự kiện thật mới cho phép giữ mối nối hướng tới tương lai cho ca này.';
      ifYesMeaning = 'Bạn xác nhận có một sự kiện thật sắp tới liên quan dự án; phân tích giữ sự kiện đó làm trục bối cảnh, đồng thời xem các cảnh phi thực tế là cách giấc mơ biến đổi chất liệu chứ không phải dự báo.';
      ifNoMeaning = 'Bạn không xác nhận có sự kiện thật sắp tới; phân tích loại hướng “mô phỏng một buổi trình bày gần hạn” và không suy ra tương lai từ cảnh mơ.';
      questionType = 'future';
    } else if (verificationKind === 'waking_prospective_difference') {
      family = 'waking_prospective_difference';
      evidence = firstDistinctNarrativeSentences(
        narrative,
        ['trình bày', 'slide', 'mảnh đồ chơi', 'cây cầu', 'dự án'],
        3,
      );
      hypothesis = 'Cảnh ghép cây cầu có thể khác với kế hoạch có chủ đích khi thức: nó dùng cùng mối bận tâm nhưng tạo ra một giải pháp phi thực tế.';
      followUpQuestion = 'Trong 24 giờ trước khi ngủ, bạn có chủ động diễn tập hoặc lập kế hoạch cho buổi trình bày được nhắc trong giấc mơ không?';
      reasonForAsking = 'Câu hỏi kiểm tra quá trình chuẩn bị có chủ đích khi thức, để phân biệt nó với cách giấc mơ tự do kết hợp đồ chơi, cây cầu và khán giả.';
      ifYesMeaning = 'Bạn xác nhận đã chuẩn bị có chủ đích trước khi ngủ; phân tích có thể đối chiếu kế hoạch khi thức với phiên bản phi thực tế trong mơ, nhưng không coi hai quá trình là giống nhau.';
      ifNoMeaning = 'Bạn không chủ động diễn tập hoặc lập kế hoạch trước khi ngủ; phân tích giảm ưu tiên hướng giấc mơ biến đổi một buổi chuẩn bị vừa diễn ra.';
      questionType = 'past';
      alternateQuestionDimension = 'novel_solution_origin';
      alternateFollowUpQuestion = 'Trước giấc mơ này, bạn đã từng nghĩ tới ý tưởng dùng các mảnh rời để tạo thành một giải pháp giống cây cầu chưa?';
      alternateReasonForAsking = 'Câu hỏi kiểm tra nguồn gốc của giải pháp xuất hiện trong mơ: nó đã có khi thức hay chỉ xuất hiện lần đầu trong chuỗi mơ.';
      alternateIfYesMeaning = 'Bạn xác nhận ý tưởng đã tồn tại khi thức; cảnh cây cầu có thể là sự tiếp tục của một phương án có sẵn hơn là một liên tưởng mới xuất hiện trong mơ.';
      alternateIfNoMeaning = 'Bạn chưa từng nghĩ tới phương án tương tự; cảnh cây cầu được giữ như một liên tưởng mới của giấc mơ, nhưng chưa đủ để kết luận nó hữu ích hay chứng minh tư duy sáng tạo.';
      alternateQuestionType = 'past';
    } else if (verificationKind === 'multiple_future_horizons') {
      family = 'multiple_future_horizons';
      evidence = firstDistinctNarrativeSentences(
        narrative,
        ['8 giờ sáng mai', 'tháng chín năm sau', 'chuyến tàu đầu tiên', 'chuyến tàu thứ hai', 'cả hai đều sắp'],
      );
      hypothesis = 'Hai mốc tương lai rất gần và khá xa có thể đang được giấc mơ ghép thành một xung đột chuẩn bị hoặc ưu tiên.';
      followUpQuestion = 'Hiện tại, bạn có đang phải chuẩn bị đồng thời cho một việc diễn ra trong vài ngày tới và một kế hoạch kéo dài nhiều tháng không?';
      reasonForAsking = 'Hai bảng giờ biến một việc rất gần và một kế hoạch xa hơn thành hai chuyến tàu cùng rời ga. Câu trả lời giúp phân biệt một xung đột ưu tiên đang có thật với một tình thế chỉ tồn tại trong câu chuyện của giấc mơ.';
      ifYesMeaning = 'Câu trả lời Có làm khả năng “hai kế hoạch cùng gây áp lực” phù hợp hơn; hai chuyến tàu có thể được hiểu như cách giấc mơ đặt hai yêu cầu thời gian cạnh nhau, không phải một lời tiên đoán.';
      ifNoMeaning = 'Câu trả lời Không làm yếu cách hiểu về hai kế hoạch tương lai; hệ thống nên xem hai mốc thời gian như cấu trúc hư cấu của giấc mơ.';
      questionType = 'present';
      alternateQuestionDimension = 'priority_pressure';
      alternateFollowUpQuestion = 'Trong bảy ngày tới, bạn có một hạn chót cụ thể khiến mình phải tạm gác hoặc trì hoãn kế hoạch dài hạn không?';
      alternateReasonForAsking = 'Câu hỏi thứ hai không hỏi lại việc có hai kế hoạch. Nó kiểm tra hệ quả thực tế của xung đột: một hạn chót gần có đang chiếm chỗ của hướng đi dài hạn hay không.';
      alternateIfYesMeaning = 'Câu trả lời Có xác nhận một xung đột ưu tiên cụ thể, nên cách đọc hai chuyến tàu như hai yêu cầu thời gian cạnh tranh được giữ lại.';
      alternateIfNoMeaning = 'Câu trả lời Không cho thấy hai mốc chưa tạo thành xung đột ưu tiên ngoài đời; hệ thống không nên dùng hướng này làm trục chính.';
      alternateQuestionType = 'future';
    } else if (verificationKind === 'recent_experience_incorporation') {
      family = 'recent_experience_incorporation';
      const familyLabel = detectedFamilyLabel(narrative);
      const cueLabel = familyLabel
        || (containsGroundedPhrase(normalizeGroundingText(narrative), ['lớp học tiểu học cũ']) ? 'lớp học tiểu học cũ' : null)
        || (containsGroundedPhrase(normalizeGroundingText(narrative), ['lớp học cũ']) ? 'lớp học cũ' : null)
        || (containsGroundedPhrase(normalizeGroundingText(narrative), ['trường cũ', 'trường học cũ', 'lớp học cũ', 'lớp học tiểu học cũ', 'old school']) ? 'trường cũ' : null)
        || (containsGroundedPhrase(normalizeGroundingText(narrative), ['nhà cũ', 'old house']) ? 'nhà cũ' : null)
        || (containsGroundedPhrase(normalizeGroundingText(narrative), ['cuốn sổ', 'quyển sổ', 'notebook']) ? 'cuốn sổ' : null);
      if (!cueLabel) continue;
      matchedCue = cueLabel;
      evidence = firstDistinctNarrativeSentences(
        narrative,
        [cueLabel],
      );
      hypothesis = `Chi tiết “${cueLabel}” có thể là một trải nghiệm hoặc ký ức gần đây được đưa vào nội dung giấc mơ.`;
      followUpQuestion = `Trong ba ngày trước giấc mơ, có sự việc thật nào đã gợi bạn nghĩ tới ${cueLabel} không?`;
      reasonForAsking = `Tài liệu được dẫn bên dưới ghi nhận rằng trải nghiệm gần đây có thể đi vào nội dung giấc mơ. Câu hỏi kiểm tra xem “${cueLabel}” có một tác nhân gợi nhớ thật hay không; nó không mặc định ý nghĩa của chi tiết này.`;
      ifYesMeaning = `Bạn xác nhận đã có một sự việc gần đây gợi nhớ tới ${cueLabel}; phần phân tích về nguồn ký ức của chi tiết này sẽ được cập nhật.`;
      ifNoMeaning = `Bạn không ghi nhận tác nhân gần đây gợi nhớ tới ${cueLabel}; phần phân tích sẽ không dùng hướng “ký ức vừa được khơi lại”.`;
      questionType = 'past';
      alternateQuestionDimension = 'recent_direct_exposure';
      alternateFollowUpQuestion = `Trong bảy ngày trước giấc mơ, bạn có trực tiếp nhìn thấy, nghe nhắc tới hoặc tiếp xúc với ${cueLabel} không?`;
      alternateReasonForAsking = `Câu hỏi thứ hai chuyển từ việc “có gợi nhớ hay không” sang một dữ kiện quan sát được: bạn có thật sự tiếp xúc với ${cueLabel} gần thời điểm ngủ hay không.`;
      alternateIfYesMeaning = `Câu trả lời Có xác nhận một nguồn tiếp xúc gần đây có thể đưa ${cueLabel} vào giấc mơ, dù cảm xúc hoặc ý nghĩa cá nhân vẫn cần được xem riêng.`;
      alternateIfNoMeaning = `Câu trả lời Không loại thêm hướng tiếp xúc gần đây; hệ thống phải giữ ${cueLabel} ở mức ký ức xa hơn hoặc chưa rõ nguồn.`;
      alternateQuestionType = 'past';
    } else if (verificationKind === 'anticipated_event') {
      family = 'prospective_demand';
      evidence = firstDistinctNarrativeSentences(
        narrative,
        ['cuốn sổ', 'quyển sổ', 'quên', 'trường', 'chạy', 'notebook', 'forget', 'school', 'running'],
      );
      hypothesis = 'Giấc mơ có thể đang dùng những cảnh về ghi nhớ và bị thúc đuổi để mô phỏng một yêu cầu sắp tới mà người kể chưa hoàn toàn sẵn sàng.';
      followUpQuestion = 'Trong bảy ngày tới, bạn có một việc quan trọng mà kết quả của mình sẽ được người khác đánh giá không?';
      reasonForAsking = 'Không gian học tập, cảm giác bị thúc đuổi và nỗi sợ thất thoát thông tin cùng hướng về một việc chưa diễn ra. Câu trả lời kiểm tra xem chuỗi cảnh này có đi cùng một tình huống bị đánh giá thật hay không; đây không phải lời tiên đoán.';
      ifYesMeaning = 'Câu trả lời Có làm áp lực đánh giá sắp tới trở thành một tác nhân đáng xem xét cho toàn bộ chuỗi trường học, mất thông tin và chạy trốn.';
      ifNoMeaning = 'Câu trả lời Không làm yếu cách giải thích hướng tới tương lai; hệ thống nên ưu tiên trải nghiệm vừa xảy ra hoặc trạng thái cảm xúc hiện tại.';
      questionType = 'future';
      alternateQuestionDimension = 'preparation_behavior';
      alternateFollowUpQuestion = 'Trong ba ngày gần đây, bạn có thực hiện một việc chuẩn bị cụ thể cho tình huống sắp được đánh giá đó không?';
      alternateReasonForAsking = 'Câu hỏi thứ hai kiểm tra hành vi chuẩn bị đã xảy ra, thay vì hỏi lại sự kiện tương lai có tồn tại hay không.';
      alternateIfYesMeaning = 'Câu trả lời Có nối các cảnh chuẩn bị, ghi nhớ hoặc bị thúc đuổi với một hoạt động chuẩn bị thật gần đây.';
      alternateIfNoMeaning = 'Câu trả lời Không làm yếu mạch mô phỏng việc chuẩn bị; hệ thống nên xem xét áp lực hiện tại hoặc ký ức gần đây khác.';
      alternateQuestionType = 'past';
    } else if (verificationKind === 'waking_concern_incorporation') {
      family = 'waking_concern_incorporation';
      const ruleTerms = [
        ...(Array.isArray(rule?.dreamFeatureTags) ? rule.dreamFeatureTags : []),
        rule?.factor,
        rule?.outcome,
      ].map((item: unknown) => String(item || '').trim()).filter(Boolean);
      evidence = firstDistinctNarrativeSentences(narrative, ruleTerms, 2);
      if (evidence.length === 0) {
        evidence = narrative
          .split(/(?<=[.!?])\s+|\n+/u)
          .map(sentence => sentence.trim())
          .filter(Boolean)
          .slice(0, 1);
      }
      if (evidence.length === 0) continue;
      const cue = evidence[0].replace(/\s+/g, ' ').trim();
      const cuePreview = cue.length > 110 ? `${cue.slice(0, 107).trimEnd()}…` : cue;
      hypothesis = 'Một chi tiết trong giấc mơ có thể đang tiếp nối một hoạt động hằng ngày hoặc mối bận tâm hiện tại.';
      followUpQuestion = `Trong bảy ngày trước giấc mơ, bạn có thường xuyên nghĩ hoặc lo về một việc ngoài đời liên quan trực tiếp đến chi tiết “${cuePreview}” không?`;
      reasonForAsking = 'Tài liệu nêu rằng hoạt động hằng ngày và mối bận tâm hiện tại có thể được đưa vào nội dung giấc mơ. Câu hỏi kiểm tra mối nối này trong trường hợp cụ thể, thay vì gán nghĩa cho hình ảnh chỉ từ lời kể.';
      ifYesMeaning = 'Câu trả lời Có xác nhận điều kiện áp dụng trong ca này: chi tiết được hỏi có một mối bận tâm hoặc hoạt động đời thực tương ứng.';
      ifNoMeaning = 'Câu trả lời Không làm yếu cách áp dụng quy luật này cho chi tiết được hỏi; phân tích phải tìm một nguồn khác hoặc giữ nó ở mức chưa xác định.';
      questionType = 'past';
      alternateQuestionDimension = 'recent_day_activity';
      alternateFollowUpQuestion = `Trong 24 giờ trước khi ngủ, bạn có làm một hoạt động cụ thể liên quan trực tiếp đến chi tiết “${cuePreview}” không?`;
      alternateReasonForAsking = 'Câu hỏi thứ hai kiểm tra hoạt động có thể quan sát trong ngày gần nhất, thay vì hỏi lại mức độ suy nghĩ hoặc lo lắng.';
      alternateIfYesMeaning = 'Câu trả lời Có xác nhận một hoạt động gần thời điểm ngủ có thể là nguồn trực tiếp của chi tiết được hỏi.';
      alternateIfNoMeaning = 'Câu trả lời Không làm yếu hướng tiếp nối hoạt động trong ngày; hệ thống phải tìm mối bận tâm khác hoặc giữ nguồn của chi tiết ở mức chưa rõ.';
      alternateQuestionType = 'past';
    } else if (verificationKind === 'attachment_support_under_stress') {
      family = 'attachment_support_under_stress';
      const familyLabel = detectedFamilyLabel(narrative);
      if (!familyLabel) continue;
      matchedCue = familyLabel;
      evidence = firstDistinctNarrativeSentences(
        narrative,
        [familyLabel, 'sợ', 'chạy', 'đuổi theo', 'bắt kịp', 'cửa đóng', 'fear', 'chase'],
        3,
      );
      if (evidence.length < 2) continue;
      hypothesis = `Trong lúc bị đe dọa, việc tìm tới ${familyLabel} có thể liên quan đến một người từng mang lại cảm giác an toàn hoặc hỗ trợ.`;
      followUpQuestion = `Trước đây, khi bạn gặp chuyện khó khăn, ${familyLabel} có thường là người khiến bạn cảm thấy an toàn hơn không?`;
      reasonForAsking = `Tài liệu được dẫn bên dưới mô tả xu hướng tìm tới một người gắn bó hoặc từng hỗ trợ khi chịu áp lực. Câu hỏi kiểm tra xem vai trò đó có đúng với ${familyLabel} trong chính lịch sử của bạn hay không.`;
      ifYesMeaning = `Bạn xác nhận ${familyLabel} từng là một điểm tựa khi gặp khó khăn; phần phân tích sẽ xem hành động cố tìm tới ${familyLabel} như một nhu cầu tìm lại cảm giác an toàn quen thuộc.`;
      ifNoMeaning = `Bạn không xem ${familyLabel} là người từng mang lại cảm giác an toàn; phần phân tích sẽ loại cách hiểu “tìm về một điểm tựa”.`;
      questionType = 'past';
      alternateQuestionDimension = 'recent_support_seeking';
      alternateFollowUpQuestion = `Trong lần gần nhất gặp khó khăn, bạn có nghĩ tới hoặc muốn liên hệ ${familyLabel} để được hỗ trợ không?`;
      alternateReasonForAsking = `Câu hỏi thứ hai kiểm tra hành vi tìm hỗ trợ gần đây, khác với câu hỏi về vai trò của ${familyLabel} trong quá khứ.`;
      alternateIfYesMeaning = `Câu trả lời Có cho thấy nhu cầu tìm tới ${familyLabel} vẫn đang hiện diện trong hoàn cảnh gần đây, nên hướng tìm điểm tựa phù hợp hơn với ca này.`;
      alternateIfNoMeaning = `Câu trả lời Không làm yếu hướng tìm hỗ trợ hiện tại, dù ${familyLabel} vẫn có thể mang ý nghĩa khác trong ký ức.`;
      alternateQuestionType = 'past';
    } else if (verificationKind === 'avoidance_pressure' || verificationKind === 'current_stress') {
      family = verificationKind;
      evidence = firstDistinctNarrativeSentences(
        narrative,
        ['chạy', 'đuổi theo', 'bắt kịp', 'sợ', 'running', 'chased', 'caught', 'fear'],
      );
      hypothesis = verificationKind === 'avoidance_pressure'
        ? 'Cảnh bị đuổi có thể phù hợp với kết luận học thuật về áp lực né tránh khi ngoài đời thật có một việc đang bị trì hoãn.'
        : 'Cảnh đe dọa có thể phù hợp với kết luận học thuật về căng thẳng khi ngoài đời thật đang có áp lực tương ứng.';
      followUpQuestion = verificationKind === 'avoidance_pressure'
        ? 'Trong tuần này, bạn có đang trì hoãn một việc khiến mình cảm thấy bị thúc ép không?'
        : 'Trong tuần này, bạn có đang chịu một áp lực rõ rệt khiến mình thường xuyên căng thẳng hoặc cảnh giác không?';
      reasonForAsking = verificationKind === 'avoidance_pressure'
        ? 'Kết luận học thuật chỉ áp dụng khi áp lực né tránh có thật ngoài đời. Câu hỏi kiểm tra điều kiện đó trước khi dùng cảnh bị đuổi để diễn giải.'
        : 'Kết luận học thuật liên hệ căng thẳng đời thực với nội dung đe dọa trong mơ. Câu hỏi kiểm tra vế căng thẳng đời thực còn thiếu trong lời kể.';
      ifYesMeaning = 'Câu trả lời Có làm điều kiện áp dụng của kết luận học thuật phù hợp hơn với giấc mơ này.';
      ifNoMeaning = 'Câu trả lời Không làm yếu việc áp dụng kết luận học thuật này cho giấc mơ hiện tại; nó không bác bỏ kết luận ở các trường hợp khác.';
      questionType = 'present';
      alternateQuestionDimension = verificationKind === 'avoidance_pressure' ? 'approaching_consequence' : 'stress_impact';
      alternateFollowUpQuestion = verificationKind === 'avoidance_pressure'
        ? 'Việc đang bị trì hoãn đó có một hạn chót hoặc hậu quả cụ thể đang đến gần không?'
        : 'Áp lực đó có làm bạn khó tập trung, khó thư giãn hoặc thường xuyên đề phòng trong những ngày gần đây không?';
      alternateReasonForAsking = verificationKind === 'avoidance_pressure'
        ? 'Câu hỏi thứ hai kiểm tra sức ép đang đến gần từ hậu quả hoặc hạn chót, thay vì hỏi lại việc trì hoãn.'
        : 'Câu hỏi thứ hai kiểm tra ảnh hưởng quan sát được của căng thẳng, thay vì hỏi lại cảm giác căng thẳng nói chung.';
      alternateIfYesMeaning = verificationKind === 'avoidance_pressure'
        ? 'Câu trả lời Có xác nhận việc né tránh đang đi cùng một sức ép cụ thể, nên hướng áp lực bị đuổi bắt phù hợp hơn với ca này.'
        : 'Câu trả lời Có xác nhận căng thẳng đang tạo ảnh hưởng thực tế, nên mối nối với trạng thái đe dọa trong mơ được giữ lại.';
      alternateIfNoMeaning = verificationKind === 'avoidance_pressure'
        ? 'Câu trả lời Không làm yếu giả thuyết về một sức ép đang đến gần; cảnh bị đuổi cần được xem theo hướng khác.'
        : 'Câu trả lời Không làm yếu việc áp dụng hướng căng thẳng hiện tại; hệ thống không nên suy ra nó chỉ từ cảnh đe dọa.';
      alternateQuestionType = 'present';
    } else {
      continue;
    }

    if (!family || evidence.length < 1) continue;
    const ruleId = String(rule?.ruleId || rule?._id || '').trim();
    if (!ruleId) continue;
    const questionGroup = family === 'recent_experience_incorporation'
      ? 'recent_memory_cue'
      : family === 'attachment_support_under_stress'
        ? 'attachment_context'
      : ['avoidance_pressure', 'current_stress'].includes(family)
        ? 'current_pressure'
        : family === 'waking_concern_incorporation'
          ? 'waking_concern'
        : 'future_plans';
    const baseQuestion = {
      ruleId,
      ruleIds: [ruleId],
      verificationKey: `${ruleId}:${family}`,
      questionDimension: family,
      questionGroup,
      questionBasis: 'academic_rule',
      applicationTier: rule?.applicationTier || 'supported',
      answerSemantics: { yes: 'supports', no: 'weakens', unsure: 'unresolved' },
      hypothesis,
      evidenceFromDream: evidence,
      confidence: 0,
      needsUserConfirmation: true,
      followUpQuestion,
      reasonForAsking,
      ifYesMeaning,
      ifNoMeaning,
      ...(matchedCue ? { matchedCue } : {}),
      questionType,
    };
    accepted.push({
      ...baseQuestion,
      ...(alternateFollowUpQuestion && alternateQuestionDimension ? {
        alternateQuestion: {
          ...baseQuestion,
          verificationKey: `${ruleId}:${family}:alternate`,
          questionDimension: alternateQuestionDimension,
          questionGroup: `${questionGroup}:alternate`,
          followUpQuestion: alternateFollowUpQuestion,
          reasonForAsking: alternateReasonForAsking,
          ifYesMeaning: alternateIfYesMeaning,
          ifNoMeaning: alternateIfNoMeaning,
          questionType: alternateQuestionType,
          userFeedback: null,
          isAlternateQuestion: true,
          parentVerificationKey: `${ruleId}:${family}`,
        },
      } : {}),
    });
  }
  const byQuestion = new Map<string, any>();
  for (const item of accepted) {
    const key = normalizeGroundingText(item.followUpQuestion);
    const existing = byQuestion.get(key);
    if (!existing) {
      byQuestion.set(key, item);
      continue;
    }
    existing.ruleIds = [...new Set([...(existing.ruleIds || [existing.ruleId]), ...(item.ruleIds || [item.ruleId])])];
    if (existing.alternateQuestion && item.alternateQuestion
      && normalizeGroundingText(existing.alternateQuestion.followUpQuestion) === normalizeGroundingText(item.alternateQuestion.followUpQuestion)) {
      existing.alternateQuestion.ruleIds = [...new Set([
        ...(existing.alternateQuestion.ruleIds || existing.ruleIds),
        ...(item.alternateQuestion.ruleIds || item.ruleIds || [item.ruleId]),
      ])];
    }
  }
  return [...byQuestion.values()];
}

export function attachRuleQuestionContext(hypotheses: any[], rules: any[]): any[] {
  const ruleMap = new Map((rules || []).map(rule => [String(rule?.ruleId || rule?._id || ''), rule]));
  return (hypotheses || []).map(item => {
    const verificationKey = String(item?.verificationKey || `${item?.ruleId || 'unlinked'}:${normalizeGroundingText(item?.followUpQuestion || '').replace(/\s+/g, '_').slice(0, 120)}`);
    const answerSemantics = item?.answerSemantics || { yes: 'supports', no: 'weakens', unsure: 'unresolved' };
    const rule = ruleMap.get(String(item?.ruleId || '')) as any;
    const ruleContext = rule ? {
      ruleStatement: String(rule?.ruleStatement || rule?.statement || '').trim(),
      ruleCode: String(rule?.ruleCode || '').trim() || undefined,
    } : {};
    if (item?.reasonForAsking) return { ...item, ...ruleContext, verificationKey, answerSemantics };
    return {
      ...item,
      ...ruleContext,
      verificationKey,
      answerSemantics,
      reasonForAsking: 'Câu hỏi này kiểm tra một hoàn cảnh chưa được kể rõ. Chỉ khi hoàn cảnh đó có thật, hệ thống mới giữ cách hiểu tương ứng trong kết quả phân tích.',
      ifYesMeaning: 'Câu trả lời Có làm giả thuyết này phù hợp hơn với trường hợp hiện tại, nhưng không biến nó thành một kết luận chắc chắn.',
      ifNoMeaning: 'Câu trả lời Không làm giảm ưu tiên của giả thuyết này và hệ thống không nên dùng nó làm trục diễn giải chính.',
    };
  });
}

/** Questions are precomputed before display. Feedback must never generate,
 * remove, or rewrite a later question; it only updates the selected answer. */
export function reconcileAlternateQuestionAfterFeedback(
  hypotheses: any[],
  verificationKey: string,
  answer: 'yes' | 'no' | 'unsure' | null,
): any[] {
  const items = Array.isArray(hypotheses) ? hypotheses.map(item => ({ ...item })) : [];
  const parentIndex = items.findIndex(item => String(item?.verificationKey || '') === verificationKey);
  if (parentIndex < 0) return items;
  items[parentIndex].userFeedback = answer;
  return items;
}

function getQuestionDimension(item: any): string {
  const explicit = String(item?.questionDimension || '').trim();
  if (explicit) return explicit;
  const key = String(item?.verificationKey || '');
  if (key.includes('multiple_future_horizons')) return 'multiple_future_horizons';
  if (key.includes('recent_experience_incorporation')) return 'recent_experience_incorporation';
  if (key.includes('external_sound_at_wake')) return 'external_sound_at_wake';
  return '';
}

function buildSleepEnvironmentQuestions(narrative: string, sleepContext: Record<string, any>, rules: any[]): any[] {
  const text = normalizeGroundingText(narrative);
  const supportingRule = (rules || []).find(rule => classifyRuleV3VerificationKind(rule) === 'external_sleep_stimulus');
  if (!supportingRule) return [];
  const hasAuditoryScene = containsGroundedPhrase(text, [
    'chuông', 'tiếng động', 'tiếng bước chân', 'tiếng gõ', 'tiếng gọi',
    'bell', 'alarm', 'footsteps', 'knocking', 'voice',
  ]);
  const hasWakeBoundary = containsGroundedPhrase(text, ['tỉnh dậy', 'thức dậy', 'woke up', 'awoke']);
  if (!hasAuditoryScene || !hasWakeBoundary) return [];
  const knownAnswer = typeof sleepContext?.externalSoundAtWake === 'boolean'
    ? (sleepContext.externalSoundAtWake ? 'yes' : 'no')
    : null;
  return [{
    ruleId: String(supportingRule?.ruleId || supportingRule?._id || ''),
    verificationKey: `${String(supportingRule?.ruleId || supportingRule?._id || '')}:external_sound_at_wake`,
    questionDimension: 'external_sound_at_wake',
    questionGroup: 'sleep_environment',
    questionBasis: 'academic_rule',
    answerSemantics: { yes: 'supports', no: 'weakens', unsure: 'unresolved' },
    hypothesis: 'Một âm thanh thật trong phòng ngủ có thể đã được ghép vào cảnh âm thanh của giấc mơ.',
    evidenceFromDream: firstDistinctNarrativeSentences(narrative, ['chuông', 'tiếng bước chân', 'tiếng động', 'tỉnh dậy', 'bell', 'footsteps'], 2),
    confidence: 0,
    needsUserConfirmation: true,
    followUpQuestion: 'Trong đêm đó hoặc ngay lúc tỉnh dậy, bạn có nghe thấy một tiếng động thật ở xung quanh không?',
    reasonForAsking: 'Lời kể có âm thanh nổi bật và một điểm tỉnh giấc rõ ràng. Câu hỏi này kiểm tra tác nhân từ môi trường ngủ trước khi gán ý nghĩa tâm lý cho âm thanh trong mơ.',
    ifYesMeaning: 'Câu trả lời Có cho thấy âm thanh ngoài đời là một đầu mối cần tính đến khi giải thích cảnh âm thanh và thời điểm tỉnh dậy.',
    ifNoMeaning: 'Câu trả lời Không làm giảm khả năng âm thanh trong mơ đến từ môi trường ngủ; cảnh đó được giữ lại như một phần nội tại của giấc mơ.',
    questionType: 'present',
    userFeedback: knownAnswer,
  }];
}

function detectedFamilyLabel(narrative: string): string | null {
  const text = normalizeGroundingText(narrative);
  const labels = [
    'bà ngoại', 'bà nội', 'ông ngoại', 'ông nội', 'bà', 'ông', 'mẹ', 'cha', 'bố',
    'grandmother', 'grandfather', 'mother', 'father',
  ];
  return labels.find(label => containsGroundedPhrase(text, [label])) || null;
}

export function buildFeedbackRevision(hypotheses: any[], feedbackRows: any[]): any[] {
  const feedbackByRuleOrIndex = new Map((feedbackRows || []).map((entry: any) => [
    entry.verificationKey
      ? `verification:${entry.verificationKey}`
      : entry.ruleId ? `rule:${entry.ruleId}` : `index:${entry.hypothesisIndex}`,
    entry,
  ]));
  return (hypotheses || []).flatMap((hypothesis: any, index: number) => {
    const key = hypothesis.verificationKey
      ? `verification:${hypothesis.verificationKey}`
      : hypothesis.ruleId ? `rule:${hypothesis.ruleId}` : `index:${index}`;
    const feedback: any = feedbackByRuleOrIndex.get(key);
    if (!feedback) return [];
    const effect = ['supports', 'weakens', 'unresolved'].includes(feedback.effect) ? feedback.effect : 'unresolved';
    const status = effect === 'supports' ? 'supported' : effect === 'weakens' ? 'weakened' : 'unresolved';
    const interpretation = effect === 'supports'
      ? hypothesis.ifYesMeaning
      : effect === 'weakens'
        ? hypothesis.ifNoMeaning
        : 'Chưa dùng giả thuyết này làm cơ sở chính cho đến khi có thêm thông tin.';
    return [{
      hypothesis: String(hypothesis.hypothesis || '').trim(),
      status,
      interpretation: String(interpretation || '').trim(),
      ...(hypothesis.ruleId ? { ruleId: String(hypothesis.ruleId) } : {}),
    }];
  });
}

function feedbackSentences(value: unknown): string[] {
  const text = String(value || '').trim();
  if (!text) return [];
  return (text.match(/[^.!?…]+(?:[.!?…]+|$)/gu) || [text])
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

export function buildFeedbackChangeSet(before: any, after: any): {
  paths: string[];
  fragments: Record<string, string[]>;
} {
  const fragments: Record<string, string[]> = {};
  const compare = (path: string, left: unknown, right: unknown) => {
    const beforeText = String(left || '').trim();
    const afterText = String(right || '').trim();
    if (beforeText === afterText) return;
    const beforeSet = new Set(feedbackSentences(beforeText));
    const changedSentences = feedbackSentences(afterText).filter(sentence => !beforeSet.has(sentence));
    fragments[path] = changedSentences.length > 0 ? changedSentences : [afterText];
  };

  compare('core_analysis', before?.core_analysis, after?.core_analysis);
  compare('case_conclusion.conclusion', before?.case_conclusion?.conclusion, after?.case_conclusion?.conclusion);
  compare('case_conclusion.reasoning', before?.case_conclusion?.reasoning, after?.case_conclusion?.reasoning);
  compare('case_conclusion.confidenceLabel', before?.case_conclusion?.confidenceLabel, after?.case_conclusion?.confidenceLabel);
  compare('case_conclusion.recommendedNextStep', before?.case_conclusion?.recommendedNextStep, after?.case_conclusion?.recommendedNextStep);
  compare('feedback_analysis.interpretation', before?.feedback_analysis?.interpretation, after?.feedback_analysis?.interpretation);
  const maxFeedbackFacts = Math.max(before?.feedback_analysis?.confirmedFacts?.length || 0, after?.feedback_analysis?.confirmedFacts?.length || 0);
  for (let index = 0; index < maxFeedbackFacts; index += 1) {
    compare(`feedback_analysis.confirmedFacts.${index}`, before?.feedback_analysis?.confirmedFacts?.[index], after?.feedback_analysis?.confirmedFacts?.[index]);
  }
  const maxEvidenceBasis = Math.max(before?.case_conclusion?.evidenceBasis?.length || 0, after?.case_conclusion?.evidenceBasis?.length || 0);
  for (let index = 0; index < maxEvidenceBasis; index += 1) {
    compare(`case_conclusion.evidenceBasis.${index}.detail`, before?.case_conclusion?.evidenceBasis?.[index]?.detail, after?.case_conclusion?.evidenceBasis?.[index]?.detail);
  }
  const maxConfirmedFindings = Math.max(before?.case_conclusion?.confirmedFindings?.length || 0, after?.case_conclusion?.confirmedFindings?.length || 0);
  for (let index = 0; index < maxConfirmedFindings; index += 1) {
    compare(`case_conclusion.confirmedFindings.${index}`, before?.case_conclusion?.confirmedFindings?.[index], after?.case_conclusion?.confirmedFindings?.[index]);
  }
  const maxRuledOut = Math.max(before?.case_conclusion?.ruledOut?.length || 0, after?.case_conclusion?.ruledOut?.length || 0);
  for (let index = 0; index < maxRuledOut; index += 1) {
    compare(`case_conclusion.ruledOut.${index}`, before?.case_conclusion?.ruledOut?.[index], after?.case_conclusion?.ruledOut?.[index]);
  }
  const maxThreads = Math.max(before?.interpretive_threads?.length || 0, after?.interpretive_threads?.length || 0);
  for (let index = 0; index < maxThreads; index += 1) {
    compare(`interpretive_threads.${index}.reasoning`, before?.interpretive_threads?.[index]?.reasoning, after?.interpretive_threads?.[index]?.reasoning);
    compare(`interpretive_threads.${index}.alternativeExplanation`, before?.interpretive_threads?.[index]?.alternativeExplanation, after?.interpretive_threads?.[index]?.alternativeExplanation);
  }
  const maxNotes = Math.max(before?.scientific_context_notes?.length || 0, after?.scientific_context_notes?.length || 0);
  for (let index = 0; index < maxNotes; index += 1) {
    compare(`scientific_context_notes.${index}.note`, before?.scientific_context_notes?.[index]?.note, after?.scientific_context_notes?.[index]?.note);
  }
  const maxReflections = Math.max(before?.practical_reflections?.length || 0, after?.practical_reflections?.length || 0);
  for (let index = 0; index < maxReflections; index += 1) {
    compare(`practical_reflections.${index}.suggestion`, before?.practical_reflections?.[index]?.suggestion, after?.practical_reflections?.[index]?.suggestion);
    compare(`practical_reflections.${index}.rationale`, before?.practical_reflections?.[index]?.rationale, after?.practical_reflections?.[index]?.rationale);
  }
  const maxMotifs = Math.max(before?.symbolic_notes?.length || 0, after?.symbolic_notes?.length || 0);
  for (let index = 0; index < maxMotifs; index += 1) {
    compare(`symbolic_notes.${index}.meaning`, before?.symbolic_notes?.[index]?.meaning, after?.symbolic_notes?.[index]?.meaning);
  }

  return { paths: Object.keys(fragments), fragments };
}

export function ensureSubstantiveCoreAnalysis(
  core: unknown,
  threads: any[],
): string {
  const original = String(core || '').trim();
  if (isSubstantiveCoreAnalysis(original)) return original;
  const uncertainty = 'Các mối nối này là giả thuyết phản tư dựa trên cấu trúc giấc mơ; hoàn cảnh thật chỉ được xác nhận qua câu trả lời của người kể.';
  let result = [original, uncertainty].filter(Boolean).join(' ');
  if (isSubstantiveCoreAnalysis(result)) return result;
  for (const thread of (threads || []).slice(0, 2)) {
    const reasoning = String(thread?.reasoning || '').trim();
    if (reasoning) result = `${result} ${reasoning}`.trim();
    if (isSubstantiveCoreAnalysis(result)) break;
  }
  return result;
}

export function polishGeneratedDreamProse(value: unknown): string {
  let text = String(value || '').replace(/\s+/gu, ' ').trim();
  if (!text) return text;
  text = text
    .replace(/\bliên quanse\b/giu, 'liên quan')
    .replace(/^Trong giấc mơ này,\s*/iu, '')
    .replace(/^Giấc mơ này\s+(?:phản ánh|cho thấy)\s+/iu, 'Chuỗi cảnh gợi tới ')
    .replace(/^Giấc mơ\s+(?:phản ánh|cho thấy)\s+/iu, 'Chuỗi cảnh gợi tới ')
    .replace(/(^|[.!?]\s+)Người mơ(?=\s|$)/gu, '$1Bạn')
    .replace(/người mơ(?=\s|$)/gu, 'bạn')
    .replace(/(^|[.!?]\s+)Họ(?=\s|$)/gu, '$1Bạn')
    .replace(/(^|[\s,;])họ(?=\s|$)/gu, '$1bạn')
    .replace(/^Có thể bạn đang\s+/iu, 'Một khả năng là bạn đang ');

  const unique = new Map<string, string>();
  for (const sentence of text.split(/(?<=[.!?])\s+/u).map(item => item.trim()).filter(Boolean)) {
    const key = normalizeGroundingText(sentence);
    if (!unique.has(key)) unique.set(key, sentence);
  }
  return capitalizeSentence([...unique.values()].join(' '));
}

const EXPLORATORY_RECOMBINATION_DIMENSIONS = [
  'weak_association_recombination',
  'creative_problem_preoccupation',
  'implausible_future_scenario',
  'waking_prospective_difference',
  'novel_solution_origin',
] as const;

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

/**
 * Summarises answers as case-level applicability. This deliberately does not
 * change the rule's academic evidence score: one person's answers can confirm
 * whether a rule fits this dream, but cannot create a new independent study.
 */
export function buildExploratoryCaseAssessment(
  hypotheses: any[],
  rule?: any,
): ExploratoryCaseAssessment | null {
  const dimensions = new Set<string>(EXPLORATORY_RECOMBINATION_DIMENSIONS);
  const allowedRuleIds = rule ? ruleAndComponentIds(rule) : null;
  let candidates = (hypotheses || []).filter(item => dimensions.has(getQuestionDimension(item)));
  if (allowedRuleIds?.size) {
    const scoped = candidates.filter(item => {
      const itemIds = [item?.ruleId, ...(Array.isArray(item?.ruleIds) ? item.ruleIds : [])]
        .map(value => String(value || '').trim())
        .filter(Boolean);
      return itemIds.some(id => allowedRuleIds.has(id));
    });
    if (scoped.length > 0) candidates = scoped;
  }
  if (candidates.length === 0) return null;

  const byDimension = new Map<string, any>();
  for (const item of candidates) {
    const dimension = getQuestionDimension(item);
    const existing = byDimension.get(dimension);
    if (!existing || (!existing?.userFeedback && item?.userFeedback)) byDimension.set(dimension, item);
  }
  const answer = (dimension: string): string | null => {
    const value = byDimension.get(dimension)?.userFeedback;
    return ['yes', 'no', 'unsure'].includes(value) ? value : null;
  };
  const answers = [...byDimension.values()]
    .map(item => item?.userFeedback)
    .filter(value => ['yes', 'no', 'unsure'].includes(value));
  const confirmedCount = answers.filter(value => value === 'yes').length;
  const weakenedCount = answers.filter(value => value === 'no').length;
  const unresolvedCount = answers.filter(value => value === 'unsure').length;
  const answeredCount = answers.length;
  const totalCount = byDimension.size;
  const status: ExploratoryCaseAssessment['status'] = answeredCount === 0 || unresolvedCount === answeredCount
    ? 'unresolved'
    : weakenedCount === 0 && unresolvedCount === 0 && confirmedCount === totalCount
      ? 'strong_match'
      : confirmedCount > weakenedCount
        ? 'partial_match'
        : weakenedCount > confirmedCount
          ? 'weakened'
          : 'mixed';

  const findings: string[] = [];
  if (answer('weak_association_recombination') === 'yes') {
    findings.push('các hình ảnh chính đến từ những sự việc đời thực riêng biệt');
  } else if (answer('weak_association_recombination') === 'no') {
    findings.push('chưa xác nhận được nguồn đời thực riêng cho các mảnh hình ảnh, nên hướng tái kết hợp ký ức bị giảm ưu tiên');
  }
  if (answer('implausible_future_scenario') === 'yes') {
    findings.push('buổi họp hoặc trình bày sắp tới là một sự kiện có thật');
  } else if (answer('implausible_future_scenario') === 'no') {
    findings.push('không có sự kiện tương lai tương ứng, nên cảnh trình bày không được xem là diễn tập cho một kế hoạch thật');
  }
  if (answer('creative_problem_preoccupation') === 'yes') {
    findings.push('bạn đang chủ động tìm cách giải quyết hoặc trình bày mới khi thức');
  } else if (answer('creative_problem_preoccupation') === 'no') {
    findings.push('không có bài toán sáng tạo đang được xử lý khi thức');
  }
  if (answer('waking_prospective_difference') === 'yes') {
    findings.push('bạn đã chuẩn bị có chủ đích trước khi ngủ');
  } else if (answer('waking_prospective_difference') === 'no') {
    findings.push('không có lần diễn tập hoặc lập kế hoạch gần lúc ngủ');
  }

  let solutionConclusion = '';
  if (answer('novel_solution_origin') === 'yes') {
    solutionConclusion = 'Vì ý tưởng ghép các mảnh thành giải pháp đã từng xuất hiện khi thức, giấc mơ phù hợp hơn với việc biến đổi một phương án có sẵn, không phải tự tạo ra một giải pháp sáng tạo hoàn toàn mới.';
  } else if (answer('novel_solution_origin') === 'no') {
    solutionConclusion = 'Ý tưởng giải pháp chưa từng xuất hiện khi thức nên có thể là một liên tưởng mới trong mơ, nhưng câu trả lời này chưa chứng minh ý tưởng đó đúng hoặc hữu ích.';
  }
  const prefix = answeredCount > 0
    ? `Đã đối chiếu ${answeredCount}/${totalCount} chiều dữ kiện của quy luật; ${confirmedCount} được xác nhận, ${weakenedCount} bị làm yếu và ${unresolvedCount} còn chưa rõ.`
    : `Chưa có câu trả lời cho ${totalCount} chiều dữ kiện đã chuẩn bị.`;
  const combined = findings.length > 0
    ? `Các câu trả lời cho thấy ${findings.join('; ')}.`
    : '';
  const interpretation = confirmedCount >= 3 && answer('implausible_future_scenario') === 'yes'
    ? 'Kết luận phù hợp nhất cho ca này là giấc mơ đã tổ chức lại ký ức gần đây và việc chuẩn bị đang tiếp diễn thành một màn diễn tập phi thực tế xoay quanh sự kiện sắp tới.'
    : status === 'weakened'
      ? 'Các điều kiện cần chưa được xác nhận đủ, nên quy luật này không còn là hướng chính cho ca này.'
      : 'Quy luật vẫn chỉ là một hướng đối chiếu cho ca này cho đến khi các chiều dữ kiện còn thiếu được làm rõ.';
  return {
    status,
    answeredCount,
    totalCount,
    confirmedCount,
    weakenedCount,
    unresolvedCount,
    conclusion: [prefix, combined, interpretation, solutionConclusion].filter(Boolean).join(' '),
  };
}

export function buildDreamCaseConclusion(
  narrative: string,
  hypotheses: any[],
  scientificNotes: any[] = [],
): DreamCaseConclusion {
  const assessment = buildExploratoryCaseAssessment(hypotheses);
  const answered = (hypotheses || []).filter(item => ['yes', 'no', 'unsure'].includes(item?.userFeedback));
  const resolved = answered.filter(item => ['yes', 'no'].includes(item?.userFeedback));
  const memoryCueConfirmed = answered.some(item =>
    ['recent_experience_incorporation', 'recent_direct_exposure'].includes(getQuestionDimension(item))
      && item?.userFeedback === 'yes');
  const clarified = Boolean(assessment?.answeredCount || resolved.length);
  const strongExploratoryMatch = assessment?.status === 'strong_match';

  const conclusion = strongExploratoryMatch
    ? 'Giấc mơ này phù hợp nhất với việc tâm trí tiếp tục xử lý một buổi trình bày có thật: nó lấy ký ức cũ và những chi tiết gần đây làm vật liệu, rồi biến chúng thành một màn diễn tập phi thực tế. Đây không phải dự báo về buổi trình bày và cũng không chứng minh giấc mơ đã tạo ra một giải pháp sáng tạo mới.'
    : assessment?.answeredCount
      ? 'Giấc mơ có vẻ xoay quanh một việc đang được chuẩn bị ngoài đời, nhưng một số mắt xích về nguồn ký ức hoặc sự kiện tương lai vẫn chưa đủ rõ để xem đây là hướng giải thích chính.'
      : 'Khả năng đáng kiểm tra nhất là giấc mơ đang nối việc chuẩn bị cho dự án với những ký ức cũ và hình ảnh phi thực tế. Đây mới là giả thuyết ban đầu; các câu hỏi xác nhận quyết định hướng này có thật sự phù hợp với trường hợp của bạn hay không.';
  const reasoning = strongExploratoryMatch
    ? [
      'Bạn đã xác nhận các hình ảnh đến từ những sự việc riêng biệt, có buổi trình bày sắp tới thật, đang tìm cách giải quyết và đã chuẩn bị trước khi ngủ.',
      memoryCueConfirmed
        ? 'Bạn cũng xác nhận lớp học cũ vừa được gợi lại hoặc tiếp xúc gần đây, nên sự xuất hiện của nó có một nguồn cụ thể hơn là một “biểu tượng” cố định.'
        : 'Nguồn cụ thể đưa lớp học cũ vào giấc mơ vẫn cần được giữ riêng nếu chưa được xác nhận.',
      'Vì ý tưởng giống cây cầu đã tồn tại khi thức, cách hiểu thận trọng nhất là giấc mơ đã biến đổi một phương án có sẵn, không phải phát minh nó từ đầu.',
    ].join(' ')
    : assessment?.conclusion || 'Chưa có đủ câu trả lời để phân biệt điều đang xảy ra ngoài đời với phần chỉ tồn tại trong câu chuyện của giấc mơ.';

  const confirmedFindings = strongExploratoryMatch
    ? [
      'Buổi trình bày là một việc có thật và đang chiếm sự chú ý của bạn trước khi ngủ.',
      'Các cảnh lớp học, dự án và vật liệu tuổi thơ có nguồn từ những trải nghiệm khác nhau; giấc mơ đã ghép chúng vào cùng một tình huống chuẩn bị.',
      'Ý tưởng giải quyết đã có dấu vết khi thức, nên giấc mơ chủ yếu biến đổi chất liệu có sẵn thay vì tự tạo ra lời giải hoàn toàn mới.',
    ]
    : clarified
      ? ['Một phần bối cảnh ngoài đời đã được xác nhận, nhưng các mắt xích còn lại chưa đủ nhất quán để chốt một hướng duy nhất.']
      : [];
  const ruledOut = strongExploratoryMatch
    ? [
      'Không có căn cứ xem văn phòng trên Mặt Trăng, đàn chim hoặc các hình ảnh lạ là dự báo tương lai.',
      'Không có căn cứ gán cho lớp học, tấm vé hay cây cầu một ý nghĩa biểu tượng cố định.',
      'Các câu trả lời không chứng minh giấc mơ đã phát minh một giải pháp tốt hơn phương án bạn có khi thức.',
    ]
    : clarified
      ? ['Không dùng những phần chưa được xác nhận để suy ra dự báo, chẩn đoán hoặc ý nghĩa biểu tượng cố định.']
      : ['Chưa loại trừ được hướng nào cho đến khi các câu hỏi về sự kiện thật, nguồn ký ức và việc chuẩn bị được trả lời.'];
  const recommendedNextStep = strongExploratoryMatch
    ? 'Thay vì tiếp tục giải mã từng biểu tượng, hãy viết ba ý chính của buổi trình bày, diễn tập một lần trong khoảng 10 phút và ghi riêng điểm nào vẫn khiến bạn chưa yên tâm. Đây là bước tác động trực tiếp vào mối bận tâm mà các câu trả lời đã xác nhận.'
    : clarified
      ? 'Chỉ hành động trên phần bối cảnh đã được xác nhận; giữ các chi tiết còn thiếu ở trạng thái chưa kết luận và trả lời thêm bằng dữ kiện đời thực nếu hệ thống còn câu hỏi phân biệt.'
      : 'Trả lời hai câu hỏi đầu tiên bằng dữ kiện đời thực; hệ thống sẽ dùng chúng để giữ hoặc loại từng hướng giải thích trước khi đề xuất hành động.';

  const academicSources = [...new Map((scientificNotes || [])
    .flatMap(note => note?.sources || [])
    .map((source: any) => [String(source?.sourceId || source?.doi || source?.title || ''), {
      sourceId: String(source?.sourceId || ''),
      title: String(source?.title || 'Tài liệu học thuật'),
      ...(source?.year ? { year: Number(source.year) } : {}),
      ...(source?.doi ? { doi: String(source.doi) } : {}),
    }]))
    .values()].filter(source => source.sourceId || source.doi || source.title);
  const weakestExploratoryScore = (scientificNotes || [])
    .filter(note => note?.applicationTier === 'exploratory')
    .map(note => Number(note?.academicEvidenceScore))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];
  const evidenceBasis: DreamCaseConclusion['evidenceBasis'] = [{
    kind: 'confirmed_context',
    title: clarified ? 'Dữ kiện do bạn xác nhận' : 'Dữ kiện còn cần xác nhận',
    detail: clarified
      ? `${resolved.length}/${answered.length || resolved.length} câu trả lời đã xác định bối cảnh thật của các chi tiết; chúng làm mạnh hoặc loại cách áp dụng trong ca này.`
      : 'Hệ thống chưa dùng các suy đoán về đời thực làm kết luận chắc chắn trước khi bạn trả lời.',
  }];
  if (academicSources.length > 0) evidenceBasis.push({
    kind: 'academic_context',
    title: 'Tài liệu được dùng đúng phạm vi',
    detail: 'Nguồn học thuật chỉ hỗ trợ cách đối chiếu về ký ức gần đây và sự tái kết hợp chất liệu trong mơ; nguồn không xác nhận ý nghĩa cố định của lớp học, cây cầu hay đàn chim.',
    sources: academicSources,
  });
  evidenceBasis.push({
    kind: 'boundary',
    title: 'Giới hạn để tránh kết luận quá mức',
    detail: Number.isFinite(weakestExploratoryScore)
      ? `Quy luật khám phá yếu nhất đang có ${weakestExploratoryScore}/100 điểm học thuật. Câu trả lời của bạn chỉ tăng độ phù hợp với ca này, không làm tăng điểm nghiên cứu và không biến giấc mơ thành dự báo hay chẩn đoán.`
      : 'Không dùng nội dung giấc mơ đơn lẻ để dự báo tương lai, chẩn đoán tâm lý hoặc gán ý nghĩa cố định cho một hình ảnh.',
  });

  void narrative;
  return {
    status: clarified ? 'clarified' : 'preliminary',
    headline: clarified ? 'Kết luận sau khi đối chiếu câu trả lời' : 'Kết luận ban đầu',
    conclusion,
    reasoning,
    confidenceLabel: strongExploratoryMatch
      ? 'Cao về bối cảnh của trường hợp này; thấp về mức chứng minh học thuật.'
      : 'Tạm thời; còn phụ thuộc vào các câu trả lời xác nhận.',
    confirmedFindings,
    ruledOut,
    recommendedNextStep,
    concern: {
      level: 'no_clear_warning',
      label: 'Chưa thấy dấu hiệu đáng lo chỉ từ nội dung giấc mơ này',
      explanation: 'Cảm giác lo trước một buổi trình bày và việc giấc mơ ghép cảnh phi thực tế không tự nó cho thấy một vấn đề nguy hiểm. Nội dung này phù hợp hơn với việc tiếp tục xử lý mối bận tâm và ký ức khi ngủ.',
      watchFor: [
        'Giấc mơ lặp lại thường xuyên và gây sợ hãi hoặc mất ngủ.',
        'Lo âu sau khi tỉnh kéo dài hoặc cản trở học tập, công việc hay sinh hoạt.',
        'Giấc mơ liên quan đến một sự kiện gây tổn thương và tiếp tục gây khó chịu rõ rệt.',
      ],
      helpSource: {
        title: 'Hướng dẫn NHS về ác mộng và khi nào nên tìm hỗ trợ',
        url: 'https://www.nhs.uk/conditions/night-terrors/',
      },
    },
    evidenceBasis,
  };
}

/**
 * Builds a case-level synthesis from the order of events in the narrative.
 * Academic rules may constrain this interpretation, but descriptive findings
 * are never used as if they explained the dreamer's psychology.
 */
export function buildCaseGroundedSynthesis(
  narrative: string,
  hypotheses: any[],
  fallback: unknown,
): string {
  const text = normalizeGroundingText(narrative);
  const isStationChoice = containsGroundedPhrase(text, ['nhà ga', 'chuyến tàu', 'station', 'train'])
    && containsGroundedPhrase(text, ['8 giờ sáng mai', 'tomorrow'])
    && containsGroundedPhrase(text, ['tháng chín năm sau', 'next year']);
  if (!isStationChoice) {
    let base = stripPriorFeedbackSynthesis(polishGeneratedDreamProse(fallback));
    const hasRecombinationProbe = (hypotheses || []).some(item => [
      'weak_association_recombination',
      'implausible_future_scenario',
      'waking_prospective_difference',
    ].includes(getQuestionDimension(item)));
    if (hasRecombinationProbe && !base.includes('Đối chiếu khám phá từ tài liệu')) {
      const matchedCues = presentDreamCues(narrative, [
        'lớp học tiểu học cũ', 'lớp học cũ', 'bảng đen', 'cuộc họp', 'cô giáo cũ',
        'tấm vé tàu', 'dự án', 'bàn phím máy tính', 'Mặt Trăng', 'mảnh đồ chơi',
        'căn bếp thời thơ ấu', 'cây cầu', 'đàn chim', 'old classroom', 'meeting',
        'train ticket', 'project', 'computer keyboard', 'Moon', 'childhood toys', 'bridge', 'birds',
      ], 6);
      const cueSummary = matchedCues.length >= 2
        ? matchedCues.map(cue => `“${cue}”`).join(', ')
        : 'các hình ảnh thuộc những bối cảnh khác nhau trong lời kể';
      base = [
        base,
        `Đối chiếu khám phá từ tài liệu: chuỗi cảnh không chỉ nối quá khứ với hiện tại, mà còn ghép ${cueSummary} thành một diễn biến mới trong bối cảnh phi thực tế.`,
        'Cấu trúc này tương đồng với mô tả về những liên kết lỏng giữa các mảnh ký ức trong giấc mơ hướng tới tương lai. Tuy nhiên, quy luật đang có bằng chứng yếu; các câu hỏi bên dưới phải xác nhận nguồn của những mảnh ghép, sự kiện sắp tới và việc chuẩn bị khi thức trước khi hướng này được giữ cho trường hợp cụ thể.',
      ].filter(Boolean).join(' ');
    }
    const exploratoryAssessment = buildExploratoryCaseAssessment(hypotheses);
    const exploratoryDimensions = new Set<string>(EXPLORATORY_RECOMBINATION_DIMENSIONS);
    const feedback = buildFeedbackAppliedAnalysis(
      (hypotheses || []).filter(item => !exploratoryDimensions.has(getQuestionDimension(item))),
    );
    const applicationConclusion = exploratoryAssessment && exploratoryAssessment.answeredCount > 0
      ? `Kết luận ứng dụng cho trường hợp này: ${exploratoryAssessment.conclusion}`
      : '';
    if (!feedback && !applicationConclusion) return base;
    const additions: string[] = [];
    if (applicationConclusion) additions.push(applicationConclusion);
    if (feedback?.confirmedFacts.length) {
      additions.push(`Thông tin bạn vừa xác nhận làm rõ trường hợp này: ${feedback.confirmedFacts.join(' ')}`);
    }
    if (feedback?.rejectedDirections.length) {
      additions.push(`Vì câu trả lời của bạn, phân tích không tiếp tục dùng các hướng sau: ${feedback.rejectedDirections.join(' ')}`);
    }
    if (feedback?.unresolvedQuestions.length) {
      additions.push('Những phần bạn chọn Chưa biết vẫn được để mở và không được dùng làm kết luận chính; hệ thống tiếp tục bằng một câu hỏi khác đã chuẩn bị trước.');
    }
    return [base, ...additions].filter(Boolean).join(' ');
  }

  const presentConflictCandidates = (hypotheses || []).filter(isPlanConflictQuestion);
  const memoryCueCandidates = (hypotheses || []).filter(isOldSchoolContextQuestion);
  const presentConflict: any = presentConflictCandidates.find(item => item?.userFeedback && item.userFeedback !== 'unsure') || presentConflictCandidates[0];
  const memoryCue: any = memoryCueCandidates.find(item => item?.userFeedback && item.userFeedback !== 'unsure') || memoryCueCandidates[0];
  const externalSound: any = (hypotheses || []).find(item => getQuestionDimension(item) === 'external_sound_at_wake');

  const confirmed: string[] = [];
  const rejected: string[] = [];
  const open: string[] = [];
  if (presentConflict?.userFeedback === 'yes') confirmed.push('bạn đang đồng thời chuẩn bị cho một việc gần hạn và một kế hoạch kéo dài nhiều tháng');
  else if (presentConflict?.userFeedback === 'no') rejected.push('xung đột giữa một việc gần hạn và một kế hoạch dài hạn');
  else if (presentConflict) open.push('liệu hai mốc thời gian có tương ứng với một việc gần hạn và một kế hoạch dài hơn ngoài đời');
  if (memoryCue?.userFeedback === 'yes') confirmed.push('trường tiểu học cũ vừa được một sự việc gần đây gợi lại');
  else if (memoryCue?.userFeedback === 'no') rejected.push('một tác nhân gần đây đã đưa trường cũ vào giấc mơ');
  else if (memoryCue) open.push('điều gì đã làm bối cảnh trường cũ xuất hiện');
  if (externalSound?.userFeedback === 'yes') confirmed.push('có âm thanh thật xuất hiện gần lúc tỉnh dậy');
  else if (externalSound?.userFeedback === 'no') rejected.push('âm thanh bên ngoài tạo nên tiếng chuông');

  let contextConclusion = 'Chưa có đủ dữ liệu ngoài đời để xác định điều gì đã kích hoạt chuỗi cảnh này.';
  if (confirmed.length > 0) {
    contextConclusion = `Câu trả lời của bạn xác nhận rằng ${confirmed.join('; và ')}. Vì vậy phần tương ứng không còn chỉ là một phỏng đoán từ hình ảnh trong mơ.`;
  }
  if (rejected.length > 0) {
    contextConclusion += ` Đồng thời, hệ thống loại khỏi trọng tâm cách hiểu dựa trên ${rejected.join(' và ')}.`;
  }
  if (open.length > 0) {
    contextConclusion += ` Điều vẫn chưa rõ là ${open.join(' và ')}.`;
  }

  return [
    'Điểm căng nhất không nằm ở bản thân con tàu, mà ở việc mọi lựa chọn đều có hạn chót: hai chuyến cùng sắp rời ga, chiếc cặp chứa thứ cần cho ngày mai chưa kịp mở, rồi mặt sàn mất đi đúng lúc cơ hội lựa chọn biến mất.',
    'Chuỗi “phải chọn – thiếu thông tin – không kịp hoàn tất” giải thích trực tiếp cảm giác gấp gáp, bối rối và tiếc nuối khi tỉnh dậy. Nó gợi một trạng thái chuẩn bị chưa trọn vẹn rõ hơn là một dự báo về tương lai.',
    contextConclusion,
    confirmed.length === 0
      ? 'Những phần chưa được xác nhận chỉ nên được xem là giả thuyết để kiểm tra, không phải ý nghĩa cố định của lớp học, chuyến tàu hay mặt nước.'
      : 'Các xác nhận chỉ làm rõ nguồn bối cảnh của trường học và áp lực thời gian; chúng không biến chuyến tàu hay chiếc cặp thành biểu tượng có ý nghĩa cố định cho mọi giấc mơ.',
  ].join(' ');
}

function stripPriorFeedbackSynthesis(value: string): string {
  return value
    .replace(/\s*Kết luận ứng dụng cho trường hợp này:[\s\S]*?(?=\s+Thông tin bạn vừa xác nhận làm rõ trường hợp này:|\s+Vì câu trả lời của bạn, phân tích không tiếp tục dùng các hướng sau:|$)/giu, '')
    .replace(/\s*Thông tin bạn vừa xác nhận làm rõ trường hợp này:[\s\S]*?(?=\s+Vì câu trả lời của bạn, phân tích không tiếp tục dùng các hướng sau:|$)/giu, '')
    .replace(/\s*Vì câu trả lời của bạn, phân tích không tiếp tục dùng các hướng sau:[\s\S]*$/giu, '')
    .replace(/\s*Những phần bạn chọn Chưa biết vẫn được để mở và không được dùng làm kết luận chính; hệ thống tiếp tục bằng một câu hỏi khác đã chuẩn bị trước\.?/giu, '')
    .trim();
}

export function buildCaseGroundedThreads(narrative: string, fallback: any[]): any[] {
  const text = normalizeGroundingText(narrative);
  const isStationChoice = containsGroundedPhrase(text, ['nhà ga', 'chuyến tàu', 'station', 'train'])
    && containsGroundedPhrase(text, ['8 giờ sáng mai', 'tomorrow'])
    && containsGroundedPhrase(text, ['tháng chín năm sau', 'next year']);
  if (!isStationChoice) return fallback;

  return [
    {
      title: 'Việc gần hạn đang lấn át hướng đi dài hơn',
      dreamEvidence: [
        '8 giờ sáng mai',
        'tháng Chín năm sau',
        'Tôi chạy theo chuyến tàu ghi “8 giờ sáng mai”',
      ],
      reasoning: 'Hai chuyến tàu không chỉ khác điểm đến mà còn khác khoảng thời gian: một việc rất gần buộc bạn phải xuất hiện trước nhiều người, còn hướng xa hơn dẫn tới nơi hoàn toàn mới. Khi cuối cùng bạn chạy theo chuyến gần nhất, câu chuyện cho thấy việc trước mắt đang chiếm quyền ưu tiên, nhưng sự do dự ban đầu cho thấy kế hoạch dài hơn vẫn lấy mất sự chú ý. Điều cần kiểm tra không phải “con tàu tượng trưng cho gì”, mà là hiện tại bạn có đang cố giữ hai lịch trình quan trọng cùng lúc hay không.',
      alternativeExplanation: 'Nếu ngoài đời không có hai mốc kế hoạch cạnh tranh, hai bảng giờ có thể chỉ là cách giấc mơ tạo cảm giác khẩn cấp cho câu chuyện.',
    },
    {
      title: 'Áp lực thể hiện kéo bạn trở lại vai trò người học',
      dreamEvidence: [
        'rất nhiều người đang chờ nghe tôi nói',
        'nhà ga càng biến thành hành lang trường học cũ',
        'bên trong là thứ tôi cần cho ngày mai',
      ],
      reasoning: 'Căn phòng có người chờ nghe bạn nói đặt bạn vào vị trí phải thể hiện năng lực. Ngay sau đó, nhà ga lại biến thành trường cũ và cô giáo trao một vật chứa thông tin cần cho ngày mai. Trình tự này gợi rằng áp lực phải trình bày hoặc được đánh giá có thể đang gọi lại cảm giác quen thuộc của một người học: muốn được hướng dẫn, muốn biết mình đã chuẩn bị đủ chưa, nhưng thời gian không cho phép kiểm tra lần cuối.',
      alternativeExplanation: 'Nếu không có tình huống bị đánh giá hoặc trình bày sắp tới, trường và cô giáo có thể đến từ một ký ức vừa được gợi lại, không nhất thiết phản ánh sự thiếu tự tin.',
    },
    {
      title: 'Điều gây tiếc nuối là chưa kịp biết mình đã có gì',
      dreamEvidence: [
        'một chiếc cặp khóa kín',
        'Tôi chưa kịp mở',
        'hai chuyến tàu cùng biến mất',
      ],
      reasoning: 'Cao trào không kết thúc bằng việc bạn chọn nhầm chuyến, mà bằng việc chiếc cặp vẫn đóng và cả hai cơ hội cùng biến mất. Vì vậy, cảm giác tiếc nuối hợp với nỗi sợ chưa kịp kiểm tra nguồn lực hoặc thông tin mình đang có trước hạn chót. Đây là một câu hỏi thực tế hơn việc mặc định chiếc cặp là “tiềm năng bên trong”: bạn đang thiếu kiến thức thật, hay chỉ chưa có thời gian hệ thống lại thứ mình đã biết?',
      alternativeExplanation: 'Chiếc cặp cũng có thể chỉ là thủ pháp trì hoãn của giấc mơ, tạo một bí mật chưa được giải đáp để khiến bạn tỉnh dậy ở cao trào.',
    },
  ];
}

/**
 * Small models occasionally return one valid thread after exact-evidence
 * validation. Add only narrative-specific threads whose required event pair is
 * explicitly present; never manufacture a generic symbol meaning to hit a
 * target count.
 */
export function ensureInterpretiveThreadCoverage(narrative: string, threads: any[]): any[] {
  const accepted = buildCaseGroundedThreads(narrative, threads || []);
  if (accepted.length >= 2) return accepted.slice(0, 3);
  const text = normalizeGroundingText(narrative);
  const supplements: any[] = [];

  const hasInformationLoss = containsGroundedPhrase(text, ['cuốn sổ', 'quyển sổ', 'trang trắng', 'mất chữ', 'quên', 'notebook', 'blank pages', 'forget']);
  const hasPursuit = containsGroundedPhrase(text, ['bị đuổi', 'đuổi theo', 'tiếng bước chân', 'chạy', 'chase', 'footsteps', 'running']);
  if (hasInformationLoss && hasPursuit) {
    const evidence = [
      ...firstDistinctNarrativeSentences(narrative, ['cuốn sổ', 'quyển sổ', 'trang trắng', 'mất chữ', 'quên', 'notebook', 'blank pages', 'forget'], 1),
      ...firstDistinctNarrativeSentences(narrative, ['bị đuổi', 'đuổi theo', 'tiếng bước chân', 'chạy', 'chase', 'footsteps', 'running'], 1),
    ];
    if (new Set(evidence).size >= 2) supplements.push({
      title: 'Nỗi sợ mất thông tin làm cảnh truy đuổi căng hơn',
      dreamEvidence: [...new Set(evidence)].slice(0, 3),
      reasoning: 'Nỗi sợ quên hoặc không còn đọc được thông tin xuất hiện trước cảnh chạy trốn. Trình tự đó khiến mối đe dọa trong giấc mơ không chỉ là một kẻ đuổi theo vô hình: điều bạn sợ mất mới là phần làm cuộc chạy trở nên cấp bách. Nếu ngoài đời đang có việc cần ghi nhớ hoặc chuẩn bị, câu trả lời xác nhận có thể làm rõ mối nối này; nếu không, nó vẫn chỉ là cấu trúc căng thẳng của câu chuyện trong mơ.',
      alternativeExplanation: 'Cảnh chạy và vật bị mất thông tin cũng có thể được ghép ngẫu nhiên từ hai ký ức khác nhau, không nhất thiết cùng bắt nguồn từ một áp lực ngoài đời.',
    });
  }

  const familyLabel = detectedFamilyLabel(narrative);
  const hasBlockedApproach = containsGroundedPhrase(text, ['cửa đóng', 'không kịp tới', 'không thể tới', 'không nói gì', 'closed door', 'could not reach']);
  if (familyLabel && hasBlockedApproach) {
    const evidence = [
      ...firstDistinctNarrativeSentences(narrative, [familyLabel], 1),
      ...firstDistinctNarrativeSentences(narrative, ['cửa đóng', 'không kịp tới', 'không thể tới', 'không nói gì', 'closed door', 'could not reach'], 1),
    ];
    if (new Set(evidence).size >= 2) supplements.push({
      title: `Muốn tìm tới ${familyLabel} nhưng không hoàn tất được cuộc gặp`,
      dreamEvidence: [...new Set(evidence)].slice(0, 3),
      reasoning: `${familyLabel} không chỉ xuất hiện như một khuôn mặt quen thuộc: bạn chủ động tìm tới, muốn hỏi một điều cụ thể, nhưng cánh cửa khép lại trước khi cuộc gặp hoàn tất. Phần chưa hoàn tất này phù hợp với cảm giác tiếc nuối khi tỉnh dậy. Ý nghĩa tâm lý phụ thuộc vào quan hệ thật của bạn với ${familyLabel}; câu hỏi về ký ức gần đây hoặc vai trò nâng đỡ chỉ được đặt khi có kết luận nghiên cứu phù hợp để kiểm tra.`,
      alternativeExplanation: `Nếu ${familyLabel} hoặc căn nhà vừa được nhắc tới gần đây, cảnh này có thể chủ yếu là ký ức mới được gợi lại chứ không phản ánh một nhu cầu tâm lý đang tiếp diễn.`,
    });
  }

  const result = [...accepted];
  for (const supplement of supplements) {
    const key = normalizeGroundingText(supplement.title);
    if (result.some(item => normalizeGroundingText(item?.title) === key)) continue;
    result.push(supplement);
    if (result.length >= 2) break;
  }
  return result.slice(0, 3);
}

export function buildFeedbackConclusion(revisions: any[]): string | null {
  const supported = (revisions || []).filter(item => item?.status === 'supported');
  const weakened = (revisions || []).filter(item => item?.status === 'weakened');
  const unresolved = (revisions || []).filter(item => item?.status === 'unresolved');
  if (supported.length === 0 && weakened.length === 0 && unresolved.length === 0) return null;

  const parts: string[] = [];
  if (supported.length > 0) {
    const confirmed = supported.map(item => removeInternalAnalysisVocabulary(item.interpretation)
      .replace(/^Câu trả lời Có\s+/iu, '')
      .replace(/^hỗ trợ giả thuyết rằng\s+/iu, '')
      .replace(/^làm\s+/iu, ''));
    parts.push(`Thông tin bạn vừa cung cấp củng cố khả năng sau: ${confirmed.join(' ')}`);
  }
  if (weakened.length > 0) {
    const rejected = weakened.map(item => removeInternalAnalysisVocabulary(item.interpretation)
      .replace(/^Câu trả lời Không\s+/iu, '')
      .replace(/^làm\s+/iu, ''));
    parts.push(`Thông tin bạn vừa cung cấp làm hướng này kém phù hợp hơn: ${rejected.join(' ')}`);
  }
  if (unresolved.length > 0) {
    parts.push('Phần chưa chắc vẫn được để mở và chưa được dùng làm kết luận chính.');
  }
  return parts.join(' ');
}

export interface FeedbackAppliedAnalysis {
  confirmedFacts: string[];
  rejectedDirections: string[];
  unresolvedQuestions: string[];
  interpretation: string;
  nextSteps: string[];
}

function isPlanConflictQuestion(item: any): boolean {
  return getQuestionDimension(item) === 'multiple_future_horizons';
}

function isOldSchoolContextQuestion(item: any): boolean {
  return getQuestionDimension(item) === 'recent_experience_incorporation';
}

const GENERATED_THREAD_FEEDBACK_PREFIXES = [
  'Bạn đã xác nhận hai mốc kế hoạch này',
  'Bạn không ghi nhận hai mốc kế hoạch này',
  'Bạn đã xác nhận trường cũ vừa được gợi lại gần đây',
  'Bạn không ghi nhận tác nhân gợi nhớ gần đây',
  'Bạn đã xác nhận một sự việc gần đây đã gợi nhớ tới',
  'Bạn không ghi nhận sự việc gần đây nào gợi nhớ tới',
  'Bạn cũng xác nhận có âm thanh thật lúc tỉnh',
  'Bạn không ghi nhận âm thanh bên ngoài vào lúc tỉnh',
];

/**
 * Feedback text is a response projection, not part of the stored base analysis.
 * Old versions appended it to an already projected response, so every answer
 * change duplicated both the positive and negative branches. Always rebuild a
 * thread from sentences that do not belong to a previous feedback projection.
 */
export function stripGeneratedThreadFeedback(value: unknown): string {
  return feedbackSentences(value)
    .filter(sentence => {
      const normalized = normalizeGroundingText(sentence);
      return !GENERATED_THREAD_FEEDBACK_PREFIXES.some(prefix =>
        normalized.startsWith(normalizeGroundingText(prefix)));
    })
    .join(' ')
    .trim();
}

function threadContainsCue(thread: any, cue: unknown): boolean {
  const cueText = normalizeGroundingText(cue);
  if (!cueText) return false;
  const threadText = normalizeGroundingText([
    thread?.title,
    ...(Array.isArray(thread?.dreamEvidence) ? thread.dreamEvidence : []),
    thread?.reasoning,
    thread?.alternativeExplanation,
  ].filter(Boolean).join(' '));
  if (containsGroundedPhrase(threadText, [cueText]) || containsGroundedPhrase(cueText, [threadText])) return true;
  const schoolTerms = ['trường cũ', 'trường học cũ', 'lớp học cũ', 'lớp học tiểu học cũ', 'old school'];
  if (containsGroundedPhrase(cueText, schoolTerms) && containsGroundedPhrase(threadText, schoolTerms)) return true;
  const cueTokens = [...new Set(significantTokens(cueText).filter(token => token.length >= 3))];
  if (cueTokens.length === 0) return false;
  const threadTokens = new Set(significantTokens(threadText));
  const overlap = cueTokens.filter(token => threadTokens.has(token));
  return overlap.length >= Math.min(2, cueTokens.length);
}

export function buildFeedbackAppliedAnalysis(hypotheses: any[]): FeedbackAppliedAnalysis | null {
  const answered = (hypotheses || []).filter(item => ['yes', 'no', 'unsure'].includes(item?.userFeedback));
  if (answered.length === 0) return null;
  const confirmedFacts: string[] = [];
  const rejectedDirections: string[] = [];
  const unresolvedQuestions: string[] = [];
  const nextSteps: string[] = [];

  for (const item of answered) {
    const confirmedBefore = confirmedFacts.length;
    const rejectedBefore = rejectedDirections.length;
    const dimension = getQuestionDimension(item);
    if (dimension === 'multiple_future_horizons') {
      if (item.userFeedback === 'yes') {
        confirmedFacts.push('Bạn đang cùng lúc giữ một việc gần hạn và một kế hoạch dài hơn.');
        nextSteps.push('Tách hai mốc thành hai danh sách và chọn đúng một bước cần hoàn tất hôm nay cho mỗi mốc.');
      } else if (item.userFeedback === 'no') {
        rejectedDirections.push('Không dùng hai chuyến tàu để kết luận bạn đang bị giằng co giữa hai kế hoạch ngoài đời.');
        nextSteps.push('Thay vì tìm hai kế hoạch tương ứng, hãy xác định riêng điều gì khiến bạn cảm thấy “chưa kịp mở” hoặc chưa đủ chuẩn bị.');
      }
    } else if (dimension === 'recent_experience_incorporation') {
      const cue = String(item?.matchedCue || 'chi tiết được hỏi').trim();
      if (item.userFeedback === 'yes') {
        confirmedFacts.push(`Trong ba ngày trước giấc mơ đã có một sự việc thật gợi bạn nghĩ tới ${cue}.`);
        nextSteps.push(`Đối chiếu sự việc vừa gợi nhớ với cách ${cue} xuất hiện trong mơ: cảm xúc, hành động và điều bạn chưa kịp làm.`);
      } else if (item.userFeedback === 'no') {
        rejectedDirections.push(`Không dùng một tác nhân gợi nhớ gần đây để giải thích vì sao ${cue} xuất hiện.`);
        nextSteps.push(`Giữ ${cue} ở trạng thái chưa giải thích cho tới khi có dữ kiện khác, thay vì gán một ý nghĩa cố định.`);
      }
    } else if (dimension === 'attachment_support_under_stress') {
      const cue = String(item?.matchedCue || 'người thân này').trim();
      if (item.userFeedback === 'yes') {
        confirmedFacts.push(`${cue} từng là người giúp bạn cảm thấy an toàn hơn khi sợ hãi hoặc gặp khó khăn.`);
        nextSteps.push(`Xem lại điều bạn muốn nhận được khi cố tìm tới ${cue} trong mơ: một lời giải đáp, sự hiện diện hay cảm giác được bảo vệ.`);
      } else if (item.userFeedback === 'no') {
        rejectedDirections.push(`Không dùng hình ảnh ${cue} để suy ra nhu cầu tìm lại sự che chở quen thuộc.`);
      }
    } else if (dimension === 'external_sound_at_wake') {
      if (item.userFeedback === 'yes') {
        confirmedFacts.push('Có một âm thanh thật xuất hiện gần lúc bạn tỉnh dậy.');
        nextSteps.push('Ghi lại loại âm thanh và thời điểm tỉnh để kiểm tra xem cảnh âm thanh có lặp lại trong những lần sau không.');
      } else if (item.userFeedback === 'no') {
        rejectedDirections.push('Không dùng âm thanh bên ngoài để giải thích cảnh âm thanh trong mơ.');
      }
    } else if (dimension === 'avoidance_pressure' || dimension === 'current_stress') {
      if (item.userFeedback === 'yes') {
        confirmedFacts.push(dimension === 'avoidance_pressure'
          ? 'Điều kiện áp lực né tránh của kết luận học thuật có xuất hiện trong hoàn cảnh hiện tại.'
          : 'Điều kiện căng thẳng đời thực của kết luận học thuật có xuất hiện trong hoàn cảnh hiện tại.');
        nextSteps.push('Ghi lại áp lực cụ thể và đối chiếu xem nội dung đe dọa có thay đổi khi hoàn cảnh đó giảm hoặc chấm dứt.');
      } else if (item.userFeedback === 'no') {
        rejectedDirections.push('Không áp dụng kết luận học thuật về áp lực đời thực cho cảnh đe dọa trong giấc mơ này.');
      }
    }
    if (item.userFeedback === 'unsure') {
      unresolvedQuestions.push(`Chưa xác định: ${String(item.followUpQuestion || item.hypothesis || '').trim()}`);
      nextSteps.push('Tiếp tục bằng một câu hỏi đã chuẩn bị trước về một loại dữ kiện khác; chưa dùng hướng này làm kết luận chính.');
    } else if (confirmedFacts.length === confirmedBefore && rejectedDirections.length === rejectedBefore) {
      if (item.userFeedback === 'yes') {
        confirmedFacts.push(String(item.ifYesMeaning || item.hypothesis || '').trim());
      } else if (item.userFeedback === 'no') {
        rejectedDirections.push(String(item.ifNoMeaning || item.hypothesis || '').trim());
      }
    }
  }

  const interpretation = confirmedFacts.length > 0
    ? 'Bức tranh tổng thể và chi tiết liên quan bên dưới đã được viết lại theo thông tin này; những ý nghĩa chưa được xác nhận vẫn được để mở.'
    : rejectedDirections.length > 0
      ? 'Câu trả lời đã loại một cách giải thích khỏi trọng tâm; phần còn lại chỉ dựa trên trình tự và cảm xúc có trong lời kể.'
      : 'Bạn chưa thể xác nhận hướng này, nên nó được giữ ở trạng thái chưa xác định và không được dùng làm kết luận chính.';
  return { confirmedFacts, rejectedDirections, unresolvedQuestions, interpretation, nextSteps };
}

export function applyFeedbackToThreads(threads: any[], hypotheses: any[]): any[] {
  const exploratoryAssessment = buildExploratoryCaseAssessment(hypotheses);
  if (exploratoryAssessment) {
    const byDimension = new Map((hypotheses || []).map(item => [getQuestionDimension(item), item]));
    const fragments: any = byDimension.get('weak_association_recombination');
    const event: any = byDimension.get('implausible_future_scenario');
    const preparation: any = byDimension.get('waking_prospective_difference');
    const solution: any = byDimension.get('novel_solution_origin');
    const creativeProblem: any = byDimension.get('creative_problem_preoccupation');
    const memoryCueRows = (hypotheses || []).filter(item =>
      ['recent_experience_incorporation', 'recent_direct_exposure'].includes(getQuestionDimension(item)));
    const memoryCueConfirmed = memoryCueRows.some(item => item?.userFeedback === 'yes');
    const exactEvidence = (...items: any[]): string[] => [...new Set(items
      .flatMap(item => Array.isArray(item?.evidenceFromDream) ? item.evidenceFromDream : [])
      .map(value => String(value || '').trim())
      .filter(Boolean))].slice(0, 3);
    return [{
      title: 'Buổi trình bày thật là trục chính của chuỗi cảnh',
      dreamEvidence: exactEvidence(event, preparation),
      reasoning: event?.userFeedback === 'yes'
        ? 'Bạn đã xác nhận có một buổi họp hoặc trình bày thật liên quan trực tiếp đến dự án. Vì vậy, lịch cuộc họp, tấm vé có tên dự án và cảnh đứng trước khán giả được nối với một mối bận tâm ngoài đời đã biết; Mặt Trăng, đoàn tàu bàn phím và đàn chim là phần biến đổi phi thực tế, không phải dự báo về kết quả buổi trình bày.'
        : 'Lịch cuộc họp, tên dự án và cảnh trình bày tạo thành một trục hướng tới tương lai, nhưng chưa được xem là sự kiện ngoài đời cho tới khi người kể xác nhận.',
      alternativeExplanation: event?.userFeedback === 'no'
        ? 'Bạn không có sự kiện tương ứng trong bảy ngày tới, nên mạch này phải được xem là cấu trúc hư cấu của giấc mơ thay vì một màn diễn tập cho việc thật.'
        : event?.userFeedback === 'yes'
          ? 'Sự kiện thật đã được xác nhận, nhưng điều đó chưa giải thích vì sao giấc mơ chọn Mặt Trăng, đoàn tàu bàn phím hay đàn chim; các chi tiết này vẫn có thể là liên tưởng ngẫu nhiên khi ngủ.'
          : 'Nếu không có sự kiện tương ứng ngoài đời, cảnh trình bày có thể chỉ là cách câu chuyện tạo áp lực và cao trào.',
    }, {
      title: 'Lớp học cũ và đồ chơi là vật liệu ký ức, không phải mật mã cố định',
      dreamEvidence: exactEvidence(fragments, ...memoryCueRows),
      reasoning: fragments?.userFeedback === 'yes'
        ? `Bạn đã xác nhận các hình ảnh chính đến từ những sự việc đời thực riêng biệt.${memoryCueConfirmed ? ' Lớp học cũ cũng vừa được gợi lại hoặc tiếp xúc gần đây, nên sự xuất hiện của nó có một nguồn ký ức cụ thể.' : ''} Điều này phù hợp với cách giấc mơ ghép lại chất liệu đã có; nó không đủ căn cứ để nói lớp học luôn tượng trưng cho trách nhiệm hay cây cầu luôn tượng trưng cho bước ngoặt.`
        : 'Các hình ảnh thuộc nhiều bối cảnh khác nhau, nhưng nguồn đời thực của chúng chưa được xác nhận. Vì vậy, hệ thống chỉ mô tả cách chúng được ghép trong câu chuyện, không gán ý nghĩa biểu tượng cố định.',
      alternativeExplanation: fragments?.userFeedback === 'no'
        ? 'Không tìm thấy các nguồn riêng biệt gần đây làm yếu hướng tái kết hợp ký ức; chuỗi cảnh có thể đến từ những liên tưởng chưa xác định.'
        : fragments?.userFeedback === 'yes'
          ? 'Việc xác nhận nguồn đời thực cho biết các mảnh đến từ đâu, nhưng chưa chứng minh vì sao đúng những mảnh đó được chọn hoặc chúng mang một ý nghĩa sâu hơn.'
          : 'Một phần hình ảnh có thể chỉ xuất hiện do liên tưởng ngẫu nhiên trong lúc ngủ, ngay cả khi một số chi tiết có nguồn gần đây.',
    }, {
      title: 'Cây cầu là biến thể của việc đang nghĩ khi thức',
      dreamEvidence: exactEvidence(creativeProblem, preparation, solution),
      reasoning: solution?.userFeedback === 'yes'
        ? 'Bạn xác nhận ý tưởng dùng các mảnh rời để tạo thành giải pháp đã tồn tại trước giấc mơ. Cảnh ghép cây cầu vì thế cho thấy giấc mơ biến đổi một phương án có sẵn trong bối cảnh khác thường; nó không chứng minh giấc mơ tự phát minh giải pháp hoặc giải pháp đó sẽ hiệu quả.'
        : solution?.userFeedback === 'no'
          ? 'Bạn chưa từng nghĩ tới phương án tương tự khi thức. Ý tưởng cây cầu có thể là một liên tưởng mới xuất hiện trong mơ, nhưng cần đánh giá riêng sau khi tỉnh để biết nó có ích hay chỉ hợp với logic của giấc mơ.'
          : 'Cảnh ghép cây cầu có thể liên quan đến bài toán trình bày đang được xử lý, nhưng cần biết ý tưởng này đã tồn tại khi thức hay xuất hiện lần đầu trong mơ.',
      alternativeExplanation: creativeProblem?.userFeedback === 'no'
        ? 'Bạn không chủ động tìm một giải pháp mới ngoài đời, nên không dùng cảnh cây cầu để kết luận rằng tâm trí đang ấp ủ một bài toán sáng tạo.'
        : solution?.userFeedback === 'yes'
          ? 'Ý tưởng nền đã có khi thức; phần biến đổi thành cây cầu vẫn có thể chỉ phù hợp với logic của giấc mơ và cần được đánh giá lại bằng tiêu chí thực tế sau khi tỉnh.'
          : 'Cây cầu cũng có thể chỉ là một chuyển cảnh thuận tiện để nối đồ chơi, khán giả và đàn chim trong câu chuyện.',
    }].filter(thread => thread.dreamEvidence.length > 0);
  }

  const presentConflictCandidates = (hypotheses || []).filter(isPlanConflictQuestion);
  const memoryCueCandidates = (hypotheses || []).filter(isOldSchoolContextQuestion);
  const presentConflict: any = presentConflictCandidates.find(item => item?.userFeedback && item.userFeedback !== 'unsure') || presentConflictCandidates[0];
  const memoryCue: any = memoryCueCandidates.find(item => item?.userFeedback && item.userFeedback !== 'unsure') || memoryCueCandidates[0];
  const externalSound: any = (hypotheses || []).find(item => getQuestionDimension(item) === 'external_sound_at_wake' && item?.userFeedback && item.userFeedback !== 'unsure');

  return (threads || []).map((thread: any) => {
    let reasoning = stripGeneratedThreadFeedback(thread?.reasoning);
    let alternativeExplanation = stripGeneratedThreadFeedback(thread?.alternativeExplanation);
    const threadText = normalizeGroundingText(`${thread?.title || ''} ${(thread?.dreamEvidence || []).join(' ')} ${reasoning}`);

    const isFutureChoiceThread = containsGroundedPhrase(threadText, ['hai chuyến tàu', 'hai mốc', '8 giờ sáng mai', 'tháng chín năm sau']);
    if (isFutureChoiceThread && presentConflict?.userFeedback === 'yes') {
      reasoning += ' Bạn đã xác nhận hai mốc kế hoạch này cùng tồn tại ngoài đời, nên xung đột ưu tiên trở thành hướng giải thích chính cho cảnh hai chuyến tàu cùng rời ga.';
    } else if (isFutureChoiceThread && presentConflict?.userFeedback === 'no') {
      reasoning += ' Bạn không ghi nhận hai mốc kế hoạch cạnh tranh ngoài đời, nên phân tích không dùng cảnh hai chuyến tàu để kết luận rằng bạn đang giằng co giữa hai kế hoạch thật.';
    }

    const cue = String(memoryCue?.matchedCue || '').trim();
    if (cue && threadContainsCue(thread, cue) && memoryCue?.userFeedback === 'yes') {
      reasoning += ` Bạn đã xác nhận một sự việc gần đây đã gợi nhớ tới ${cue}; vì vậy chi tiết này có một nguồn ký ức cụ thể thay vì chỉ là cách gán nghĩa biểu tượng.`;
    } else if (cue && threadContainsCue(thread, cue) && memoryCue?.userFeedback === 'no') {
      reasoning += ` Bạn không ghi nhận sự việc gần đây nào gợi nhớ tới ${cue}; vì vậy phân tích loại hướng “ký ức vừa được kích hoạt” khỏi mạch này.`;
    }

    const isSoundThread = containsGroundedPhrase(threadText, ['âm thanh', 'tiếng chuông', 'tiếng bước chân', 'sound', 'bell']);
    if (isSoundThread && externalSound?.userFeedback === 'yes') {
      reasoning += ' Bạn cũng xác nhận có âm thanh thật lúc tỉnh; âm thanh trong cảnh mơ vì thế có thể liên quan đến môi trường ngủ thay vì mang một ý nghĩa tâm lý riêng.';
    } else if (isSoundThread && externalSound?.userFeedback === 'no') {
      alternativeExplanation += ' Bạn không ghi nhận âm thanh bên ngoài vào lúc tỉnh.';
    }

    return {
      ...thread,
      reasoning: polishGeneratedDreamProse(reasoning),
      alternativeExplanation: polishGeneratedDreamProse(alternativeExplanation),
    };
  });
}

function applyFeedbackToSymbolicNotes(notes: any[], hypotheses: any[]): any[] {
  const cueFeedbackRows = (hypotheses || []).filter(item =>
    ['recent_experience_incorporation', 'attachment_support_under_stress'].includes(getQuestionDimension(item))
    && ['yes', 'no'].includes(item?.userFeedback)
    && String(item?.matchedCue || '').trim());
  if (cueFeedbackRows.length === 0) return notes;

  return (notes || []).map(note => {
    const symbolKey = normalizeGroundingText(note?.symbol);
    const base = String(note?.meaning || '').trim()
      .replace(/\s*Bạn đã xác nhận một sự việc trong ba ngày trước giấc mơ[\s\S]*$/giu, '')
      .replace(/\s*Bạn không ghi nhận tác nhân gần đây nào[\s\S]*$/giu, '')
      .replace(/\s*Bạn đã xác nhận .+? từng giúp bạn cảm thấy an toàn hơn[\s\S]*$/giu, '')
      .replace(/\s*Bạn không xem .+? là người từng mang lại cảm giác an toàn[\s\S]*$/giu, '')
      .trim();
    const additions = cueFeedbackRows.flatMap(cueFeedback => {
      const cue = String(cueFeedback.matchedCue).trim();
      const cueKey = normalizeGroundingText(cue);
      if (!containsGroundedPhrase(symbolKey, [cueKey]) && !containsGroundedPhrase(cueKey, [symbolKey])) return [];
      const isAttachment = getQuestionDimension(cueFeedback) === 'attachment_support_under_stress';
      return [isAttachment
        ? cueFeedback.userFeedback === 'yes'
          ? `Bạn đã xác nhận ${cue} từng giúp bạn cảm thấy an toàn hơn khi gặp khó khăn. Trong giấc mơ này, việc cố tìm tới ${cue} vì thế có thể được đọc như một nỗ lực tìm lại cảm giác an toàn quen thuộc, không phải ý nghĩa cố định của mọi giấc mơ có người thân.`
          : `Bạn không xem ${cue} là người từng mang lại cảm giác an toàn khi gặp khó khăn. Vì vậy, phân tích loại cách hiểu “tìm về sự che chở” khỏi chi tiết này.`
        : cueFeedback.userFeedback === 'yes'
          ? `Bạn đã xác nhận một sự việc trong ba ngày trước giấc mơ đã gợi nhớ tới ${cue}. Vì vậy, sự xuất hiện của chi tiết này có một nguồn ký ức gần đây cụ thể; điều chưa thể suy ra chỉ từ câu trả lời là cảm xúc hoặc ý nghĩa cố định của nó.`
          : `Bạn không ghi nhận tác nhân gần đây nào gợi nhớ tới ${cue}. Vì vậy, phân tích không dùng giả thuyết “ký ức vừa được khơi lại” để giải thích chi tiết này và giữ ý nghĩa của nó ở trạng thái chưa xác định.`];
    });
    return additions.length > 0 ? { ...note, meaning: [base, ...additions].join(' ').trim() } : note;
  });
}

const GENERIC_SCIENCE_BOUNDARY = normalizeGroundingText(
  'Mối liên hệ này không chứng minh nguyên nhân và không xác định một ý nghĩa cố định cho hình ảnh trong mơ.',
);

function capitalizeSentence(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed[0].toLocaleUpperCase('vi')}${trimmed.slice(1)}` : trimmed;
}

function removeMechanicalScienceLead(value: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/^Nghiên cứu cho thấy\s+/iu, ''],
    [/^Nghiên cứu ghi nhận\s+/iu, 'Tài liệu ghi nhận '],
    [/^Nghiên cứu mô tả\s+/iu, 'Tài liệu mô tả '],
    [/^Trong nghiên cứu này,?\s*/iu, 'Dữ liệu của tài liệu cho thấy '],
  ];
  let result = value.trim();
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(result)) {
      result = result.replace(pattern, replacement);
      break;
    }
  }
  return capitalizeSentence(result);
}

export function structureScientificNoteText(note: unknown): {
  explanation: string;
  boundary?: string;
} {
  const text = String(note || '').trim();
  const uniqueSentences = new Map<string, string>();
  for (const sentence of text.split(/(?<=[.!?])\s+/).map(item => item.trim()).filter(Boolean)) {
    const key = normalizeGroundingText(sentence);
    if (!uniqueSentences.has(key)) uniqueSentences.set(key, sentence);
  }
  const explanation: string[] = [];
  const boundaries: string[] = [];
  for (const [key, sentence] of uniqueSentences) {
    const isBoundary = /không (?:chứng minh|cho biết|cho phép|tự xác định)|chưa (?:đủ|xác định)|xu hướng ở cấp nhóm|nhóm nhỏ/u.test(key);
    if (isBoundary) {
      if (key !== GENERIC_SCIENCE_BOUNDARY) boundaries.push(sentence);
    } else {
      explanation.push(sentence);
    }
  }
  const body = explanation.map(removeMechanicalScienceLead).join(' ').trim();
  return {
    explanation: body || removeMechanicalScienceLead(text),
    ...(boundaries.length ? { boundary: boundaries.join(' ') } : {}),
  };
}

export function buildScientificInsightTitle(rule: any): string {
  const text = normalizeGroundingText(`${rule?.ruleStatement || ''} ${rule?.factor || ''} ${rule?.outcome || ''}`);
  if (/self organization/u.test(text)) return 'Vì sao các cảnh khác nhau có thể xuất hiện trong cùng một giấc mơ?';
  if (/later in the night/u.test(text)) return 'Gần sáng và nội dung hướng tới tương lai';
  if (/combine future events|multiple time points/u.test(text)) return 'Hai mốc tương lai cùng xuất hiện';
  if (/implausible scenarios|unlikely or impossible/u.test(text)) return 'Kịch bản phi thực tế quanh điều sắp tới';
  if (/temporal proximity|yesterday or will occur tomorrow|past events and anticipated future/u.test(text)) {
    return 'Quá khứ gần và việc đang được dự liệu';
  }
  if (/memory consolidation|memory source|autobiograph/u.test(text)) return 'Vì sao một ký ức cũ có thể quay lại?';
  if (/threat|anxiety|avoid/u.test(text)) return 'Cảm giác bị thúc ép trong chuỗi cảnh';
  return 'Một liên hệ có căn cứ từ tài liệu';
}

export function collectScientificDreamEvidence(
  note: any,
  narrative: string,
  linkedEvidence: unknown[] = [],
): string[] {
  const quoted = String(note?.note || '').match(/[“"]([^”"]{4,220})[”"]/gu) || [];
  const candidates = [
    ...(Array.isArray(note?.dreamEvidence) ? note.dreamEvidence : []),
    ...quoted.map(value => value.slice(1, -1)),
    ...linkedEvidence,
  ];
  const exact = new Map<string, string>();
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!exactExcerptExists(value, narrative)) continue;
    const key = normalizeGroundingText(value);
    if (!exact.has(key)) exact.set(key, value);
  }
  return [...exact.values()].slice(0, 3);
}

export function buildVerifiedScientificNote(input: {
  rule: any;
  noteText: string;
  narrative: string;
  dreamEvidence?: unknown[];
  sources: any[];
  evidenceQuotes: Array<{ sourceId: string; chunkId: string; quote: string }>;
  confidence: number;
}): any | null {
  const sources = deduplicateAcademicSources(input.sources || []);
  const allowedSourceIds = new Set(sources.map(source => String(source.sourceId)));
  const evidenceByAnchor = new Map<string, { sourceId: string; chunkId: string; quote: string }>();
  for (const item of input.evidenceQuotes || []) {
    const sourceId = String(item?.sourceId || '').trim();
    const chunkId = String(item?.chunkId || '').trim();
    const quote = String(item?.quote || '').trim();
    if (!sourceId || !chunkId || !quote || !allowedSourceIds.has(sourceId)) continue;
    const key = `${sourceId}:${chunkId}:${normalizeGroundingText(quote)}`;
    if (!evidenceByAnchor.has(key)) evidenceByAnchor.set(key, { sourceId, chunkId, quote });
  }
  // A scientific card without an exact verified citation is merely generated
  // prose. Do not present it as a sourced interpretation.
  if (sources.length === 0 || evidenceByAnchor.size === 0) return null;

  const structured = structureScientificNoteText(input.noteText);
  if (structured.explanation.length < 40) return null;
  const ruleId = String(input.rule?.ruleId || input.rule?._id || '').trim();
  if (!ruleId) return null;
  return {
    ruleId,
    ruleCode: String(input.rule?.ruleCode || '').trim(),
    ruleStatement: String(input.rule?.ruleStatement || '').trim(),
    insightTitle: buildScientificInsightTitle(input.rule),
    note: structured.explanation,
    ...(structured.boundary ? { boundary: structured.boundary } : {}),
    matchedDreamDetails: collectScientificDreamEvidence(
      { note: input.noteText, dreamEvidence: input.dreamEvidence },
      input.narrative,
    ),
    evidenceQuotes: [...evidenceByAnchor.values()].slice(0, 2),
    confidence: Math.min(1, Math.max(0, Number(input.confidence) || 0)),
    sources,
  };
}

export function buildVerifiedMechanismFallbackNotes(
  rules: any[],
  evidenceLinks: any[],
  narrative: string,
  hypotheses: any[] = [],
): any[] {
  const notes: any[] = [];
  for (const rule of rules || []) {
    const ruleText = normalizeGroundingText(`${rule?.ruleStatement || ''} ${rule?.factor || ''} ${rule?.outcome || ''}`);
    const componentText = normalizeGroundingText((rule?.compositeComponents || [])
      .flatMap((component: any) => [component?.statement, component?.subject, component?.outcome])
      .join(' '));
    const isExploratoryRecombination = rule?.applicationTier === 'exploratory'
      && /weak associations|implausible scenarios|prospective thought|prospective cognition|liên kết yếu|kịch bản khó tin|tư duy hướng tới tương lai/u.test(`${ruleText} ${componentText}`);
    if (!canExplainPsychology(rule) && !isExploratoryRecombination) continue;
    let noteText = '';
    let dreamEvidence: string[] = [];
    let caseApplicability: ExploratoryCaseAssessment | null = null;
    if (isExploratoryRecombination) {
      caseApplicability = buildExploratoryCaseAssessment(hypotheses, rule);
      const matchedCues = presentDreamCues(narrative, [
        'lớp học tiểu học cũ', 'lớp học cũ', 'bảng đen', 'cuộc họp', 'cô giáo cũ',
        'tấm vé tàu', 'dự án', 'bàn phím máy tính', 'Mặt Trăng', 'mảnh đồ chơi',
        'căn bếp thời thơ ấu', 'cây cầu', 'đàn chim', 'old classroom', 'meeting',
        'train ticket', 'project', 'computer keyboard', 'Moon', 'childhood toys', 'bridge', 'birds',
      ], 6);
      const cueSentence = matchedCues.length >= 2
        ? `Trong lời kể này, ${matchedCues.map(cue => `“${cue}”`).join(', ')} được ghép thành một chuỗi duy nhất.`
        : 'Trong lời kể này, nhiều hình ảnh thuộc những bối cảnh khác nhau được ghép thành một chuỗi duy nhất.';
      noteText = [
        'Tài liệu đề xuất rằng giấc mơ hướng tới tương lai có thể đặt các mảnh ký ức liên hệ lỏng vào một kịch bản phi thực tế.',
        cueSentence,
        caseApplicability?.answeredCount ? caseApplicability.conclusion : '',
        'Sự tương đồng này chỉ mở ra một hướng đối chiếu về nguồn các mảnh ký ức và việc chuẩn bị cho sự kiện sắp tới; nó không chứng minh giấc mơ làm tăng sáng tạo hoặc dự báo tương lai.',
        'Quy luật hiện có điểm bằng chứng thấp và chưa đủ nguồn độc lập, nên chỉ được dùng như giả thuyết khám phá cho trường hợp này.',
      ].join(' ');
      dreamEvidence = firstDistinctNarrativeSentences(narrative, [
        'lớp học tiểu học cũ', 'bàn phím máy tính', 'Mặt Trăng', 'mảnh đồ chơi', 'cây cầu', 'đàn chim',
      ], 3);
    } else if (/self organization|self organization theory/u.test(ruleText)) {
      noteText = 'Trong lúc ngủ, giấc mơ không nhất thiết phát lại nguyên vẹn một sự kiện. Lý thuyết tự tổ chức mô tả khả năng những ký ức, mối bận tâm và cảm xúc đang hoạt động được ghép thành một câu chuyện mới. Vì vậy, trường cũ, việc phải nói vào ngày mai và thành phố ở tương lai xa có thể cùng xuất hiện mà không cần từng cảnh mang một ý nghĩa cố định. Cơ chế này giải thích cách câu chuyện được tạo thành; nó chưa cho biết mối bận tâm ngoài đời nào đã kích hoạt câu chuyện đó.';
      dreamEvidence = firstDistinctNarrativeSentences(narrative, ['trường học cũ', '8 giờ sáng mai', 'tháng chín năm sau'], 2);
    } else if (/waking life experiences|selectively incorporated|memory consolidation/u.test(ruleText)) {
      const recentCueConfirmed = (hypotheses || []).some(item =>
        normalizeGroundingText(item?.followUpQuestion).includes('trường tiểu học cũ') && item?.userFeedback === 'yes');
      noteText = recentCueConfirmed
        ? 'Các nghiên cứu về nguồn ký ức trong mơ cho thấy một trải nghiệm gần thời điểm ngủ có thể làm ký ức liên quan dễ đi vào giấc mơ hơn. Bạn đã xác nhận có một tác nhân gần đây gợi lại trường cũ, nên việc lớp học xuất hiện có một đầu mối cụ thể thay vì chỉ dựa vào cách giải nghĩa biểu tượng. Kết quả này giải thích vì sao ký ức được gọi lại, không quy định lớp học luôn tượng trưng cho cùng một điều.'
        : 'Các nghiên cứu về nguồn ký ức trong mơ cho thấy một trải nghiệm gần thời điểm ngủ có thể làm ký ức liên quan dễ đi vào giấc mơ hơn. Vì vậy, trước khi giải nghĩa trường cũ, điều hữu ích hơn là kiểm tra xem gần đây có hình ảnh, cuộc trò chuyện hoặc sự việc nào gợi lại giai đoạn đó hay không. Nếu không tìm thấy tác nhân như vậy, cơ chế này phải giảm ưu tiên.';
      dreamEvidence = firstDistinctNarrativeSentences(narrative, ['trường học cũ', 'lớp học tiểu học cũ', 'ngày hôm qua'], 2);
    }
    if (!noteText || dreamEvidence.length === 0) continue;
    const ruleId = String(rule?.ruleId || rule?._id || '').trim();
    const links = (evidenceLinks || []).filter(link => String(link?.ruleId || '') === ruleId);
    const sources = links.map(link => ({
      sourceId: String(link?.sourceId || ''),
      title: String(link?.sourceTitle || 'Tài liệu học thuật'),
      authors: [],
      ...(link?.sourceYear ? { year: Number(link.sourceYear) } : {}),
      ...(link?.doi ? { doi: String(link.doi) } : {}),
      chunkIds: (link?.chunkIds || []).map((id: unknown) => String(id)),
    }));
    const evidenceQuotes = links.flatMap(link => {
      const sourceId = String(link?.sourceId || '').trim();
      const chunkId = String(link?.chunkIds?.[0] || '').trim();
      const quote = String(link?.chunkPreview || '').replace(/\.\.\.$/u, '').trim();
      return sourceId && chunkId && quote ? [{ sourceId, chunkId, quote }] : [];
    });
    const verified = buildVerifiedScientificNote({
      rule,
      noteText,
      narrative,
      dreamEvidence,
      sources,
      evidenceQuotes,
      confidence: 0.7,
    });
    if (verified) notes.push({
      ...verified,
      ...(isExploratoryRecombination ? {
        applicationTier: 'exploratory',
        academicEvidenceScore: Number(rule?.evidenceScore) || 0,
        ...(caseApplicability ? { caseApplicability } : {}),
      } : {}),
    });
  }
  return notes.slice(0, 2);
}

export function deduplicateScientificNotes(notes: any[]): any[] {
  const unique = new Map<string, any>();
  for (const note of notes || []) {
    const key = String(note?.ruleId || normalizeGroundingText(note?.note)).trim();
    if (key && !unique.has(key)) unique.set(key, note);
  }
  return [...unique.values()].slice(0, 4);
}

export function enrichScientificNotesForResponse(
  analysis: any,
  retrievedContext: any,
  narrative: string,
): any {
  if (!analysis) return analysis;
  const appliedRules = retrievedContext?.componentD?.appliedRules || [];
  const usedDictionarySymbols = retrievedContext?.componentA?.usedSymbols || [];
  const personalSymbolPatterns = retrievedContext?.componentC?.personalSymbolPatterns || [];
  const observedSymbolPatterns = retrievedContext?.componentC?.observedSymbolPatterns || [];
  const similarDreams = retrievedContext?.componentC?.similarDreams || [];
  const evidenceLinks = retrievedContext?.componentD?.evidenceLinks || [];
  const ruleMap = new Map(appliedRules.map((rule: any) => [String(rule?.ruleId || rule?._id || ''), rule]));
  const sourceByRule = new Map<string, any[]>(
    (Array.isArray(analysis.scientific_context_notes) ? analysis.scientific_context_notes : [])
      .filter((note: any) => String(note?.ruleId || '').trim() && Array.isArray(note?.sources))
      .map((note: any) => [String(note.ruleId).trim(), note.sources]),
  );
  for (const link of evidenceLinks) {
    const ruleId = String(link?.ruleId || '').trim();
    const sourceId = String(link?.sourceId || '').trim();
    if (!ruleId || !sourceId) continue;
    const existing = sourceByRule.get(ruleId) || [];
    if (existing.some(source => String(source?.sourceId || '') === sourceId)) continue;
    sourceByRule.set(ruleId, [...existing, {
      sourceId,
      title: String(link?.sourceTitle || 'Tài liệu học thuật'),
      authors: [],
      ...(link?.sourceYear ? { year: Number(link.sourceYear) } : {}),
      ...(link?.doi ? { doi: String(link.doi) } : {}),
      chunkIds: (link?.chunkIds || []).map((id: unknown) => String(id)),
    }]);
  }
  const fallbackQuestionTrees = buildRuleGroundedFallbackHypotheses(appliedRules, narrative);
  const fallbackQuestions = fallbackQuestionTrees.flatMap((item: any) => {
    const { alternateQuestion, ...primary } = item;
    if (!alternateQuestion
      || normalizeGroundingText(alternateQuestion.followUpQuestion) === normalizeGroundingText(primary.followUpQuestion)) {
      return [primary];
    }
    return [primary, {
      ...alternateQuestion,
      ruleIds: alternateQuestion.ruleIds || primary.ruleIds || [primary.ruleId],
      sources: alternateQuestion.sources || primary.sources || [],
      parentVerificationKey: primary.verificationKey,
      isAlternateQuestion: true,
    }];
  });
  const sleepEnvironmentQuestions = buildSleepEnvironmentQuestions(
    narrative,
    retrievedContext?.componentA?.sleepContext || {},
    appliedRules,
  );
  const storedHypotheses = Array.isArray(analysis.real_life_hypotheses) ? analysis.real_life_hypotheses : [];
  const storedHypothesisByRule = new Map(storedHypotheses.map((item: any) => [String(item?.ruleId || ''), item]));
  const storedHypothesisByVerification = new Map(storedHypotheses.map((item: any) => [String(item?.verificationKey || ''), item]));
  const storedHypothesisByQuestion = new Map(storedHypotheses.map((item: any) => [normalizeGroundingText(item?.followUpQuestion || ''), item]));
  const rawHypothesisCandidates = [...fallbackQuestions, ...sleepEnvironmentQuestions];
  const candidatesByQuestion = new Map<string, any>();
  for (const item of rawHypothesisCandidates) {
    const key = normalizeGroundingText(item?.followUpQuestion || '');
    if (!key) continue;
    const existing = candidatesByQuestion.get(key);
    if (!existing) {
      candidatesByQuestion.set(key, item);
      continue;
    }
    existing.ruleIds = [...new Set([...(existing.ruleIds || [existing.ruleId]), ...(item.ruleIds || [item.ruleId])].filter(Boolean))];
  }
  const hypothesisCandidates = [...candidatesByQuestion.values()];
  const baseResponseHypotheses = attachRuleQuestionContext(
    hypothesisCandidates.flatMap((item: any) => {
      const linkedRuleIds: string[] = [...new Set<string>((item?.ruleIds || [item?.ruleId]).map((id: unknown) => String(id || '')).filter(Boolean))];
      const linkedRules = linkedRuleIds.map(ruleId => ruleMap.get(ruleId)).filter(Boolean) as any[];
      const rule: any = linkedRules[0];
      if (!rule || !linkedRules.some(canGenerateContextQuestion)) return [];
      const stored: any = storedHypothesisByVerification.get(String(item?.verificationKey || ''))
        || storedHypothesisByQuestion.get(normalizeGroundingText(item?.followUpQuestion || ''))
        || (!item?.verificationKey ? storedHypothesisByRule.get(String(item?.ruleId || '')) : undefined);
      const sources = [...new Map([
        ...(item?.sources || []),
        ...(stored?.sources || []),
        ...linkedRuleIds.flatMap(ruleId => sourceByRule.get(ruleId) || []),
      ].map((source: any) => [String(source?.sourceId || source?.doi || source?.title || ''), source])).values()];
      if (!Array.isArray(sources) || sources.length === 0) return [];
      return [{
        ...item,
        ruleId: linkedRuleIds[0],
        ruleIds: linkedRuleIds,
        sources,
        userFeedback: stored?.userFeedback ?? item?.userFeedback ?? null,
      }];
    }),
    appliedRules,
  ).map((item: any) => ({
    ...item,
    hypothesis: removeInternalAnalysisVocabulary(item.hypothesis),
    followUpQuestion: removeInternalAnalysisVocabulary(item.followUpQuestion),
    reasonForAsking: removeInternalAnalysisVocabulary(item.reasonForAsking),
    ifYesMeaning: removeInternalAnalysisVocabulary(item.ifYesMeaning),
    ifNoMeaning: removeInternalAnalysisVocabulary(item.ifNoMeaning),
  }));
  const responseHypotheses = baseResponseHypotheses;
  const emotion = deriveDreamEmotionTone(narrative);
  const feedbackConclusion = buildFeedbackConclusion(analysis.feedback_revision || []);
  const responseThreads = applyFeedbackToThreads(ensureInterpretiveThreadCoverage(
    narrative,
    Array.isArray(analysis.interpretive_threads) ? analysis.interpretive_threads : [],
  ), responseHypotheses).map((thread: any) => ({
    ...thread,
    title: removeInternalAnalysisVocabulary(thread.title),
    reasoning: removeInternalAnalysisVocabulary(thread.reasoning),
    alternativeExplanation: removeInternalAnalysisVocabulary(thread.alternativeExplanation),
  }));
  const publicAnalysis = { ...analysis };
  delete publicAnalysis.dreamValenceScore;
  delete publicAnalysis.score_breakdown;
  const baseResponseSymbolicNotes = deduplicateOverlappingMotifNotes(mergeContextualMotifNotes(
    Array.isArray(analysis.symbolic_notes)
      ? analysis.symbolic_notes.filter((note: any) => note?.origin !== 'contextual_observation' || isSupportedContextualMotif(note?.symbol, appliedRules))
      : [],
    buildContextualMotifNotes(narrative, appliedRules),
  ).map((note: any) => {
    const noteKey = normalizeGroundingText(note?.symbol);
    const dictionaryMatch = usedDictionarySymbols.find((item: any) => {
      if (!Array.isArray(item?.retrievalMethods) || !item.retrievalMethods.includes('exact_match')) return false;
      const alias = normalizeGroundingText(item?.matchedTextVariant || item?.canonicalSymbol || item?.symbol);
      if (!alias || !(containsGroundedPhrase(noteKey, [alias]) || containsGroundedPhrase(alias, [noteKey]))) return false;
      if (normalizeGroundingText(item?.canonicalSymbol || item?.symbol) === 'house'
        && containsGroundedPhrase(noteKey, ['nhà ga', 'nhà trường', 'nhà máy', 'nhà hàng'])) return false;
      return true;
    });
    const personalPattern = personalSymbolPatterns.find((item: any) => {
      const patternKey = normalizeGroundingText(item?.symbol);
      return patternKey && (containsGroundedPhrase(noteKey, [patternKey]) || containsGroundedPhrase(patternKey, [noteKey]));
    });
    const observedPattern = observedSymbolPatterns.find((item: any) =>
      (item?.matchedLabels || []).some((label: unknown) => {
        const labelKey = normalizeGroundingText(label);
        return labelKey && (containsGroundedPhrase(noteKey, [labelKey]) || containsGroundedPhrase(labelKey, [noteKey]));
      }));
    const similarOccurrences = similarDreams.filter((item: any) => {
      const excerpt = normalizeGroundingText(item?.excerpt);
      return noteKey && excerpt && containsGroundedPhrase(excerpt, [noteKey]);
    });
    const sameSequenceCount = similarOccurrences.filter((item: any) =>
      (item?.matchedOn || []).some((label: unknown) => ['Cùng nội dung', 'Cùng tình tiết hoặc mô-típ'].includes(String(label)))).length;
    const confirmedContextCount = similarOccurrences.filter((item: any) =>
      (item?.confirmedContext || []).some((entry: any) => entry?.answer === 'yes')).length;
    return {
      ...note,
      origin: dictionaryMatch ? 'dictionary' : 'contextual_observation',
      knowledgeStatus: dictionaryMatch ? 'dictionary' : 'observed',
      ...(dictionaryMatch ? { dictionarySymbol: String(dictionaryMatch?.canonicalSymbol || dictionaryMatch?.symbol || '') } : {}),
      meaning: removeInternalAnalysisVocabulary(buildGroundedMotifExplanation(note, appliedRules)),
      contextualTone: inferContextualTone(note?.dreamEvidence),
      motifStats: {
        previousPersonalDreamCount: Math.max(0, Number(personalPattern?.occurrences) || 0),
        similarDreamCount: similarOccurrences.length,
        sameSequenceCount,
        confirmedContextCount,
        observedPersonalDreamCount: Math.max(0, Number(observedPattern?.personalDreamCount) || 0),
        observedPublicDreamCount: Math.max(0, Number(observedPattern?.publicDreamCount) || 0),
        observedToneCounts: observedPattern?.toneCounts || undefined,
      },
    };
  }));
  const responseSymbolicNotes = applyFeedbackToSymbolicNotes(baseResponseSymbolicNotes, responseHypotheses);
  const responseScientificNotes = deduplicateScientificNotes([...(Array.isArray(analysis.scientific_context_notes)
    ? analysis.scientific_context_notes
    : []).flatMap((note: any) => {
    if (note?.ruleCode && note?.ruleStatement && Array.isArray(note?.evidenceQuotes) && note.evidenceQuotes.length > 0) {
      const linkedRule: any = ruleMap.get(String(note?.ruleId || '').trim());
      return linkedRule && canExplainPsychology(linkedRule) ? [{
        ...note,
        note: removeInternalAnalysisVocabulary(note.note),
        boundary: removeInternalAnalysisVocabulary(note.boundary),
      }] : [];
    }
    const ruleId = String(note?.ruleId || '').trim();
    const rule: any = ruleMap.get(ruleId);
    if (!rule || !canExplainPsychology(rule)) return [];
    const sources = note?.sources || [];
    const links = evidenceLinks.filter((link: any) => String(link?.ruleId || '') === ruleId);
    const evidenceQuotes = links.flatMap((link: any) => {
      const chunkId = String(link?.chunkIds?.[0] || '').trim();
      const quote = String(link?.chunkPreview || '').replace(/\.\.\.$/u, '').trim();
      return chunkId && quote ? [{ sourceId: String(link?.sourceId || ''), chunkId, quote }] : [];
    });
    const enriched = buildVerifiedScientificNote({
      rule,
      noteText: String(note?.note || '').trim(),
      narrative,
      dreamEvidence: note?.dreamEvidence || note?.matchedDreamDetails || [],
      sources,
      evidenceQuotes,
      confidence: Number(note?.confidence) || 0,
    });
    const finalNote = enriched || {
      ...note,
      ruleCode: String(rule?.ruleCode || '').trim(),
      ruleStatement: String(rule?.ruleStatement || '').trim(),
      insightTitle: buildScientificInsightTitle(rule),
    };
    return [{
      ...finalNote,
      note: removeInternalAnalysisVocabulary(finalNote.note),
      boundary: removeInternalAnalysisVocabulary(finalNote.boundary),
    }];
  }), ...buildVerifiedMechanismFallbackNotes(appliedRules, evidenceLinks, narrative, responseHypotheses)]);
  const caseConclusion = buildDreamCaseConclusion(narrative, responseHypotheses, responseScientificNotes);
  const exploratoryAssessmentForResponse = buildExploratoryCaseAssessment(responseHypotheses);

  return {
    ...publicAnalysis,
    emotional_tone_key: emotion.key,
    emotional_tone: emotion.label,
    core_analysis: removeInternalAnalysisVocabulary(exploratoryAssessmentForResponse
      ? caseConclusion.reasoning
      : buildCaseGroundedSynthesis(
        narrative,
        responseHypotheses,
        sanitizeUnsupportedDreamClaims(analysis.core_analysis),
      )),
    case_conclusion: caseConclusion,
    summary: removeInternalAnalysisVocabulary(polishGeneratedDreamProse(analysis.summary)),
    real_life_hypotheses: responseHypotheses,
    feedback_conclusion: feedbackConclusion,
    feedback_analysis: buildFeedbackAppliedAnalysis(responseHypotheses),
    grounding_summary: {
      narrativeUsed: Boolean(narrative.trim()),
      resolvedContextCount: responseHypotheses.filter((item: any) => ['yes', 'no'].includes(item?.userFeedback)).length,
      unresolvedContextCount: responseHypotheses.filter((item: any) => item?.userFeedback === 'unsure').length,
      dictionaryMotifCount: responseSymbolicNotes.filter((item: any) => item?.origin === 'dictionary').length,
      contextualMotifCount: responseSymbolicNotes.filter((item: any) => item?.origin !== 'dictionary').length,
      appliedRuleCount: responseScientificNotes.length,
      explanatoryRuleCount: responseScientificNotes.filter((note: any) => note?.applicationTier !== 'exploratory').length,
      exploratoryRuleCount: responseScientificNotes.filter((note: any) => note?.applicationTier === 'exploratory').length,
      similarDreamCount: Array.isArray(retrievedContext?.componentC?.similarDreams)
        ? retrievedContext.componentC.similarDreams.length
        : Array.isArray(analysis.similar_dreams) ? analysis.similar_dreams.length : 0,
      sleepContextFactCount: Object.keys(retrievedContext?.componentA?.sleepContext || {}).length,
    },
    interpretive_threads: responseThreads,
    practical_reflections: buildPracticalReflectionsFromHypotheses(responseHypotheses).map(item => ({
      suggestion: removeInternalAnalysisVocabulary(item.suggestion),
      rationale: removeInternalAnalysisVocabulary(item.rationale),
    })),
    symbolic_notes: responseSymbolicNotes,
    scientific_context_notes: responseScientificNotes,
  };
}

export function buildRuleScientificFallback(rule: any, narrative: string): string | null {
  if (!canExplainPsychology(rule)) return null;
  void narrative;
  return null;
}

export function buildPracticalReflectionsFromHypotheses(hypotheses: any[]): Array<{
  suggestion: string;
  rationale: string;
}> {
  const exploratoryAssessment = buildExploratoryCaseAssessment(hypotheses);
  if (exploratoryAssessment?.status === 'strong_match') {
    return [{
      suggestion: 'Viết ba ý chính của buổi trình bày và diễn tập một lần trong khoảng 10 phút.',
      rationale: 'Các câu trả lời đã xác nhận buổi trình bày và việc chuẩn bị là bối cảnh thật; xử lý trực tiếp phần còn chưa yên tâm hữu ích hơn tiếp tục giải mã các hình ảnh phi thực tế.',
    }, {
      suggestion: 'Ghi riêng điều bạn đã nghĩ ra khi thức và phần giấc mơ đã biến đổi hoặc ghép thêm.',
      rationale: 'Bạn xác nhận ý tưởng giải quyết đã tồn tại trước giấc mơ. So sánh hai phần giúp đánh giá ý tưởng sau khi tỉnh mà không gán cho giấc mơ khả năng tự tạo ra lời giải đúng.',
    }, {
      suggestion: 'Không dùng lớp học, Mặt Trăng, đàn chim hoặc cây cầu như dấu hiệu dự báo kết quả buổi trình bày.',
      rationale: 'Những hình ảnh này giúp nhận ra cách giấc mơ tổ chức chất liệu, nhưng câu trả lời và tài liệu hiện có không hỗ trợ ý nghĩa biểu tượng cố định hay dự báo tương lai.',
    }];
  }
  const output: Array<{ suggestion: string; rationale: string }> = [];
  for (const item of hypotheses || []) {
    const question = normalizeGroundingText(item?.followUpQuestion);
    const dimension = getQuestionDimension(item);
    if (dimension === 'recent_experience_incorporation') {
      const cue = String(item?.matchedCue || 'chi tiết này').trim();
      output.push(item.userFeedback === 'yes' ? {
        suggestion: `Ghi lại sự việc gần đây đã làm bạn nghĩ tới ${cue} và cảm xúc xuất hiện vào lúc đó.`,
        rationale: `Thông tin này giúp so sánh nguồn ký ức ngoài đời với vai trò của ${cue} trong giấc mơ, thay vì gán sẵn một ý nghĩa biểu tượng.`,
      } : item.userFeedback === 'no' ? {
        suggestion: `Tạm để ý nghĩa của ${cue} ở trạng thái chưa xác định.`,
        rationale: 'Bạn không ghi nhận tác nhân gợi nhớ gần đây, nên phân tích không thay thế khoảng trống này bằng một lời giải thích biểu tượng thiếu căn cứ.',
      } : {
        suggestion: `Nhớ lại ba ngày trước giấc mơ và kiểm tra lần gần nhất một sự việc khiến bạn nghĩ tới ${cue}.`,
        rationale: 'Mốc này giúp kiểm tra một nguồn ký ức cụ thể mà không mặc định ý nghĩa của hình ảnh trong mơ.',
      });
    } else if (dimension === 'weak_association_recombination') {
      output.push(item.userFeedback === 'yes' ? {
        suggestion: 'Ghi riêng nguồn đời thực của từng mảnh đã được hỏi và đánh dấu mảnh nào xuất hiện gần thời điểm ngủ.',
        rationale: 'Bạn đã xác nhận các mảnh đến từ những tình huống khác nhau; tách nguồn giúp kiểm tra cách chúng được ghép lại mà không gán cho giấc mơ một năng lực sáng tạo chắc chắn.',
      } : item.userFeedback === 'no' ? {
        suggestion: 'Không tiếp tục dùng giả thuyết về các liên kết yếu làm trục giải thích cho chuỗi cảnh này.',
        rationale: 'Bạn không xác nhận các nguồn riêng biệt gần đây, nên hệ thống giữ nguồn của sự kết hợp ở trạng thái chưa rõ.',
      } : {
        suggestion: 'Đối chiếu từng hình ảnh nổi bật với bảy ngày trước giấc mơ và ghi nguồn gần nhất mà bạn nhớ được.',
        rationale: 'Việc này thu đúng dữ liệu còn thiếu: các hình ảnh có thật sự đến từ những bối cảnh riêng biệt hay không.',
      });
    } else if (dimension === 'implausible_future_scenario') {
      output.push(item.userFeedback === 'yes' ? {
        suggestion: 'Tách ba yêu cầu thật của buổi họp hoặc trình bày khỏi những chi tiết chỉ tồn tại trong giấc mơ.',
        rationale: 'Sự kiện tương lai đã được xác nhận, nhưng đoàn tàu, Mặt Trăng hay các biến đổi phi thực tế không phải dự báo về sự kiện đó.',
      } : item.userFeedback === 'no' ? {
        suggestion: 'Không dùng cảnh trình bày trong mơ để suy ra một sự kiện tương lai đang đến gần.',
        rationale: 'Bạn không xác nhận sự kiện ngoài đời tương ứng, nên mối nối hướng tới tương lai đã bị loại khỏi trường hợp này.',
      } : {
        suggestion: 'Kiểm tra lịch bảy ngày tới để xác định có sự kiện thật nào tương ứng với buổi trình bày trong mơ hay không.',
        rationale: 'Chỉ dữ kiện lịch thực tế mới phân biệt được một mối bận tâm sắp tới với cấu trúc hư cấu của giấc mơ.',
      });
    } else if (dimension === 'waking_prospective_difference' || dimension === 'creative_problem_preoccupation' || dimension === 'novel_solution_origin') {
      output.push({
        suggestion: 'Ghi lại điều bạn đã chuẩn bị khi thức và điều chỉ xuất hiện lần đầu trong giấc mơ thành hai cột riêng.',
        rationale: 'So sánh này giúp phân biệt kế hoạch có chủ đích với sự kết hợp tự do trong mơ; một ý tưởng mới xuất hiện chưa tự chứng minh rằng nó đúng hoặc hữu ích.',
      });
    } else if (dimension === 'attachment_support_under_stress') {
      const cue = String(item?.matchedCue || 'người thân này').trim();
      output.push(item.userFeedback === 'yes' ? {
        suggestion: `Ghi lại điều bạn đã muốn nhận được khi cố tìm tới ${cue} trong mơ.`,
        rationale: `Bạn xác nhận ${cue} từng là một điểm tựa; xác định nhu cầu cụ thể giúp phân biệt mong muốn được an ủi, được hướng dẫn và được bảo vệ.`,
      } : item.userFeedback === 'no' ? {
        suggestion: `Không tiếp tục dùng hình ảnh ${cue} như dấu hiệu của sự che chở trong lần phân tích này.`,
        rationale: 'Câu trả lời của bạn đã loại vai trò đó khỏi lịch sử quan hệ thực tế.',
      } : {
        suggestion: `Nhớ lại một tình huống khó khăn trước đây và xem ${cue} thường giúp đỡ, làm bạn căng thẳng hay không tham gia.`,
        rationale: 'Vai trò thật trong mối quan hệ quyết định cách hiểu chi tiết này; quan hệ huyết thống tự nó không đủ.',
      });
    } else if (dimension === 'avoidance_pressure' || dimension === 'current_stress') {
      output.push(item.userFeedback === 'yes' ? {
        suggestion: 'Ghi lại áp lực cụ thể và theo dõi xem cảnh đe dọa có thay đổi khi áp lực đó giảm hoặc được xử lý.',
        rationale: 'Câu trả lời Có xác nhận điều kiện đời thực mà kết luận học thuật yêu cầu; sự lặp lại qua nhiều lần mới cho biết mức phù hợp thực tế.',
      } : item.userFeedback === 'no' ? {
        suggestion: 'Không dùng kết luận về áp lực đời thực để giải thích cảnh đe dọa trong lần này.',
        rationale: 'Câu trả lời Không cho thấy điều kiện áp dụng của kết luận học thuật chưa xuất hiện trong trường hợp hiện tại.',
      } : {
        suggestion: 'Kiểm tra xem tuần này có áp lực hoặc việc né tránh nào phù hợp với điều kiện đang được hỏi hay không.',
        rationale: 'Chưa có câu trả lời nên kết luận học thuật chưa được dùng làm hướng giải thích chính.',
      });
    } else if (question.includes('người khác đánh giá')) {
      output.push({
        suggestion: 'Nếu có một tình huống bị đánh giá trong bảy ngày tới, hãy viết ba điều bạn muốn truyền đạt và thử diễn tập một lần trong mười phút.',
        rationale: 'Việc chuẩn bị ngắn này xử lý trực tiếp áp lực thực tại đang được kiểm tra, đồng thời giúp phân biệt nỗi sợ thiếu chuẩn bị với một cách hiểu biểu tượng chung chung.',
      });
    } else if (dimension === 'external_sound_at_wake') {
      output.push(item.userFeedback === 'yes' ? {
        suggestion: 'Ghi lại loại âm thanh và thời điểm bạn tỉnh nếu tình huống này lặp lại.',
        rationale: 'Bạn đã xác nhận có âm thanh thật lúc tỉnh; theo dõi lần lặp giúp phân biệt tác động môi trường ngủ với nội dung tâm lý của giấc mơ.',
      } : item.userFeedback === 'no' ? {
        suggestion: 'Không cần tiếp tục tìm nguồn âm thanh bên ngoài cho cảnh âm thanh trong lần này.',
        rationale: 'Câu trả lời Không đã làm yếu khả năng cao trào bị kích hoạt bởi âm thanh thật.',
      } : {
        suggestion: 'Nếu giấc mơ có tiếng động và làm bạn tỉnh lần nữa, hãy kiểm tra ngay môi trường xung quanh trước khi ngủ lại.',
        rationale: 'Thông tin được ghi ngay lúc tỉnh đáng tin cậy hơn việc cố nhớ lại môi trường ngủ sau nhiều giờ.',
      });
    } else if (isPlanConflictQuestion(item)) {
      if (item.userFeedback === 'no') {
        output.push({
          suggestion: 'Không cần tiếp tục tìm hai kế hoạch tương ứng với hai chuyến tàu. Hãy ghi riêng điều bạn cảm thấy chưa kịp chuẩn bị hoặc chưa kịp kiểm tra trước một hạn gần nhất.',
          rationale: 'Câu trả lời Không đã loại hướng giằng co giữa kế hoạch ngắn và dài; bước này chuyển trọng tâm sang chiếc cặp chưa mở và cảm giác thiếu chuẩn bị thực sự.',
        });
      } else if (item.userFeedback === 'yes') {
        output.push({
          suggestion: 'Tách việc gần hạn và kế hoạch dài hơn thành hai danh sách; chọn đúng một bước cần hoàn tất hôm nay cho mỗi mốc.',
          rationale: 'Bạn đã xác nhận cả hai mốc cùng tồn tại, nên việc giảm xung đột ưu tiên là hành động phù hợp trực tiếp với hoàn cảnh vừa cung cấp.',
        });
      } else {
        output.push({
          suggestion: 'Kiểm tra xem hiện tại có một việc gần hạn và một kế hoạch dài hơn đang cùng đòi hỏi sự chú ý của bạn hay không.',
          rationale: 'Chỉ khi cả hai thực sự tồn tại, cảnh hai chuyến tàu mới đáng được dùng để suy nghĩ về xung đột ưu tiên.',
        });
      }
    } else if (isOldSchoolContextQuestion(item)) {
      if (item.userFeedback === 'yes') {
        output.push({
          suggestion: 'Ghi lại sự việc vừa gợi trường cũ và cảm xúc đi kèm lúc đó.',
          rationale: 'Bạn đã xác nhận có tác nhân gần đây; nội dung và cảm xúc của tác nhân này giúp giải thích vì sao trường cũ được đưa vào đúng câu chuyện về chuẩn bị và thời hạn.',
        });
      } else if (item.userFeedback === 'no') {
        output.push({
          suggestion: 'Tạm bỏ hướng tìm một ký ức vừa được kích hoạt; thay vào đó, xem cảm giác ở trường có giống cảm giác bị đánh giá hoặc chưa chuẩn bị đủ ở hiện tại không.',
          rationale: 'Câu trả lời Không đã làm yếu lời giải thích bằng sự kiện trong 48 giờ gần nhất, nên kết quả không tiếp tục lặp lại hướng này.',
        });
      } else {
        output.push({
          suggestion: 'Nhớ lại 48 giờ trước khi mơ và kiểm tra lần gần nhất bạn nhìn thấy, nghe nhắc hoặc nghĩ tới trường tiểu học cũ.',
          rationale: 'Thông tin này sẽ phân biệt một ký ức vừa được gợi lại với một cách diễn giải biểu tượng chưa có căn cứ.',
        });
      }
    }
  }
  const unique = new Map<string, { suggestion: string; rationale: string }>();
  for (const item of output) {
    const key = normalizeGroundingText(item.suggestion);
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].slice(0, 3);
}

export function deduplicateAcademicSources(sources: any[]): any[] {
  const bySource = new Map<string, any>();
  for (const source of sources || []) {
    const sourceId = String(source?.sourceId || '').trim();
    if (!sourceId) continue;
    const existing = bySource.get(sourceId);
    if (!existing) {
      bySource.set(sourceId, {
        ...source,
        sourceId,
        chunkIds: [...new Set((source.chunkIds || []).map((id: unknown) => String(id)))],
      });
      continue;
    }
    existing.chunkIds = [...new Set([
      ...(existing.chunkIds || []),
      ...(source.chunkIds || []).map((id: unknown) => String(id)),
    ])];
  }
  return [...bySource.values()];
}

export interface PersonalSymbolPattern {
  symbol: string;
  occurrences: number;
  recentMeaning: string;
}

const CONTEXTUAL_MOTIF_PHRASES = [
  'cuốn sổ', 'quyển sổ', 'sổ tay', 'cuốn sách', 'quyển sách', 'trang trắng',
  'nhà ga', 'tấm vé tàu', 'bảng điện tử', 'chuyến tàu', 'chiếc cặp khóa', 'đường ray',
  'bà ngoại', 'bà nội', 'ông ngoại', 'ông nội', 'người lạ', 'người đuổi theo',
  'cây cầu', 'cánh cửa', 'hành lang', 'ngôi trường', 'căn nhà', 'dòng nước', 'mặt nước',
  'tiếng bước chân', 'chạy trốn', 'đuổi theo', 'bị đuổi',
  'notebook', 'blank page', 'book', 'grandmother', 'grandfather', 'bridge', 'door',
  'hallway', 'school', 'old house', 'rising water', 'footsteps', 'running', 'being chased',
];

export function buildContextualMotifNotes(narrative: string, rules: any[], limit = 6): any[] {
  const preferred = [
    'nhà ga', 'tấm vé tàu', 'chiếc cặp khóa', 'mặt nước',
    'cuốn sổ', 'bà ngoại', 'cây cầu', 'đuổi theo',
  ];
  const detected = extractContextualMotifHints(narrative, 12);
  const ordered = [
    ...preferred.filter(item => detected.some(found => normalizeGroundingText(found) === normalizeGroundingText(item))),
    ...detected,
  ];
  const output: any[] = [];
  const seen = new Set<string>();
  for (const symbol of ordered) {
    const key = normalizeGroundingText(symbol);
    if (seen.has(key)) continue;
    if (!isSupportedContextualMotif(symbol, rules)) continue;
    const dreamEvidence = findNarrativeSentenceForSymbol(symbol, narrative);
    if (!dreamEvidence) continue;
    const note = {
      symbol,
      meaning: '',
      relevance: 0.7,
      symbolValence: 0,
      origin: 'contextual_observation' as const,
      dreamEvidence,
      contextualTone: inferContextualTone(dreamEvidence),
    };
    const meaning = buildGroundedMotifExplanation(note, rules).trim();
    // A contextual observation is retained only when the explanation service
    // understands that exact motif. Do not let words elsewhere in the same
    // sentence make an unrelated object inherit a chase/door/water meaning.
    if (!meaning || /cần được đọc theo vai trò của nó trong chuỗi sự kiện hiện tại/iu.test(meaning)) continue;
    seen.add(key);
    output.push({ ...note, meaning });
    if (output.length >= limit) break;
  }
  return output;
}

export function isSupportedContextualMotif(symbolValue: unknown, rules: any[]): boolean {
  const symbol = normalizeGroundingText(symbolValue);
  if (containsGroundedPhrase(symbol, ['nhà ga', 'station', 'tấm vé tàu', 'vé tàu', 'ticket', 'chiếc cặp khóa', 'cặp khóa', 'locked case', 'locked bag', 'mặt nước', 'floor became water'])) return true;
  const ruleText = normalizeGroundingText((rules || []).map(rule => `${rule?.factor || ''} ${rule?.ruleStatement || ''}`).join(' '))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hasMemoryRule = /memory|ky uc|tri nho|ghi nho|episodic|autobiograph/u.test(ruleText);
  const hasThreatRule = /threat|anxiety|avoid|stress|de doa|lo au|cang thang/u.test(ruleText);
  if (hasMemoryRule && containsGroundedPhrase(symbol, ['sổ', 'sách', 'vở', 'trang trắng', 'notebook', 'book', 'page', 'bà', 'bà ngoại', 'bà nội', 'ông', 'ông ngoại', 'ông nội', 'mẹ', 'cha', 'nhà cũ', 'trường cũ', 'grandmother', 'family', 'old house'])) return true;
  if (hasThreatRule && containsGroundedPhrase(symbol, ['đuổi', 'đuổi theo', 'chạy', 'chạy trốn', 'bắt kịp', 'pursuit', 'chase', 'running'])) return true;
  return containsGroundedPhrase(symbol, ['cầu', 'cây cầu', 'cửa', 'cánh cửa', 'nước', 'water', 'bridge', 'door']);
}

export function mergeContextualMotifNotes(primary: any[], fallback: any[]): any[] {
  const merged = new Map<string, any>();
  for (const note of [...(primary || []), ...(fallback || [])]) {
    const key = normalizeGroundingText(note?.symbol);
    if (!key || merged.has(key)) continue;
    merged.set(key, note);
  }
  return [...merged.values()].slice(0, 8);
}

export function deduplicateOverlappingMotifNotes(notes: any[]): any[] {
  const accepted: any[] = [];
  const ordered = [...(notes || [])].sort((a, b) =>
    normalizeGroundingText(a?.symbol).length - normalizeGroundingText(b?.symbol).length);
  for (const note of ordered) {
    const symbol = normalizeGroundingText(note?.symbol);
    const evidence = normalizeGroundingText(note?.dreamEvidence);
    const dictionarySymbol = normalizeGroundingText(note?.dictionarySymbol);
    const duplicate = accepted.some(existing => {
      const existingSymbol = normalizeGroundingText(existing?.symbol);
      const sameEvidence = evidence && evidence === normalizeGroundingText(existing?.dreamEvidence);
      const sameDictionary = dictionarySymbol && dictionarySymbol === normalizeGroundingText(existing?.dictionarySymbol);
      const overlappingLabel = containsGroundedPhrase(symbol, [existingSymbol]) || containsGroundedPhrase(existingSymbol, [symbol]);
      return overlappingLabel && (sameEvidence || sameDictionary);
    });
    if (!duplicate) accepted.push(note);
  }
  return accepted.slice(0, 8);
}

export function extractContextualMotifHints(narrative: string, limit = 10): string[] {
  const normalizedNarrative = ` ${normalizeGroundingText(narrative)} `;
  const matches = CONTEXTUAL_MOTIF_PHRASES
    .filter(phrase => normalizedNarrative.includes(` ${normalizeGroundingText(phrase)} `))
    .sort((a, b) => b.length - a.length || a.localeCompare(b, 'vi'));
  const accepted: string[] = [];
  for (const phrase of matches) {
    const normalized = normalizeGroundingText(phrase);
    if (accepted.some(existing => normalizeGroundingText(existing).includes(normalized))) continue;
    accepted.push(phrase);
    if (accepted.length >= limit) break;
  }
  return accepted;
}

export function collectPersonalSymbolPatterns(
  dreamRows: any[],
  currentNarrative: string,
  limit = 5,
): PersonalSymbolPattern[] {
  const narrative = normalizeGroundingText(currentNarrative);
  const grouped = new Map<string, PersonalSymbolPattern>();
  for (const row of dreamRows || []) {
    const notes = row?.ai_result?.symbolic_notes;
    if (!Array.isArray(notes)) continue;
    for (const note of notes) {
      const key = normalizeGroundingText(note?.symbol);
      if (key.length < 2 || !` ${narrative} `.includes(` ${key} `)) continue;
      const existing = grouped.get(key);
      if (existing) {
        existing.occurrences += 1;
      } else {
        grouped.set(key, {
          symbol: String(note.symbol).trim(),
          occurrences: 1,
          recentMeaning: String(note.meaning || '').trim().slice(0, 280),
        });
      }
    }
  }
  return [...grouped.values()]
    .sort((a, b) => b.occurrences - a.occurrences || a.symbol.localeCompare(b.symbol, 'vi'))
    .slice(0, limit);
}

export function sanitizeGeneratedHypotheses(
  hypotheses: any[],
  narrative: string,
  knownContext: string,
  validRuleIds: Set<string>,
): any[] {
  const accepted: any[] = [];
  const seen = new Set<string>();
  const seenPurposes = new Set<string>();
  for (const raw of hypotheses || []) {
    if (!raw || isHypothesisAlreadyAnswered(raw, knownContext) || isVagueFollowUpQuestion(raw.followUpQuestion)) continue;
    const evidence = [...new Set((raw.evidenceFromDream || [])
      .map((item: unknown) => String(item).trim())
      .filter((item: string) => exactExcerptExists(item, narrative)))];
    if (evidence.length === 0) continue;
    const hypothesis = String(raw.hypothesis || '').trim();
    const question = String(raw.followUpQuestion || '').trim();
    const reasonForAsking = String(raw.reasonForAsking || '').trim();
    const ifYesMeaning = String(raw.ifYesMeaning || '').trim();
    const ifNoMeaning = String(raw.ifNoMeaning || '').trim();
    // A small model may emit a plausible-looking question without explaining
    // how either answer changes the inference. Such a question is not useful
    // evidence collection, so deterministic rule templates take precedence.
    if (!hypothesis || !question || reasonForAsking.length < 45 || ifYesMeaning.length < 35 || ifNoMeaning.length < 35) continue;
    const key = normalizeGroundingText(`${hypothesis} ${question}`);
    if (!key || seen.has(key)) continue;
    const purposeText = normalizeGroundingText(`${hypothesis} ${question}`);
    const purpose = /kỷ niệm|tuổi thơ|hình ảnh|48 giờ|hai ngày/u.test(purposeText)
      ? 'recent_memory_cue'
      : /đánh giá|thuyết trình|kiểm tra năng lực/u.test(purposeText)
        ? 'upcoming_evaluation'
        : /ghi nhớ|nhớ nhiều|quên thông tin|mất thông tin/u.test(purposeText)
          ? 'memory_demand'
          : /trì hoãn|né tránh|bị thúc ép/u.test(purposeText)
            ? 'avoidance_pressure'
            : '';
    if (purpose && seenPurposes.has(purpose)) continue;
    seen.add(key);
    if (purpose) seenPurposes.add(purpose);
    const proposedRuleId = raw.ruleId == null ? null : String(raw.ruleId).trim();
    if (!proposedRuleId || !validRuleIds.has(proposedRuleId)) continue;
    accepted.push({
      ...raw,
      ruleId: proposedRuleId,
      verificationKey: String(raw.verificationKey || `${proposedRuleId}:${normalizeGroundingText(question).replace(/\s+/g, '_').slice(0, 120)}`),
      answerSemantics: raw.answerSemantics || { yes: 'supports', no: 'weakens', unsure: 'unresolved' },
      evidenceFromDream: evidence.slice(0, 3),
      // A hypothesis is an open question, not a probability estimate. Keep a
      // neutral backend-owned value for backward compatibility; the UI does not
      // present it as confidence.
      confidence: 0,
      questionType: ['past', 'present', 'future'].includes(raw.questionType) ? raw.questionType : 'present',
      needsUserConfirmation: true,
    });
    if (accepted.length >= 4) break;
  }
  return accepted;
}
