const EVIDENCE_CONCEPT_PATTERNS: RegExp[] = [
  /giấc mơ|trong mơ|mộng|dream|dreaming/iu,
  /giấc ngủ|khi ngủ|tỉnh giấc|sleep|awakening/iu,
  /ký ức|trí nhớ|mảnh nhớ|thời thơ ấu|memory|memories|childhood/iu,
  /khi thức|đời sống thức|trải nghiệm ban ngày|waking(?:-life)?|daytime experience/iu,
  /tương lai|sắp tới|dự kiến|nhiệm vụ tương lai|future|prospective|anticipated|upcoming/iu,
  /lo âu|lo lắng|căng thẳng|áp lực|sợ hãi|anxiety|stress|pressure|fear/iu,
  /sáng tạo|linh hoạt|ứng biến|tư duy phân kỳ|creative|flexib|improvis|divergent/iu,
  /giải quyết vấn đề|phương án|giải pháp|problem.solving|solution|alternative/iu,
];

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

export function normalizeOracleEvidenceText(value: string): string {
  return cleanOracleEvidenceClaim(value)
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
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

export function isResearchableOracleEvidenceClaim(claim: string): boolean {
  const clean = cleanOracleEvidenceClaim(claim);
  if (clean.length < 35 || /[?？]\s*$/u.test(clean)) return false;
  if (NON_CLAIM_PATTERNS.some((pattern) => pattern.test(clean))) return false;
  if (/tượng trưng|biểu tượng của|đại diện cho|ám chỉ/iu.test(clean)) return false;
  const canonical = canonicalizeOracleEvidenceClaim(clean);
  const wasGeneralized = normalizeOracleEvidenceText(canonical)
    !== normalizeOracleEvidenceText(clean);
  const caseNarrative = /\b(?:giấc mơ này|trong giấc mơ này|this dream|your dream)\b/iu.test(clean)
    || /^(?:giấc mơ|the dream)\s+(?:này\s+)?(?:thể hiện|phản ánh|cho thấy|gợi ý|reflects?|shows?|suggests?)\b/iu
      .test(clean);
  const caseAdvice = /(?:giấc mơ (?:đã )?cung cấp|manh mối|giải pháp (?:có thể )?nằm ở|dream (?:provides|offers)|the solution (?:may|might) lie)/iu
    .test(clean);
  if ((caseNarrative || caseAdvice) && !wasGeneralized) return false;
  if (clean.length > 360 && !wasGeneralized) return false;
  const personalized = /\b(?:bạn|của bạn|your)\b/iu.test(clean)
    && /phản ánh|cho thấy|minh họa|gợi ý|khuyến khích|reflect|suggest|indicat/iu.test(clean);
  if (personalized) return false;
  if (
    /\b(?:bạn|của bạn|you|your)\b/iu.test(clean)
    && normalizeOracleEvidenceText(canonical) === normalizeOracleEvidenceText(clean)
  ) return false;
  const caseSpecific = /^(?:trong mơ,?\s*)?việc\b|^hình ảnh\b/iu.test(clean)
    && /phản ánh|cho thấy|minh họa|gợi ý|reflect|suggest|illustrat|indicat/iu.test(clean);
  if (
    caseSpecific
    && normalizeOracleEvidenceText(canonical) === normalizeOracleEvidenceText(clean)
  ) return false;
  const value = normalizeOracleEvidenceText(clean);
  const dreamScience = /giấc mơ|trong mơ|giấc ngủ|tỉnh giấc|dream|dreaming|sleep|awakening/iu.test(value);
  const memoryMechanism = /não bộ|brain/iu.test(value)
    && /ký ức|trí nhớ|memory|memories/iu.test(value);
  const psychologicalMechanism = /lo lắng|căng thẳng|áp lực|anxiety|stress/iu.test(value)
    && /hành động|chuẩn bị|lập kế hoạch|giảm|giải tỏa|sáng tạo|action|planning|reduce|creative/iu.test(value);
  const relationText = `${value} ${normalizeOracleEvidenceText(canonical)}`;
  const relation = /liên quan|kết hợp|tái kết hợp|đưa vào|xử lý|sử dụng|tăng|giảm|dẫn đến|thúc đẩy|ảnh hưởng|phổ biến|xuất hiện|associated|related|combine|incorporat|process|increase|decrease|predict|affect|common|prevalen|frequen|occur/iu.test(relationText);
  const conceptCount = EVIDENCE_CONCEPT_PATTERNS.filter((pattern) => pattern.test(clean)).length;
  return relation
    && (dreamScience || memoryMechanism || psychologicalMechanism || conceptCount >= 2);
}

export function invalidateOracleCitationMarker(text: string, citationIndex: number): string {
  return keepResearchableMarker(
    text,
    new RegExp(`\\[${citationIndex}\\]`, 'gu'),
    '[?]',
  );
}

export function sanitizeOracleUnresolvedMarkers(text: string): string {
  return keepResearchableMarker(text, /\[\?\]/gu, '[?]');
}

export function canonicalizeOracleEvidenceClaim(claim: string): string {
  const clean = cleanOracleEvidenceClaim(claim);
  const value = normalizeOracleEvidenceText(clean);
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
  const insight = /bất ngờ|tìm ra giải pháp|khoảnh khắc sáng tỏ|surpris|insight|eureka/iu.test(value);
  const informationProcessing = /xử lý thông tin|information processing/iu.test(value);

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
  if (dream && insight && informationProcessing) {
    return vietnamese
      ? 'Xử lý thông tin trong giấc ngủ có thể liên quan đến cảm giác sáng tỏ hoặc bất ngờ khi tỉnh dậy.'
      : 'Information processing during sleep may be associated with insight or surprise upon awakening.';
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

function keepResearchableMarker(
  text: string,
  marker: RegExp,
  researchableMarker: string,
): string {
  const updated = text.replace(marker, (_match, offset: number) => {
    const prefix = text.slice(0, offset).trimEnd();
    const beforePunctuation = /[.!?？]$/u.test(prefix) ? prefix.slice(0, -1) : prefix;
    const boundary = Math.max(
      beforePunctuation.lastIndexOf('\n'),
      beforePunctuation.lastIndexOf('. '),
      beforePunctuation.lastIndexOf('! '),
      beforePunctuation.lastIndexOf('? '),
    );
    const surroundingClaim = prefix.slice(boundary + 1).trim();
    return isResearchableOracleEvidenceClaim(surroundingClaim) ? researchableMarker : '';
  });
  return updated
    .replace(/[ \t]+([.,!?;:])/gu, '$1')
    .replace(/[ \t]{2,}/gu, ' ');
}
