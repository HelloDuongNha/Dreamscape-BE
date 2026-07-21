import {
  RuleV3GenerationProvider,
  ProviderCandidate,
  RuleV3ProviderInput
} from '../ruleV3GenerationProvider.types';
import {
  OLLAMA_JSON_SCHEMA,
  validateProviderResponse
} from '../ruleV3ProviderResponseValidator.service';
import { buildRuleV3ExtractionPrompt } from '../ruleV3ExtractionPrompt.service';

export class RuleV3OllamaProvider implements RuleV3GenerationProvider {
  name = 'ollama' as const;
  modelName: string;

  constructor(modelName?: string) {
    this.modelName = modelName || process.env.RULE_V3_OLLAMA_MODEL || 'qwen2.5:14b';
  }

  async generateCandidates(
    input: RuleV3ProviderInput,
    abortSignal?: AbortSignal
  ): Promise<ProviderCandidate[]> {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    const url = `${baseUrl}/api/generate`;

    const prompt = buildRuleV3ExtractionPrompt(input);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          prompt,
          format: OLLAMA_JSON_SCHEMA,
          stream: false,
          options: {
            temperature: 0
          }
        }),
        signal: abortSignal
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('provider_timeout');
      }
      throw new Error('provider_unavailable');
    }

    if (!response.ok) {
      throw new Error('provider_unavailable');
    }

    const json = await response.json() as { response?: string };
    if (!json || typeof json.response !== 'string') {
      throw new Error('provider_schema_invalid');
    }

    return validateProviderResponse(json.response);
  }

}
