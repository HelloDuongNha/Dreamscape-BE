import type { OracleModelMessage } from '../providers/oracleModel.types';

interface OracleContextCompactionInput {
  messages: OracleModelMessage[];
  contextWindow: number;
  systemPrompt: string;
  groundingPrompt: string;
  maxOutputTokens: number;
}

export interface OracleCompactedContext {
  messages: OracleModelMessage[];
  includedMessages: number;
  omittedMessages: number;
}

// Keeps the newest complete turns while reserving context for instructions, retrieval, and output.
export function compactOracleContext(
  input: OracleContextCompactionInput,
): OracleCompactedContext {
  const fixedTokens = estimateTokens(input.systemPrompt)
    + estimateTokens(input.groundingPrompt)
    + input.maxOutputTokens
    + 768;
  const messageBudget = Math.max(1_024, Math.floor(input.contextWindow * 0.92) - fixedTokens);
  const selected: OracleModelMessage[] = [];
  let usedTokens = 0;

  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (!message) continue;
    const messageTokens = estimateTokens(message.content) + 8;
    if (selected.length && usedTokens + messageTokens > messageBudget) break;
    selected.unshift(message);
    usedTokens += messageTokens;
  }

  while (selected.length > 1 && selected[0]?.role === 'assistant') selected.shift();
  return {
    messages: selected,
    includedMessages: selected.length,
    omittedMessages: Math.max(0, input.messages.length - selected.length),
  };
}

function estimateTokens(value: string): number {
  if (!value) return 0;
  const nonAsciiCount = (value.match(/[^\u0000-\u007f]/gu) || []).length;
  const asciiCount = value.length - nonAsciiCount;
  return Math.ceil(asciiCount / 4 + nonAsciiCount / 2.6);
}
