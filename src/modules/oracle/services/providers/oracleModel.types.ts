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
