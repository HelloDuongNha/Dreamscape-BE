export interface OracleModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OracleModelRequest {
  messages: OracleModelMessage[];
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  signal: AbortSignal;
  onText: (text: string) => Promise<void>;
  responseFormat?: 'text' | 'json';
}

export interface OracleModelResult {
  promptTokens: number;
}

export interface OracleModelAdapter {
  readonly name: 'ollama' | 'openai_compatible';
  readonly modelOverride?: string;
  generate(request: OracleModelRequest): Promise<OracleModelResult>;
}

class OllamaOracleModelAdapter implements OracleModelAdapter {
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
      headers: { 'Content-Type': 'application/json' },
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

    const reader = response.body.getReader();
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
      if (item.message?.content) {
        emittedText = true;
        await request.onText(item.message.content);
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) {
        await processLine(line);
      }
      if (done) break;
    }
    // Ollama usually terminates NDJSON with a newline, but compatible servers
    // are not required to. Preserve the final response object instead of
    // silently discarding it when the stream closes without a trailing LF.
    if (pending.trim()) await processLine(pending);
    if (!emittedText) throw new Error('oracle_model_empty');
    return { promptTokens };
  }
}

class OpenAICompatibleOracleModelAdapter implements OracleModelAdapter {
  readonly name = 'openai_compatible' as const;
  constructor(
    private readonly configuredBaseUrl?: string,
    private readonly configuredApiKey?: string,
    public readonly modelOverride?: string,
    private readonly userConfigured = false,
  ) {}

  async generate(request: OracleModelRequest): Promise<OracleModelResult> {
    if (!this.userConfigured && process.env.ORACLE_EXTERNAL_PRIVATE_CONTEXT_ACKNOWLEDGED !== 'true') {
      throw new Error('oracle_external_data_policy_not_acknowledged');
    }
    const baseUrl = String(
      this.configuredBaseUrl || process.env.ORACLE_EXTERNAL_API_BASE_URL || '',
    ).replace(/\/+$/u, '');
    const apiKey = String(this.configuredApiKey || process.env.ORACLE_EXTERNAL_API_KEY || '');
    if (!baseUrl || !apiKey || !/^https:\/\//iu.test(baseUrl)) {
      throw new Error('oracle_external_provider_invalid_config');
    }
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: request.signal,
      body: JSON.stringify({
        model: this.modelOverride || request.model,
        messages: request.messages,
        temperature: 0.2,
        max_tokens: request.maxOutputTokens,
        stream: false,
        ...(request.responseFormat === 'json'
          ? { response_format: { type: 'json_object' } }
          : {}),
      }),
    });
    if (!response.ok) throw new Error(`oracle_external_model_http_${response.status}`);
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number };
    };
    const text = payload.choices?.[0]?.message?.content?.trim() || '';
    if (!text) throw new Error('oracle_external_model_empty');
    await request.onText(text);
    return { promptTokens: Math.max(0, Number(payload.usage?.prompt_tokens) || 0) };
  }
}

export async function resolveOracleModelAdapter(userId?: Types.ObjectId): Promise<OracleModelAdapter> {
  if (userId) {
    const credential = await getActiveOracleCredential(userId);
    if (credential?.privateContextAcknowledged) {
      if (credential.provider === 'ollama') {
        return new OllamaOracleModelAdapter(credential.baseUrl, credential.modelName);
      }
      return new OpenAICompatibleOracleModelAdapter(
        credential.baseUrl,
        decryptCredentialKey(credential),
        credential.modelName,
        true,
      );
    }
  }
  const provider = String(process.env.ORACLE_MODEL_PROVIDER || 'ollama').trim().toLowerCase();
  if (provider === 'ollama') return new OllamaOracleModelAdapter();
  if (provider === 'openai_compatible') return new OpenAICompatibleOracleModelAdapter();
  throw new Error('oracle_model_provider_unsupported');
}
import { Types } from 'mongoose';
import {
  decryptCredentialKey,
  getActiveOracleCredential,
} from './oracleCredential.service';
