import type {
  OracleModelAdapter,
  OracleModelRequest,
  OracleModelResult,
} from './oracleModel.types';
import { ollamaRequestHeaders } from '../../../../infrastructure/ollamaHttp';

export class OllamaOracleModelAdapter implements OracleModelAdapter {
  readonly name = 'ollama' as const;

  constructor(
    private readonly configuredBaseUrl?: string,
    public readonly modelOverride?: string,
  ) {}

  async generate(request: OracleModelRequest): Promise<OracleModelResult> {
    const baseUrl = (
      this.configuredBaseUrl
      || process.env.OLLAMA_BASE_URL
      || 'http://127.0.0.1:11434'
    ).replace(/\/+$/u, '');
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: ollamaRequestHeaders({ 'Content-Type': 'application/json' }),
      signal: request.signal,
      body: JSON.stringify({
        model: this.modelOverride || request.model,
        stream: true,
        think: false,
        ...(request.responseFormat === 'json' ? { format: 'json' } : {}),
        keep_alive: '30m',
        messages: request.messages,
        options: {
          temperature: 0.2,
          num_ctx: request.contextWindow,
          num_predict: request.maxOutputTokens,
        },
      }),
    });
    if (!response.ok || !response.body) throw new Error(`oracle_model_http_${response.status}`);
    return readOllamaStream(response.body, request.onText);
  }
}

async function readOllamaStream(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => Promise<void>,
): Promise<OracleModelResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let promptTokens = 0;
  let emittedText = false;

  const processLine = async (line: string) => {
    if (!line.trim()) return;
    const item = JSON.parse(line) as {
      message?: { content?: string };
      prompt_eval_count?: number;
    };
    if (typeof item.prompt_eval_count === 'number') promptTokens = item.prompt_eval_count;
    if (!item.message?.content) return;
    emittedText = true;
    await onText(item.message.content);
  };

  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split('\n');
    pending = lines.pop() || '';
    for (const line of lines) await processLine(line);
    if (done) break;
  }
  if (pending.trim()) await processLine(pending);
  if (!emittedText) throw new Error('oracle_model_empty');
  return { promptTokens };
}
