import type { OracleCitation } from '../oracle.types';
import type { buildOracleGrounding } from '../grounding/oracleGrounding.service';

export function finalizeModelAnswer(rawText: string): { answer: string; suggestions: string[] } {
  const marker = rawText.match(/<oracle_suggestions>\s*(\[[\s\S]*?\])\s*(?:<\/oracle_suggestions>)?\s*$/iu);
  let suggestions: string[] = [];
  if (marker) {
    try {
      const parsed = JSON.parse(marker[1]);
      if (Array.isArray(parsed)) {
        suggestions = [...new Set(parsed
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.replace(/\s+/gu, ' ').trim())
          .filter((item) => item.length >= 2 && item.length <= 110))]
          .slice(0, 4);
      }
    } catch {
      suggestions = [];
    }
  }
  const withoutMarker = marker
    ? rawText.slice(0, marker.index).trim()
    : rawText.replace(/<oracle_suggestions>[\s\S]*$/iu, '').trim();
  const answer = withoutMarker
    .replace(
      /^(?:\*\*)?Cảnh báo:(?:\*\*)?[^\n]*(?:khớp|trùng)[^\n]*\n+(?:Do đó,[^\n]*\n+)?/iu,
      '',
    )
    .trim();
  return { answer, suggestions };
}

export function markUnsupportedInterpretations(answer: string): string {
  const inferencePattern = /\b(?:có thể|có vẻ|gợi ý|cho thấy|phản ánh|đại diện cho|tượng trưng|hàm ý|khả năng|may|might|could|suggests?|indicates?|reflects?|represents?|symboli[sz]es?|likely)\b/iu;
  return answer.split('\n').map((line) => {
    if (!line.trim() || /^\s*(?:#{1,4}|\d+[.)]|[-*])?\s*[^.!?]{0,80}:?\s*$/u.test(line)) return line;
    if (/\[(?:\d+|\?)\]/u.test(line) || !inferencePattern.test(line)) return line;
    const punctuation = line.match(/([.!?])(\s*)$/u);
    return punctuation
      ? `${line.slice(0, -punctuation[0].length)} [?]${punctuation[1]}${punctuation[2]}`
      : `${line} [?]`;
  }).join('\n');
}

export function ensureRuleBackedFinalQuestion(
  answer: string,
  verificationQuestions: Array<{
    question: string;
    localizedQuestion?: { vi: string; en: string };
    citationIndex: number;
  }>,
  vietnamese: boolean,
): string {
  const answerWithoutStaleVerification = removeTrailingVerificationQuestion(answer);
  const usedCitationIndices = collectUsedCitationIndices(answerWithoutStaleVerification);
  const selected = verificationQuestions.find((item) =>
    item.question.trim() && usedCitationIndices.has(item.citationIndex));
  if (!selected) return answerWithoutStaleVerification;

  const selectedQuestion = (
    vietnamese ? selected.localizedQuestion?.vi : selected.localizedQuestion?.en
  )?.trim() || selected.question.trim();
  const prefix = vietnamese
    ? `Để kiểm tra cách lập luận [${selected.citationIndex}] áp dụng vào trường hợp này:`
    : `To test whether argument [${selected.citationIndex}] applies to this case:`;
  return `${answerWithoutStaleVerification}\n\n${prefix} ${selectedQuestion}`;
}

function removeTrailingVerificationQuestion(answer: string): string {
  return answer
    .replace(
      /\n{2,}\*{0,2}(?:Để kiểm tra cách lập luận|To test whether argument)\b[\s\S]{0,700}\?\*{0,2}\s*$/iu,
      '',
    )
    .trim();
}

function collectUsedCitationIndices(answer: string): Set<number> {
  return new Set(
    [...answer.matchAll(/\[(\d+)\]/gu)]
      .map((match) => Number(match[1]))
      .filter(Number.isInteger),
  );
}

export function compactUsedCitations(
  fullText: string,
  citations: OracleCitation[],
): { text: string; citations: OracleCitation[] } {
  const citationsByIndex = new Map(citations.map((citation) => [citation.index, citation]));
  const remapped = new Map<number, number>();
  const ordered: OracleCitation[] = [];
  const text = fullText.replace(/\[(\d+)\]/gu, (marker, rawIndex: string) => {
    const oldIndex = Number(rawIndex);
    const citation = citationsByIndex.get(oldIndex);
    if (!citation) return marker;
    let nextIndex = remapped.get(oldIndex);
    if (!nextIndex) {
      nextIndex = ordered.length + 1;
      remapped.set(oldIndex, nextIndex);
      ordered.push({ ...citation, index: nextIndex });
    }
    return `[${nextIndex}]`;
  });
  return { text, citations: ordered };
}

export function ensurePersonalContextCitation(
  answer: string,
  grounding: Awaited<ReturnType<typeof buildOracleGrounding>>,
): string {
  const context = grounding.personalContext;
  if (!context || answer.includes(`[${context.citationIndex}]`)) return answer;
  const vietnamese = /[ăâđêôơưà-ỹ]/iu.test(answer);
  const duplicateNote = context.duplicateCount > 1
    ? (vietnamese
      ? ` Bản này đại diện cho ${context.duplicateCount} bản ghi có cùng lời kể; chúng không được tính như nhiều bằng chứng độc lập.`
      : ` It represents ${context.duplicateCount} saved copies of the same narrative, not independent evidence.`)
    : '';
  const comparison = vietnamese
    ? `Liên hệ với lịch sử của bạn: lời kể hiện tại ${context.exact ? 'trùng nội dung' : 'rất gần'} với “${context.title}” đã lưu trước đó [${context.citationIndex}]. Tôi dùng bản ghi này để giữ mạch phân tích cá nhân, không xem nó là bằng chứng khoa học.${duplicateNote}`
    : `Connection to your history: this account ${context.exact ? 'matches' : 'closely resembles'} your previously saved “${context.title}” [${context.citationIndex}]. I use that record to preserve personal continuity, not as scientific evidence.${duplicateNote}`;
  const lines = answer.trimEnd().split('\n');
  let insertionIndex = lines.length;
  while (insertionIndex > 0 && !lines[insertionIndex - 1].trim()) insertionIndex -= 1;
  if (insertionIndex > 0 && lines[insertionIndex - 1].trim().endsWith('?')) insertionIndex -= 1;
  lines.splice(insertionIndex, 0, comparison, '');
  return lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}
