import type { resolveOracleModelAdapter } from '../providers/oracleProviderResolver.service';
import type { OracleExecutionMode } from '../providers/oraclePrompt.service';

export function directAnswerSuggestions(answer: string): string[] {
  const finalQuestion = extractFinalQuestion(answer);
  if (!finalQuestion || !isYesNoQuestion(finalQuestion)) return [];
  if (!/[ăâđêôơưà-ỹ]/iu.test(finalQuestion)) {
    return /(?:would you like|do you want)/iu.test(finalQuestion)
      ? ['Yes, I would like to try.', 'No, not right now.', 'I am not sure; help me take the first step.']
      : ['Yes, that fits me.', 'No, that does not fit me.', 'I am not sure yet.'];
  }
  return vietnameseAnswerSuggestions(finalQuestion);
}

export function prioritizeOracleSuggestions(input: {
  answer: string;
  generated: string[];
  mode: OracleExecutionMode;
  vietnamese: boolean;
}): string[] {
  const quickReplies = directAnswerSuggestions(input.answer);
  const continuation = input.vietnamese
    ? 'Hãy viết tiếp phần sau của giấc mơ này.'
    : 'Continue the next part of this dream.';
  const ordered = input.mode === 'dream_analysis'
    ? [...quickReplies, continuation, ...input.generated]
    : input.mode === 'creative_continuation'
      ? [continuation, ...quickReplies, ...input.generated]
      : [...quickReplies, ...input.generated];
  return [...new Set(ordered.map((item) => item.replace(/\s+/gu, ' ').trim()).filter(Boolean))]
    .slice(0, 6);
}

export async function generateFallbackSuggestions(input: {
  adapter: Awaited<ReturnType<typeof resolveOracleModelAdapter>>;
  model: string;
  signal: AbortSignal;
  userText: string;
  answer: string;
  languageHint: string;
}): Promise<string[]> {
  let bestSuggestions: string[] = [];
  for (const responseFormat of ['json', undefined] as const) {
    try {
      const raw = await requestSuggestions(input, responseFormat);
      const suggestions = parseSuggestions(raw);
      if (suggestions.length >= 2) return suggestions;
      if (suggestions.length > bestSuggestions.length) bestSuggestions = suggestions;
    } catch {
      // Retry plain-text mode because some compatible providers reject response_format.
    }
  }
  return [...new Set([...bestSuggestions, ...defaultUserSuggestions(input)])].slice(0, 4);
}

function extractFinalQuestion(answer: string): string | null {
  const cleanAnswer = answer.replace(/\s+$/u, '');
  const questionEnd = cleanAnswer.lastIndexOf('?');
  if (questionEnd < 0 || cleanAnswer.slice(questionEnd + 1).trim()) return null;
  const beforeQuestion = cleanAnswer.slice(0, questionEnd);
  const questionStart = Math.max(
    beforeQuestion.lastIndexOf('\n'),
    beforeQuestion.lastIndexOf('.'),
    beforeQuestion.lastIndexOf('!'),
    beforeQuestion.lastIndexOf('?'),
  ) + 1;
  const question = cleanAnswer.slice(questionStart, questionEnd + 1)
    .replace(/[*_~`]+/gu, '')
    .trim();
  return question.length >= 3 && question.length <= 500 ? question : null;
}

function isYesNoQuestion(question: string): boolean {
  const vietnamese = /(?:bạn\s+có(?:\s+(?:nhận\s+thấy|cảm\s+thấy|nghĩ|cho\s+rằng))?|có\s+phải|có\s+đúng|có\s+cảm\s+thấy|phải\s+không|đúng\s+không)/iu
    .test(question);
  const english = /(?:\bdo you\b|\bare you\b|\bis (?:it|that|this)\b|\bwould you\b)/iu
    .test(question);
  return vietnamese || english;
}

function vietnameseAnswerSuggestions(question: string): string[] {
  if (/bạn\s+có\s+muốn/iu.test(question)) {
    if (/phác\s+thảo/iu.test(question)) {
      return [
        'Có, tôi muốn thử phác thảo ý tưởng đó.',
        'Không, lúc này tôi chưa muốn phác thảo.',
        'Tôi chưa biết bắt đầu từ đâu; hãy gợi ý bước đầu tiên.',
      ];
    }
    if (/chia\s+sẻ|kể|mô\s+tả/iu.test(question)) {
      return [
        'Có, tôi muốn chia sẻ thêm.',
        'Không, lúc này tôi chưa muốn chia sẻ thêm.',
        'Tôi chưa biết nên bắt đầu từ chi tiết nào.',
      ];
    }
    return [
      'Có, tôi muốn thử.',
      'Không, lúc này tôi chưa muốn thử.',
      'Tôi chưa chắc; hãy giúp tôi chọn bước đầu tiên.',
    ];
  }
  if (/bạn\s+có\s+thể/iu.test(question)) {
    return [
      'Có, tôi có thể làm điều đó.',
      'Không, hiện tại tôi chưa thể.',
      'Tôi chưa chắc mình nên bắt đầu thế nào.',
    ];
  }
  if (/bạn\s+có\s+cảm\s+thấy/iu.test(question)) {
    return [
      'Có, tôi có cảm thấy như vậy.',
      'Không, tôi không cảm thấy như vậy.',
      'Tôi chưa chắc mình có cảm thấy như vậy không.',
    ];
  }
  if (/bạn\s+có\s+nhận\s+thấy/iu.test(question)) {
    return [
      'Có, tôi có nhận thấy điều đó.',
      'Không, tôi chưa nhận thấy điều đó.',
      'Tôi chưa chắc mình có nhận thấy điều đó không.',
    ];
  }
  if (/bạn\s+có\s+(?:nghĩ|cho\s+rằng)/iu.test(question)) {
    return [
      'Có, tôi cũng nghĩ như vậy.',
      'Không, tôi không nghĩ như vậy.',
      'Tôi chưa chắc; tôi muốn xem xét thêm.',
    ];
  }
  const clause = question.match(/bạn\s+có\s+([\s\S]+?)(?:\s+không)?\?$/iu)?.[1]
    ?.replace(/\bcủa\s+mình\b/giu, 'của tôi')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!clause) return ['Có.', 'Không.', 'Tôi chưa chắc.'];
  const conciseClause = /một\s+việc\s+quan\s+trọng/iu.test(clause)
    ? 'một việc quan trọng như vậy'
    : /buổi\s+(?:họp|trình\s+bày)/iu.test(clause)
      ? 'một buổi họp hoặc trình bày như vậy'
      : clause.length <= 115 ? clause : 'hoàn cảnh đó';
  return [
    `Có, tôi có ${conciseClause}.`,
    `Không, tôi không có ${conciseClause}.`,
    `Tôi chưa chắc mình có ${conciseClause} hay không.`,
  ];
}

async function requestSuggestions(
  input: Parameters<typeof generateFallbackSuggestions>[0],
  responseFormat?: 'json',
): Promise<string> {
  let raw = '';
  await input.adapter.generate({
    model: input.model,
    signal: input.signal,
    contextWindow: 4096,
    maxOutputTokens: 300,
    ...(responseFormat ? { responseFormat } : {}),
    messages: [
      {
        role: 'system',
        content: [
          `Write in ${input.languageHint}.`,
          'Generate 2 to 4 concrete one-click follow-up messages that this user would genuinely want to send next.',
          'Write every item as the USER speaking to Oracle, never as Oracle speaking to or questioning the user.',
          'Prefer a direct request such as "Explain the other meanings with examples" or a first-person reply such as "I am not sure yet."',
          'Do not write offers such as "Would you like me to...", advice beginning with "If you want...", or clarification questions aimed at the user.',
          'Every item must build on a specific detail in the supplied exchange, be useful or intriguing, and differ in purpose.',
          'Never ask the user to repeat information already supplied.',
          'Never invent an experience, decision, preference, feeling, event, or biographical fact on the user’s behalf.',
          'If Oracle asked an open question requiring personal facts, offer short reply intents or uncertainty instead of fabricating a complete answer.',
          'Each item must be at most 110 characters and easy to understand at a glance.',
          'Return exactly one JSON object with this shape: {"suggestions":["...", "..."]}. Do not use Markdown or explanatory text.',
        ].join(' '),
      },
      {
        role: 'user',
        content: `USER MESSAGE:\n${input.userText.slice(-4_000)}\n\nORACLE ANSWER:\n${input.answer.slice(-8_000)}`,
      },
    ],
    onText: async (text) => { raw += text; },
  });
  return raw;
}

function parseSuggestions(raw: string): string[] {
  const json = raw.match(/\{[\s\S]*\}/u)?.[0] || raw.match(/\[[\s\S]*\]/u)?.[0];
  if (!json) return [];
  const parsed = JSON.parse(json);
  const suggestions = Array.isArray(parsed) ? parsed : parsed?.suggestions;
  if (!Array.isArray(suggestions)) return [];
  return [...new Set(suggestions
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/\s+/gu, ' ').trim())
    .filter((item) => item.length >= 2 && item.length <= 110)
    .filter(isUserAuthoredSuggestion))]
    .slice(0, 4);
}

// Rejects suggestions written in Oracle's voice instead of the user's voice.
function isUserAuthoredSuggestion(suggestion: string): boolean {
  const assistantVoice = [
    /(?:^|[.!?]\s*)bạn\s+có\s+muốn\s+(?:mình|tôi)\b/iu,
    /(?:^|[.!?]\s*)bạn\s+đang\s+(?:muốn|tìm|hỏi|quan\s+tâm|đề\s+cập)\b[\s\S]*\?$/iu,
    /^nếu\s+bạn\s+(?:muốn|thích|cần|quan\s+tâm)\b/iu,
    /^tôi\s+(?:chưa|không)\s+rõ(?:\s|[,.:;!?])[\s\S]*bạn(?:\s|[,.:;!?]|$)/iu,
    /(?:^|[.!?]\s*)would\s+you\s+like\s+me\s+to\b/iu,
    /(?:^|[.!?]\s*)are\s+you\s+(?:trying|looking|asking|interested)\b[\s\S]*\?$/iu,
    /^if\s+you\s+(?:want|like|need|are\s+interested)\b/iu,
    /^i(?:'m|\s+am)\s+not\s+sure\b[\s\S]*\byou\b/iu,
  ];
  return !assistantVoice.some((pattern) => pattern.test(suggestion));
}

function defaultUserSuggestions(
  input: Parameters<typeof generateFallbackSuggestions>[0],
): string[] {
  const vietnamese = /[ăâđêôơưà-ỹ]/iu.test(input.userText)
    || input.languageHint.toLocaleLowerCase().includes('vietnamese');
  const definitionTarget = input.userText
    .match(/^(.{1,60}?)\s+(?:là|nghĩa\s+là)\s+gì\s*[?.!]*$/iu)?.[1]
    ?.trim();
  if (vietnamese && definitionTarget) {
    return [
      `Giải thích các nghĩa phổ biến của “${definitionTarget}” và cho ví dụ.`,
      `“${definitionTarget}” có nghĩa gì trong tiếng lóng hoặc trên Internet?`,
      `So sánh nghĩa của “${definitionTarget}” trong các ngữ cảnh khác nhau.`,
    ];
  }
  const englishDefinitionTarget = input.userText
    .match(/^what\s+(?:does|is)\s+(.{1,60}?)(?:\s+mean)?\s*[?.!]*$/iu)?.[1]
    ?.trim();
  if (!vietnamese && englishDefinitionTarget) {
    return [
      `Explain the common meanings of “${englishDefinitionTarget}” with examples.`,
      `What does “${englishDefinitionTarget}” mean in Internet slang?`,
      `Compare how “${englishDefinitionTarget}” is used in different contexts.`,
    ];
  }
  return vietnamese
    ? [
      'Giải thích rõ hơn ý chính vừa nêu.',
      'Cho tôi một ví dụ cụ thể.',
      'Có cách hiểu nào khác không?',
    ]
    : [
      'Explain the main point more clearly.',
      'Give me a concrete example.',
      'Are there other ways to understand this?',
    ];
}
