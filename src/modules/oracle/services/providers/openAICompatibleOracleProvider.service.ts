import type {
  OracleModelAdapter,
  OracleModelRequest,
  OracleModelResult,
} from './oracleModel.types';

export class OpenAICompatibleOracleModelAdapter implements OracleModelAdapter {
  readonly name = 'openai_compatible' as const;

  constructor(
    private readonly configuredBaseUrl?: string,
    private readonly configuredApiKey?: string,
    public readonly modelOverride?: string,
    private readonly userConfigured = false,
  ) {}

  async generate(request: OracleModelRequest): Promise<OracleModelResult> {
    this.assertPrivateContextPolicy();
    const { baseUrl, apiKey } = this.resolveConnection();
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

  private assertPrivateContextPolicy(): void {
    if (!this.userConfigured && process.env.ORACLE_EXTERNAL_PRIVATE_CONTEXT_ACKNOWLEDGED !== 'true') {
      throw new Error('oracle_external_data_policy_not_acknowledged');
    }
  }

  private resolveConnection(): { baseUrl: string; apiKey: string } {
    const baseUrl = String(
      this.configuredBaseUrl || process.env.ORACLE_EXTERNAL_API_BASE_URL || '',
    ).replace(/\/+$/u, '');
    const apiKey = String(this.configuredApiKey || process.env.ORACLE_EXTERNAL_API_KEY || '');
    if (!baseUrl || !apiKey || !/^https:\/\//iu.test(baseUrl)) {
      throw new Error('oracle_external_provider_invalid_config');
    }
    return { baseUrl, apiKey };
  }
}
