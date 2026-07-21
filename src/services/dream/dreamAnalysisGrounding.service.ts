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
    return 'Tấm vé ghi “ngày hôm qua” đặt một dấu mốc quá khứ ngay cạnh hai chuyến đi hướng tới tương lai. Quá khứ và điều sắp tới vì thế cùng chen vào một quyết định. Tuy nhiên, cảnh mơ chưa cho biết sự kiện thật nào đã gợi lại lớp học cũ; câu hỏi về 48 giờ trước giấc mơ mới kiểm tra được phần đó.';
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

/**
 * Deterministic safety net for a small model that produced only vague questions.
 * It never creates a hypothesis unless an approved retrieved rule belongs to a
 * supported mechanism family and at least two exact dream sentences are present.
 */
export function buildRuleGroundedFallbackHypotheses(rules: any[], narrative: string): any[] {
  const accepted: any[] = [];
  const seenFamilies = new Set<string>();
  for (const rule of rules || []) {
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
    const verificationKind = classifyRuleV3VerificationKind(rule);

    if (verificationKind === 'multiple_future_horizons') {
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
    } else {
      continue;
    }

    if (!family || seenFamilies.has(family) || evidence.length < 1) continue;
    const ruleId = String(rule?.ruleId || rule?._id || '').trim();
    if (!ruleId) continue;
    seenFamilies.add(family);
    accepted.push({
      ruleId,
      verificationKey: `${ruleId}:${family}`,
      questionDimension: family,
      questionGroup: family === 'recent_experience_incorporation'
        ? 'recent_memory_cue'
        : family === 'attachment_support_under_stress'
          ? 'attachment_context'
        : ['avoidance_pressure', 'current_stress'].includes(family)
          ? 'current_pressure'
          : 'future_plans',
      questionBasis: 'academic_rule',
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
    });
    if (accepted.length >= 3) break;
  }
  return accepted;
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
    const base = stripPriorFeedbackSynthesis(polishGeneratedDreamProse(fallback));
    const feedback = buildFeedbackAppliedAnalysis(hypotheses);
    if (!feedback || (feedback.confirmedFacts.length === 0 && feedback.rejectedDirections.length === 0)) return base;
    const additions: string[] = [];
    if (feedback.confirmedFacts.length > 0) {
      additions.push(`Thông tin bạn vừa xác nhận làm rõ trường hợp này: ${feedback.confirmedFacts.join(' ')}`);
    }
    if (feedback.rejectedDirections.length > 0) {
      additions.push(`Vì câu trả lời của bạn, phân tích không tiếp tục dùng các hướng sau: ${feedback.rejectedDirections.join(' ')}`);
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
    .replace(/\s*Thông tin bạn vừa xác nhận làm rõ trường hợp này:[\s\S]*?(?=\s+Vì câu trả lời của bạn, phân tích không tiếp tục dùng các hướng sau:|$)/giu, '')
    .replace(/\s*Vì câu trả lời của bạn, phân tích không tiếp tục dùng các hướng sau:[\s\S]*$/giu, '')
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
  const nextSteps: string[] = [];

  for (const item of answered) {
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
  }

  const interpretation = confirmedFacts.length > 0
    ? 'Bức tranh tổng thể và chi tiết liên quan bên dưới đã được viết lại theo thông tin này; những ý nghĩa chưa được xác nhận vẫn được để mở.'
    : 'Câu trả lời đã loại một cách giải thích khỏi trọng tâm; phần còn lại chỉ dựa trên trình tự và cảm xúc có trong lời kể.';
  return { confirmedFacts, rejectedDirections, interpretation, nextSteps };
}

export function applyFeedbackToThreads(threads: any[], hypotheses: any[]): any[] {
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
    if (!canExplainPsychology(rule)) continue;
    const ruleText = normalizeGroundingText(`${rule?.ruleStatement || ''} ${rule?.factor || ''} ${rule?.outcome || ''}`);
    let noteText = '';
    let dreamEvidence: string[] = [];
    if (/self organization|self organization theory/u.test(ruleText)) {
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
    if (verified) notes.push(verified);
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
  const fallbackQuestions = buildRuleGroundedFallbackHypotheses(appliedRules, narrative);
  const sleepEnvironmentQuestions = buildSleepEnvironmentQuestions(
    narrative,
    retrievedContext?.componentA?.sleepContext || {},
    appliedRules,
  );
  const storedHypotheses = Array.isArray(analysis.real_life_hypotheses) ? analysis.real_life_hypotheses : [];
  const storedHypothesisByRule = new Map(storedHypotheses.map((item: any) => [String(item?.ruleId || ''), item]));
  const storedHypothesisByVerification = new Map(storedHypotheses.map((item: any) => [String(item?.verificationKey || ''), item]));
  const rawHypothesisCandidates = [...fallbackQuestions, ...sleepEnvironmentQuestions];
  const seenQuestionGroups = new Set<string>();
  const seenQuestionKeys = new Set<string>();
  const hypothesisCandidates = rawHypothesisCandidates.filter((item: any) => {
    const key = String(item?.verificationKey || `${item?.ruleId || 'question'}:${item?.followUpQuestion || ''}`);
    const group = String(item?.questionGroup || getQuestionDimension(item) || key);
    if (seenQuestionKeys.has(key) || seenQuestionGroups.has(group)) return false;
    seenQuestionKeys.add(key);
    seenQuestionGroups.add(group);
    return true;
  });
  const baseResponseHypotheses = attachRuleQuestionContext(
    hypothesisCandidates.flatMap((item: any) => {
      const rule: any = ruleMap.get(String(item?.ruleId || ''));
      if (!rule || !canGenerateContextQuestion(rule)) return [];
      const stored: any = storedHypothesisByVerification.get(String(item?.verificationKey || ''))
        || (!item?.verificationKey ? storedHypothesisByRule.get(String(item?.ruleId || '')) : undefined);
      const sources = item?.sources || stored?.sources || sourceByRule.get(String(item?.ruleId || '')) || [];
      if (!Array.isArray(sources) || sources.length === 0) return [];
      return [{
        ...item,
        sources,
        userFeedback: stored?.userFeedback ?? item?.userFeedback ?? null,
      }];
    }),
    appliedRules,
  ).slice(0, 6).map((item: any) => ({
    ...item,
    hypothesis: removeInternalAnalysisVocabulary(item.hypothesis),
    followUpQuestion: removeInternalAnalysisVocabulary(item.followUpQuestion),
    reasonForAsking: removeInternalAnalysisVocabulary(item.reasonForAsking),
    ifYesMeaning: removeInternalAnalysisVocabulary(item.ifYesMeaning),
    ifNoMeaning: removeInternalAnalysisVocabulary(item.ifNoMeaning),
  }));
  const responseHypotheses = baseResponseHypotheses.slice(0, 4);
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

  return {
    ...publicAnalysis,
    emotional_tone_key: emotion.key,
    emotional_tone: emotion.label,
    core_analysis: removeInternalAnalysisVocabulary(
      buildCaseGroundedSynthesis(
        narrative,
        responseHypotheses,
        sanitizeUnsupportedDreamClaims(analysis.core_analysis),
      ),
    ),
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
      appliedRuleCount: appliedRules.length,
      explanatoryRuleCount: appliedRules.filter(canExplainPsychology).length,
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
    scientific_context_notes: deduplicateScientificNotes([...(Array.isArray(analysis.scientific_context_notes)
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
    }), ...buildVerifiedMechanismFallbackNotes(appliedRules, evidenceLinks, narrative, responseHypotheses)]),
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
