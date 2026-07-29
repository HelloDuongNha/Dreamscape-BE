import { logger } from '../../../../infrastructure/logger';
import type { OracleModelAdapter } from '../providers/oracleModel.types';
import {
  inferOracleMode,
  type OracleExecutionMode,
} from '../providers/oraclePrompt.service';
import type { OracleConversationMessage } from './oracleConversation.service';

interface OracleIntentRoutingInput {
  adapter: OracleModelAdapter;
  messages: OracleConversationMessage[];
  model: string;
  signal: AbortSignal;
}

interface OracleIntentRoutingResult {
  mode: OracleExecutionMode;
}

// Uses the model only when an older dream could otherwise contaminate a new conversational turn.
export async function resolveOracleExecutionMode(
  input: OracleIntentRoutingInput,
): Promise<OracleIntentRoutingResult> {
  const immediateMode = inferOracleMode(input.messages);
  if (immediateMode !== 'chat' || !hasEarlierDreamContext(input.messages)) {
    return { mode: immediateMode };
  }

  try {
    return await classifyContextDependentTurn(input);
  } catch (error) {
    if (input.signal.aborted) throw error;
    logger.warn('Oracle intent routing failed; using normal conversation mode.', {
      error: String(error),
    });
    return { mode: 'chat' };
  }
}

async function classifyContextDependentTurn(
  input: OracleIntentRoutingInput,
): Promise<OracleIntentRoutingResult> {
  for (const responseFormat of ['json', undefined] as const) {
    let raw = '';
    try {
      await input.adapter.generate({
        model: input.model,
        signal: input.signal,
        contextWindow: 4096,
        maxOutputTokens: 40,
        ...(responseFormat ? { responseFormat } : {}),
        messages: [
          {
            role: 'system',
            content: [
              'Classify only the latest user message by its intended task.',
              'Use dream_analysis when the user asks to interpret, compare, verify, or continue discussing a dream, or directly answers a question about that analysis.',
              'Use creative_continuation only when the user asks for fictional continuation of a dream.',
              'Use chat for ordinary conversation, identity or capability questions, definitions, general knowledge, product questions, and any topic unrelated to dream analysis.',
              'An older dream in the conversation is context, not proof that the latest message is about that dream.',
              'Return exactly {"mode":"chat"}, {"mode":"dream_analysis"}, or {"mode":"creative_continuation"}.',
            ].join(' '),
          },
          {
            role: 'user',
            content: buildRoutingContext(input.messages),
          },
        ],
        onText: async (text) => { raw += text; },
      });
      return { mode: parseMode(raw) };
    } catch (error) {
      if (input.signal.aborted || !responseFormat) throw error;
    }
  }
  return { mode: 'chat' };
}

function hasEarlierDreamContext(messages: OracleConversationMessage[]): boolean {
  return messages.slice(0, -1).some((message) =>
    message.role === 'user' && inferOracleMode([message]) === 'dream_analysis');
}

function buildRoutingContext(messages: OracleConversationMessage[]): string {
  return messages.slice(-4).map((message, index, selected) => {
    const label = index === selected.length - 1 ? 'LATEST USER TURN' : message.role.toUpperCase();
    return `${label}:\n${compactMessage(message.content)}`;
  }).join('\n\n');
}

function compactMessage(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length <= 1_200
    ? normalized
    : `${normalized.slice(0, 600)} … ${normalized.slice(-600)}`;
}

function parseMode(raw: string): OracleExecutionMode {
  const normalized = raw.toLowerCase();
  if (normalized.includes('creative_continuation')) return 'creative_continuation';
  if (normalized.includes('dream_analysis')) return 'dream_analysis';
  return 'chat';
}
