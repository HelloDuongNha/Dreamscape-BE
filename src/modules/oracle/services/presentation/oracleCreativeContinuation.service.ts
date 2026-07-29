import type {
  OracleModelAdapter,
  OracleModelMessage,
} from '../providers/oracleModel.types';

const DREAM_NARRATIVE_PATTERN =
  /(tôi mơ|mình mơ|trong (?:giấc )?mơ|giấc mơ (?:của )?(?:tôi|mình)|i dream(?:ed|t)?|in my dream|my dream)/iu;
const CONTINUATION_REQUEST_PATTERN =
  /(viết tiếp|nối tiếp|tiếp tục.*giấc mơ|sáng tác|tưởng tượng phần tiếp|continue.*dream|creative continuation)/iu;
const FOREIGN_SCRIPT_TEST =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const FOREIGN_SCRIPT_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

// Gives creative mode a small, explicit canon instead of treating analysis prose as story facts.
export function buildOracleCreativeCanonPrompt(messages: OracleModelMessage[]): string {
  const latestUserIndex = findLatestUserIndex(messages);
  const history = latestUserIndex >= 0 ? messages.slice(0, latestUserIndex) : messages;
  const originalDreamIndex = findLatestIndex(
    history,
    (message) => message.role === 'user' && DREAM_NARRATIVE_PATTERN.test(message.content),
  );
  const fallbackUserIndex = findLatestIndex(
    history,
    (message) => message.role === 'user' && !CONTINUATION_REQUEST_PATTERN.test(message.content),
  );
  const sourceIndex = originalDreamIndex >= 0 ? originalDreamIndex : fallbackUserIndex;
  const sourceDream = sourceIndex >= 0 ? history[sourceIndex].content.trim() : '';
  const previousContinuation = findPreviousCreativeContinuation(history, sourceIndex);

  const canon = [
    '[AUTHORITATIVE_STORY_CANON]',
    'ORIGINAL DREAM:',
    sourceDream || '(No original dream narrative was found.)',
  ];
  if (previousContinuation) {
    canon.push('LATEST CREATIVE SCENE:', previousContinuation);
  }
  canon.push(
    '[/AUTHORITATIVE_STORY_CANON]',
    'Only the details inside this block are established story facts. Earlier assistant analysis, interpretations, citations, and suggestions are not story canon.',
    'Never describe an object, person, or place as returning, remaining, happening again, or changing from an earlier state unless that detail appears inside this block.',
  );
  return canon.join('\n');
}

// Repairs only visible language or Markdown corruption without rewriting a valid continuation.
export async function repairOracleCreativeAnswerIfNeeded(input: {
  answer: string;
  adapter: OracleModelAdapter;
  model: string;
  signal: AbortSignal;
  contextWindow: number;
  maxOutputTokens: number;
  vietnamese: boolean;
}): Promise<{ answer: string; promptTokens: number }> {
  if (!hasCreativeOutputAnomaly(input.answer, input.vietnamese)) {
    return { answer: input.answer, promptTokens: 0 };
  }

  let repaired = '';
  try {
    const result = await input.adapter.generate({
      model: input.model,
      signal: input.signal,
      messages: [
        {
          role: 'system',
          content: [
            'Copy-edit the supplied creative passage only.',
            'Preserve its events, paragraph order, first-person point of view, and ending.',
            input.vietnamese
              ? 'Write entirely in natural Vietnamese and replace every untranslated foreign-script fragment with the intended Vietnamese wording.'
              : 'Keep the answer entirely in the user’s language.',
            'Balance every Markdown emphasis marker. Return only the corrected passage, without notes or suggestion blocks.',
          ].join(' '),
        },
        { role: 'user', content: input.answer },
      ],
      contextWindow: Math.max(4096, input.contextWindow),
      maxOutputTokens: input.maxOutputTokens,
      onText: async (text) => {
        repaired += text;
      },
    });
    const answer = repaired.trim();
    if (answer && !hasCreativeOutputAnomaly(answer, input.vietnamese)) {
      return { answer, promptTokens: result.promptTokens };
    }
    return {
      answer: removeVisibleOutputCorruption(answer || input.answer, input.vietnamese),
      promptTokens: result.promptTokens,
    };
  } catch {
    return {
      answer: removeVisibleOutputCorruption(input.answer, input.vietnamese),
      promptTokens: 0,
    };
  }
}

export function hasCreativeOutputAnomaly(answer: string, vietnamese: boolean): boolean {
  return (vietnamese && FOREIGN_SCRIPT_TEST.test(answer))
    || countOccurrences(answer, '**') % 2 !== 0;
}

function findPreviousCreativeContinuation(
  messages: OracleModelMessage[],
  sourceIndex: number,
): string {
  for (let index = messages.length - 1; index > sourceIndex; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user' || !CONTINUATION_REQUEST_PATTERN.test(message.content)) continue;
    const reply = messages.slice(index + 1)
      .find((candidate) => candidate.role === 'assistant' && candidate.content.trim());
    return reply?.content.trim() || '';
  }
  return '';
}

function findLatestUserIndex(messages: OracleModelMessage[]): number {
  return findLatestIndex(messages, (message) => message.role === 'user');
}

function findLatestIndex(
  messages: OracleModelMessage[],
  predicate: (message: OracleModelMessage) => boolean,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index])) return index;
  }
  return -1;
}

function removeVisibleOutputCorruption(answer: string, vietnamese: boolean): string {
  let cleaned = vietnamese ? answer.replace(FOREIGN_SCRIPT_PATTERN, '') : answer;
  if (countOccurrences(cleaned, '**') % 2 !== 0) {
    const unmatchedMarker = cleaned.lastIndexOf('**');
    cleaned = `${cleaned.slice(0, unmatchedMarker)}${cleaned.slice(unmatchedMarker + 2)}`;
  }
  return cleaned.replace(/[ \t]{2,}/g, ' ').trim();
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
