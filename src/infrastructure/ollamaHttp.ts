/**
 * Builds headers for the shared Ollama runtime.
 *
 * Local Ollama does not require authentication. Remote deployments should set
 * OLLAMA_API_KEY and place an authenticated gateway in front of Ollama; keeping
 * the decision here prevents individual pipelines from accidentally bypassing
 * that gateway contract.
 */
export function ollamaRequestHeaders(
  additional: Record<string, string> = {},
): Record<string, string> {
  const apiKey = process.env.OLLAMA_API_KEY?.trim();
  return {
    ...additional,
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}
