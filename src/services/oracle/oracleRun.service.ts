import { Types } from 'mongoose';
import OracleRun, { type IOracleRun } from '../../models/OracleRun';
import OracleRunEvent, { OracleRunEventType } from '../../models/OracleRunEvent';
import OracleThread from '../../models/OracleThread';
import OracleTurn from '../../models/OracleTurn';
import { ORACLE_RUN_EVENT_RETENTION_MS } from '../../config/oracleConfig';
import type { OracleCitation } from './oracle.types';
import { buildOracleGrounding } from './oracleRetrieval.service';
import { resolveOracleModelAdapter } from './oracleModelAdapter.service';
import { captureOracleEvidenceGaps } from './oracleEvidenceGap.service';

const activeRuns = new Map<string, AbortController>();

function systemPrompt(mode: string): string {
  const shared = [
    'You are Oracle, DreamScape’s evidence-aware conversational assistant.',
    'Treat the complete conversation supplied below as working memory. Never ask for information the user has already provided, and explicitly build on relevant answers from earlier turns.',
    'Write entirely in the user’s language. Do not insert untranslated English words or awkward bilingual glosses.',
    'Answer the user’s actual request immediately. Do not introduce yourself, repeat the request, or add ceremonial greetings.',
    'Write with the coherence and warmth of an excellent human editor: begin with the most useful overall interpretation, then connect each important dream detail into one readable argument. Do not output a disconnected inventory of symbols.',
    'Explain why each interpretation follows from the user’s actual details. Include a practical takeaway when it would help the user.',
    'Use natural, precise language. Prefer short paragraphs and useful headings; avoid both terse fragments and a long wall of text.',
    'When the user has not supplied the dream itself, do not interpret it yet. Ask at most two focused questions that collect the missing details needed for the next turn.',
    'Never describe a dream as a message from the subconscious, use universal symbol meanings, or claim unfinished inner work as fact.',
    'Separate observations from hypotheses. Never present dream interpretation as diagnosis, prophecy, or established fact.',
    'Do not claim access to dreams, memories, rules, research, or sources that were not actually provided or retrieved.',
    'Place the literal marker [?] immediately after every interpretation or practical inference that seems plausible but is not directly supported by a retrieved academic source. A numbered citation may support only the adjacent claim that the source actually establishes; never use one citation as cover for unrelated symbolic interpretations.',
    'Do not repeat generic safety disclaimers unless the user asks for clinical advice or the answer contains a meaningful safety concern.',
    'After the answer, append exactly one machine-readable block in this form: <oracle_suggestions>[\"suggestion 1\",\"suggestion 2\",\"suggestion 3\",\"suggestion 4\"]</oracle_suggestions>. Generate 3–6 concise one-click follow-ups by role-playing the user who just read this specific answer. Suggestions are actual messages the user can send, not titles or invented autobiographical answers. Prioritize, in order: a direct reply to Oracle’s final question; continuing the dream from its exact stopping point when a dream was supplied; comparison with the user’s real prior dreams; checking evidence; then deeper interpretation. Never turn a symbol such as a bird, sea, bridge, train, or moon into a therapy technique or real-world recommendation. Each suggestion must refer to concrete content from this conversation, must be meaningfully different from the others, and must never ask the user to repeat information already supplied. For creative continuation, prioritize continuing another scene from the exact stopping point. Do not mention this block in the answer.',
  ];
  if (mode === 'dream_analysis') {
    shared.push(
      'For dream analysis, synthesize the narrative, strongest emotion, waking-life context, prior answers, retrieved personal history, and verified research into a cohesive response. Lead with the likely central tension, explain the strongest details in depth, distinguish observation from hypothesis without sounding mechanical, state whether anything is genuinely concerning, cite only claims directly supported by retrieved evidence, and end with one neutral, non-leading question that tests a specific interpretation. Never imply that the user lacks creativity, personality, competence, or another trait merely because of dream imagery.',
      'A matching previously stored dream is useful longitudinal context, not an error and not a reason to warn or scold the user. Compare it constructively when relevant.',
    );
  } else if (mode === 'creative_continuation') {
    shared.push('Continue the dream as creative fiction and clearly label it as imaginative, not scientific analysis.');
  }
  return shared.join(' ');
}

function resolveOracleModel(mode: string): string {
  if (mode === 'chat') {
    return process.env.ORACLE_OLLAMA_CHAT_MODEL
      || process.env.ORACLE_OLLAMA_MODEL
      || 'qwen2.5:14b';
  }
  return process.env.ORACLE_OLLAMA_ANALYSIS_MODEL
    || process.env.ORACLE_OLLAMA_MODEL
    || 'qwen3.6:27b';
}

function inferOracleMode(
  messages: Array<{ role: string; content: string }>,
): 'chat' | 'dream_analysis' | 'creative_continuation' {
  const userMessages = messages.filter((message) => message.role === 'user');
  const latest = userMessages[userMessages.length - 1]?.content.trim() || '';
  const conversation = userMessages.map((message) => message.content).join('\n');

  if (/(viết tiếp|nối tiếp|tiếp tục.*giấc mơ|sáng tác|tưởng tượng phần tiếp|continue.*dream|creative continuation)/iu.test(latest)) {
    return 'creative_continuation';
  }

  const containsDreamNarrative = conversation.length >= 180
    && /(tôi mơ|trong (?:giấc )?mơ|giấc mơ (?:của )?tôi|i dream(?:ed|t)?|in my dream|my dream)/iu.test(conversation);
  return containsDreamNarrative ? 'dream_analysis' : 'chat';
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

async function estimateRunDuration(
  userId: Types.ObjectId,
  mode: 'chat' | 'dream_analysis' | 'creative_continuation',
  modelName: string,
  workload: {
    inputChars: number;
    contextChars: number;
    retrievalChars: number;
    citationCount: number;
  },
): Promise<{ minMs: number; maxMs: number }> {
  const history = await OracleRun.find({
    userId,
    status: 'completed',
    completedAt: { $exists: true },
    mode,
    modelName,
  })
    .sort({ completedAt: -1 })
    .limit(30)
    .select('durationMs createdAt completedAt inputChars contextChars retrievalChars citationCount')
    .lean();
  const nearestRuns = history
    .sort((left, right) => {
      const distance = (run: typeof left) => {
        const inputDistance = Math.abs(Math.log(
          (Number(run.inputChars) + 400) / (workload.inputChars + 400),
        ));
        const contextDistance = Number(run.contextChars) > 0
          ? Math.abs(Math.log((Number(run.contextChars) + 2_000) / (workload.contextChars + 2_000)))
          : 0;
        const retrievalDistance = Number(run.retrievalChars) > 0
          ? Math.abs(Math.log((Number(run.retrievalChars) + 1_000) / (workload.retrievalChars + 1_000)))
          : 0;
        const citationDistance = Number(run.citationCount) > 0
          ? Math.abs(Math.log((Number(run.citationCount) + 1) / (workload.citationCount + 1)))
          : 0;
        return inputDistance + contextDistance * 0.55 + retrievalDistance * 0.35 + citationDistance * 0.15;
      };
      const leftDistance = distance(left);
      const rightDistance = distance(right);
      return leftDistance - rightDistance;
    })
    .slice(0, 16);
  const samples = nearestRuns
    .map((item) => {
      const duration = Number(item.durationMs)
        || (item.completedAt ? new Date(item.completedAt).getTime() - new Date(item.createdAt).getTime() : 0);
      const inputScale = Math.pow(
        (workload.inputChars + 400) / (Number(item.inputChars) + 400),
        0.32,
      );
      const contextScale = Number(item.contextChars) > 0
        ? Math.pow((workload.contextChars + 2_000) / (Number(item.contextChars) + 2_000), 0.24)
        : 1;
      const retrievalScale = Number(item.retrievalChars) > 0
        ? Math.pow((workload.retrievalChars + 1_000) / (Number(item.retrievalChars) + 1_000), 0.16)
        : 1;
      const citationScale = Number(item.citationCount) > 0
        ? Math.pow((workload.citationCount + 1) / (Number(item.citationCount) + 1), 0.08)
        : 1;
      const totalScale = Math.max(
        0.65,
        Math.min(1.65, inputScale * contextScale * retrievalScale * citationScale),
      );
      return duration * totalScale;
    })
    .filter((value) => Number.isFinite(value) && value >= 1_000 && value <= 30 * 60_000);
  if (samples.length >= 3) {
    const median = percentile(samples, 0.5);
    const deviations = samples.map((value) => Math.abs(value - median));
    const medianDeviation = percentile(deviations, 0.5);
    const robustSamples = medianDeviation > 0
      ? samples.filter((value) => Math.abs(value - median) <= medianDeviation * 3.5)
      : samples;
    const robustMedian = percentile(robustSamples, 0.5) || median;
    const robustDeviation = percentile(
      robustSamples.map((value) => Math.abs(value - robustMedian)),
      0.5,
    );
    const estimate = robustMedian + Math.min(
      robustMedian * 0.08,
      robustDeviation * 0.25,
    );
    return {
      minMs: Math.max(5_000, Math.round(robustMedian * 0.72)),
      maxMs: Math.max(15_000, Math.round(estimate)),
    };
  }
  if (samples.length) {
    const observed = percentile(samples, 0.5);
    return {
      minMs: Math.max(5_000, Math.round(observed * 0.72)),
      maxMs: Math.max(15_000, Math.round(observed * 1.02)),
    };
  }
  const fallback = mode === 'chat' ? 90_000 : mode === 'creative_continuation' ? 300_000 : 420_000;
  return { minMs: Math.round(fallback * 0.7), maxMs: fallback };
}

function finalizeModelAnswer(rawText: string): { answer: string; suggestions: string[] } {
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

export function directAnswerSuggestions(answer: string): string[] {
  const cleanAnswer = answer.replace(/\s+$/u, '');
  const questionEnd = cleanAnswer.lastIndexOf('?');
  if (questionEnd < 0 || cleanAnswer.slice(questionEnd + 1).trim()) return [];
  const beforeQuestion = cleanAnswer.slice(0, questionEnd);
  const questionStart = Math.max(
    beforeQuestion.lastIndexOf('\n'),
    beforeQuestion.lastIndexOf('.'),
    beforeQuestion.lastIndexOf('!'),
    beforeQuestion.lastIndexOf('?'),
  ) + 1;
  const finalQuestion = cleanAnswer.slice(questionStart, questionEnd + 1)
    .replace(/[*_~`]+/gu, '')
    .trim();
  if (finalQuestion.length < 3 || finalQuestion.length > 500) return [];
  // JavaScript's \b is ASCII-centric: a boundary immediately after Vietnamese
  // characters such as "ó" is not reliable. Keep Vietnamese phrase matching
  // Unicode-safe and use word boundaries only for English.
  const vietnameseYesNo = /(?:bạn\s+có(?:\s+(?:nhận\s+thấy|cảm\s+thấy|nghĩ|cho\s+rằng))?|có\s+phải|có\s+đúng|có\s+cảm\s+thấy|phải\s+không|đúng\s+không)/iu
    .test(finalQuestion);
  const englishYesNo = /(?:\bdo you\b|\bare you\b|\bis (?:it|that|this)\b|\bwould you\b)/iu
    .test(finalQuestion);
  const yesNoQuestion = vietnameseYesNo || englishYesNo;
  if (!yesNoQuestion) return [];
  const vietnamese = /[ăâđêôơưà-ỹ]/iu.test(finalQuestion);
  if (vietnamese) {
    if (/bạn\s+có\s+muốn/iu.test(finalQuestion)) {
      if (/phác\s+thảo/iu.test(finalQuestion)) {
        return [
          'Có, tôi muốn thử phác thảo ý tưởng đó.',
          'Không, lúc này tôi chưa muốn phác thảo.',
          'Tôi chưa biết bắt đầu từ đâu; hãy gợi ý bước đầu tiên.',
        ];
      }
      if (/chia\s+sẻ|kể|mô\s+tả/iu.test(finalQuestion)) {
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
    if (/bạn\s+có\s+thể/iu.test(finalQuestion)) {
      return [
        'Có, tôi có thể làm điều đó.',
        'Không, hiện tại tôi chưa thể.',
        'Tôi chưa chắc mình nên bắt đầu thế nào.',
      ];
    }
    return ['Có, điều đó đúng với tôi.', 'Không, tôi không thấy như vậy.', 'Tôi chưa chắc.'];
  }
  if (/(?:would you like|do you want)/iu.test(finalQuestion)) {
    return ['Yes, I would like to try.', 'No, not right now.', 'I am not sure; help me take the first step.'];
  }
  return ['Yes, that fits me.', 'No, that does not fit me.', 'I am not sure yet.'];
}

function prioritizedSuggestions(input: {
  answer: string;
  generated: string[];
  mode: 'chat' | 'dream_analysis' | 'creative_continuation';
  vietnamese: boolean;
}): string[] {
  const quickReplies = directAnswerSuggestions(input.answer);
  const continuation = input.vietnamese
    ? 'Hãy viết tiếp phần sau của giấc mơ này.'
    : 'Continue the next part of this dream.';
  const metaphorPrescription = /(?:kỹ thuật giảm lo lắng|giảm lo lắng.*(?:chim|biển|cầu|tàu|mặt trăng)|dựa trên hình ảnh.+(?:chim|biển|cầu|tàu|mặt trăng)|viết lại kịch bản.+ít slide|anxiety technique.+(?:bird|sea|bridge|train|moon)|based on the image.+(?:bird|sea|bridge|train|moon))/iu;
  const generated = input.generated.filter((item) => !metaphorPrescription.test(item));
  const ordered = input.mode === 'dream_analysis'
    ? [...quickReplies, continuation, ...generated]
    : input.mode === 'creative_continuation'
      ? [continuation, ...quickReplies, ...generated]
      : [...quickReplies, ...generated];
  return [...new Set(ordered.map((item) => item.replace(/\s+/gu, ' ').trim()).filter(Boolean))]
    .slice(0, 6);
}

async function generateFallbackSuggestions(input: {
  adapter: Awaited<ReturnType<typeof resolveOracleModelAdapter>>;
  model: string;
  signal: AbortSignal;
  userText: string;
  answer: string;
  languageHint: string;
}): Promise<string[]> {
  const requestSuggestions = async (responseFormat?: 'json') => {
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
  };
  for (const responseFormat of ['json', undefined] as const) {
    try {
      const raw = await requestSuggestions(responseFormat);
      const json = raw.match(/\{[\s\S]*\}/u)?.[0] || raw.match(/\[[\s\S]*\]/u)?.[0];
      if (!json) continue;
      const parsed = JSON.parse(json);
      const suggestions = Array.isArray(parsed) ? parsed : parsed?.suggestions;
      if (!Array.isArray(suggestions)) continue;
      const normalized = [...new Set(suggestions
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.replace(/\s+/gu, ' ').trim())
        .filter((item) => item.length >= 2 && item.length <= 110))]
        .slice(0, 4);
      if (normalized.length) return normalized;
    } catch {
      // Some OpenAI-compatible endpoints do not implement response_format.
      // Retry once with the same generated prompt in plain text mode.
    }
  }
  return [];
}

function markUnsupportedInterpretations(answer: string): string {
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

function ensurePersonalContextCitation(
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

const SUPPORT_CONCEPTS: Array<[string, RegExp]> = [
  ['memory', /\bmemory|memories|remember|recall\b|ký ức|trí nhớ|quá khứ/iu],
  ['future', /\bfuture|prospective|anticipated|upcoming\b|tương lai|sắp tới|dự kiến/iu],
  ['stress', /\bstress|anxiety|pressure|worry\b|căng thẳng|lo lắng|áp lực/iu],
  ['work', /\bwork|job|project|presentation|meeting\b|công việc|dự án|trình bày|cuộc họp/iu],
  ['emotion', /\bemotion|affect|feeling\b|cảm xúc|cảm giác/iu],
  ['creativity', /\bcreative|creativity|divergent thinking\b|sáng tạo|linh hoạt/iu],
  ['threat', /\bthreat|danger|fear\b|đe dọa|nguy hiểm|sợ hãi/iu],
  ['sleep', /\bsleep|awakening|rem|nrem\b|giấc ngủ|tỉnh giấc/iu],
];

function conceptsIn(value: string): Set<string> {
  return new Set(SUPPORT_CONCEPTS.filter(([, pattern]) => pattern.test(value)).map(([name]) => name));
}

function citationClaimBefore(text: string, markerStart: number): string {
  const before = text.slice(Math.max(0, markerStart - 700), markerStart);
  const boundary = Math.max(
    before.lastIndexOf('\n'),
    before.lastIndexOf('.'),
    before.lastIndexOf('!'),
    before.lastIndexOf('?'),
  );
  return before.slice(boundary + 1).replace(/\s+/gu, ' ').trim();
}

export function validateAcademicCitationSupport(text: string, citations: OracleCitation[]): string {
  let validated = text;
  for (const citation of citations.filter((item) => item.sourceType === 'academic_source')) {
    const marker = `[${citation.index}]`;
    let searchFrom = 0;
    while (true) {
      const markerStart = validated.indexOf(marker, searchFrom);
      if (markerStart < 0) break;
      const claim = citationClaimBefore(validated, markerStart);
      const scope = `${citation.excerpt} ${citation.detail || ''}`;
      const claimConcepts = conceptsIn(claim);
      const scopeConcepts = conceptsIn(scope);
      const covered = [...claimConcepts].filter((concept) => scopeConcepts.has(concept)).length;
      const coverage = claimConcepts.size ? covered / claimConcepts.size : 0;
      const quoteIsSubstantive = citation.excerpt.replace(/\s+/gu, ' ').trim().length >= 60;
      const supported = claimConcepts.size > 0 && coverage >= 0.75 && quoteIsSubstantive;
      if (supported) {
        searchFrom = markerStart + marker.length;
        continue;
      }
      validated = `${validated.slice(0, markerStart)}[?]${validated.slice(markerStart + marker.length)}`;
      searchFrom = markerStart + 3;
    }
  }
  return validated;
}

async function appendEvent(
  runId: Types.ObjectId,
  threadId: Types.ObjectId,
  userId: Types.ObjectId,
  eventType: OracleRunEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const run = await OracleRun.findOneAndUpdate(
    { _id: runId, threadId, userId },
    { $inc: { lastEventSequence: 1 } },
    { new: true },
  );
  if (!run) return;
  await OracleRunEvent.create({
    runId,
    threadId,
    userId,
    sequence: run.lastEventSequence,
    eventType,
    payload,
  });
}

async function loadMessages(
  threadId: Types.ObjectId,
  userId: Types.ObjectId,
  leafTurnId: Types.ObjectId,
) {
  const turns = await OracleTurn.find({
    threadId,
    userId,
    status: 'completed',
    role: { $in: ['user', 'assistant'] },
  })
    .sort({ sequence: -1 })
    .limit(100)
    .lean();
  const byId = new Map(turns.map((turn) => [String(turn._id), turn]));
  const ancestry: typeof turns = [];
  let current = byId.get(String(leafTurnId));
  while (current && ancestry.length < 40) {
    ancestry.push(current);
    current = current.parentTurnId ? byId.get(String(current.parentTurnId)) : undefined;
  }
  const selectedTurns = ancestry.length > 1
    ? ancestry.reverse().slice(-20)
    : turns.reverse().filter((turn) => turn.sequence <= (ancestry[0]?.sequence || Number.MAX_SAFE_INTEGER)).slice(-20);
  return selectedTurns.map((turn) => ({
    role: turn.role,
    content: turn.contentBlocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n'),
  })).filter((message) => message.content.trim());
}

export function abortOracleRun(runId: string): void {
  activeRuns.get(runId)?.abort();
}

export async function executeOracleRun(runId: Types.ObjectId): Promise<void> {
  const runKey = String(runId);
  if (activeRuns.has(runKey)) return;
  const controller = new AbortController();
  // Claim locally before the first await. This prevents the thread-list
  // recovery poll and the original POST handler from starting the same run.
  activeRuns.set(runKey, controller);
  let fullText = '';
  let preparationStarted = false;
  let preparationStartedAt: Date | undefined;
  let run: IOracleRun | null = null;

  try {
    run = await OracleRun.findById(runId);
    if (!run || !['queued', 'running'].includes(run.status)) return;
    const thread = await OracleThread.findOne({ _id: run.threadId, userId: run.userId, deletedAt: { $exists: false } });
    if (!thread) return;

    await Promise.all([
      OracleRun.updateOne(
        { _id: runId, status: { $in: ['queued', 'running'] } },
        { $set: { status: 'running' } },
      ),
      OracleTurn.updateOne({ _id: run.assistantTurnId }, { $set: { status: 'streaming' } }),
    ]);
    const messages = await loadMessages(run.threadId, run.userId, run.userTurnId);
    const executionMode = inferOracleMode(messages);
    const latestUserText = [...messages].reverse().find((message) => message.role === 'user')?.content || '';
    const groundingText = executionMode === 'dream_analysis'
      ? ([...messages].reverse().find((message) =>
        message.role === 'user'
        && message.content.length >= 180
        && /(tôi mơ|trong (?:giấc )?mơ|giấc mơ (?:của )?tôi|i dream(?:ed|t)?|in my dream|my dream)/iu
          .test(message.content))?.content || latestUserText)
      : latestUserText;
    const grounding = executionMode === 'dream_analysis'
      ? await buildOracleGrounding(String(run.userId), groundingText)
      : { citations: [], promptContext: '' };
    const adapter = await resolveOracleModelAdapter(run.userId);
    const model = adapter.modelOverride || (adapter.name === 'openai_compatible'
      ? String(process.env.ORACLE_EXTERNAL_MODEL || resolveOracleModel(executionMode))
      : resolveOracleModel(executionMode));
    const workload = {
      inputChars: latestUserText.length,
      contextChars: messages.reduce((total, message) => total + message.content.length, 0),
      retrievalChars: grounding.promptContext.length,
      citationCount: grounding.citations.length,
    };
    const estimate = await estimateRunDuration(run.userId, executionMode, model, workload);
    await OracleRun.updateOne(
      { _id: runId },
      {
        $set: {
          mode: executionMode,
          modelName: model,
          ...workload,
          expectedMinMs: estimate.minMs,
          expectedMaxMs: estimate.maxMs,
          stage: 'thinking',
          stageStartedAt: new Date(),
        },
      },
    );
    const claimedRun = run;
    const contextWindow = Math.max(4096, Number(process.env.ORACLE_CONTEXT_WINDOW) || 32768);
    let promptTokens = 0;
    const appendModelText = async (token: string) => {
      if (!token) return;
      if (!preparationStarted) {
        preparationStarted = true;
        const preparationAt = new Date();
        preparationStartedAt = preparationAt;
        await OracleRun.updateOne(
          { _id: runId },
          { $set: { stage: 'preparing', stageStartedAt: preparationAt } },
        );
        await appendEvent(runId, claimedRun.threadId, claimedRun.userId, 'tool_progress', {
          stage: 'preparing_answer',
          stageStartedAt: preparationAt.toISOString(),
        });
      }
      fullText += token;
    };
    const modelResult = await adapter.generate({
      model,
      signal: controller.signal,
      messages: [
        { role: 'system', content: systemPrompt(executionMode) },
        ...(grounding.promptContext ? [{ role: 'system' as const, content: grounding.promptContext }] : []),
        ...messages,
      ],
      contextWindow,
      maxOutputTokens: executionMode === 'chat' ? 600 : 1400,
      onText: appendModelText,
    });
    promptTokens = modelResult.promptTokens;
    const finalized = finalizeModelAnswer(fullText);
    if (!finalized.answer.trim()) {
      fullText = '';
      throw new Error('oracle_model_empty_answer');
    }
    fullText = executionMode === 'dream_analysis'
      ? markUnsupportedInterpretations(finalized.answer)
      : finalized.answer;
    if (executionMode === 'dream_analysis') {
      fullText = validateAcademicCitationSupport(fullText, grounding.citations);
      if (groundingText === latestUserText) {
        fullText = ensurePersonalContextCitation(fullText, grounding);
      }
    }
    const generatedSuggestions = finalized.suggestions.length
      ? finalized.suggestions
      : await generateFallbackSuggestions({
        adapter,
        model,
        signal: controller.signal,
        userText: latestUserText,
        answer: fullText,
        languageHint: /[ăâđêôơưà-ỹ]/iu.test(latestUserText) ? 'Vietnamese' : 'the user’s language',
      });
    const suggestedPrompts = prioritizedSuggestions({
      answer: fullText,
      generated: generatedSuggestions,
      mode: executionMode,
      vietnamese: /[ăâđêôơưà-ỹ]/iu.test(latestUserText),
    });
    const compactedCitations = compactUsedCitations(fullText, grounding.citations);
    fullText = compactedCitations.text;
    const citations = compactedCitations.citations;
    await captureOracleEvidenceGaps({
      userId: run.userId,
      threadId: run.threadId,
      turnId: run.assistantTurnId,
      answer: fullText,
    });
    if (fullText) await appendEvent(runId, run.threadId, run.userId, 'token', { text: fullText });
    for (const citation of citations) {
      await appendEvent(runId, run.threadId, run.userId, 'citation', { citation });
    }
    const now = new Date();
    await OracleTurn.updateOne(
      { _id: run.assistantTurnId },
      {
        $set: {
          status: 'completed',
          contentBlocks: [{ type: 'text', text: fullText }],
          citations,
          suggestedPrompts,
          contextUsage: {
            usedTokens: promptTokens,
            maxTokens: contextWindow,
            percent: Math.min(100, Math.round((promptTokens / contextWindow) * 100)),
            provider: adapter.name,
            modelName: model,
          },
          runTiming: {
            startedAt: run.createdAt,
            thoughtCompletedAt: preparationStartedAt || now,
            completedAt: now,
            expectedMinMs: estimate.minMs,
            expectedMaxMs: estimate.maxMs,
          },
          finalizedAt: now,
        },
      },
    );
    await appendEvent(runId, run.threadId, run.userId, 'done', {
      assistantTurnId: String(run.assistantTurnId),
      completedAt: now.toISOString(),
      suggestedPrompts,
      contextUsage: {
        usedTokens: promptTokens,
        maxTokens: contextWindow,
        percent: Math.min(100, Math.round((promptTokens / contextWindow) * 100)),
        provider: adapter.name,
        modelName: model,
      },
    });
    await OracleRun.updateOne(
      { _id: runId },
      {
        $set: {
          status: 'completed',
          completedAt: now,
          durationMs: Math.max(0, now.getTime() - run.createdAt.getTime()),
          outputChars: fullText.length,
          promptTokens,
          stage: 'completed',
          stageStartedAt: now,
        },
      },
    );
    await OracleRunEvent.updateMany(
      { runId, userId: run.userId },
      { $set: { expiresAt: new Date(now.getTime() + ORACLE_RUN_EVENT_RETENTION_MS) } },
    );
  } catch (error) {
    if (!run) return;
    const cancelled = controller.signal.aborted;
    const now = new Date();
    const status = cancelled ? 'cancelled' : 'failed';
    const errorCode = cancelled ? 'user_cancelled' : 'oracle_model_unavailable';
    await Promise.all([
      OracleTurn.updateOne(
        { _id: run.assistantTurnId },
        { $set: { status, finalizedAt: now, ...(fullText ? { contentBlocks: [{ type: 'text', text: fullText }] } : {}) } },
      ),
      OracleRun.updateOne(
        { _id: runId },
        { $set: { status, completedAt: now, errorCode } },
      ),
    ]);
    await appendEvent(runId, run.threadId, run.userId, cancelled ? 'cancelled' : 'error', { code: errorCode });
  } finally {
    activeRuns.delete(runKey);
  }
}
