import {
  RuleV3GenerationProvider,
  ProviderCandidate,
  RuleV3ProviderInput
} from '../ruleV3GenerationProvider.types';
import {
  GEMINI_JSON_SCHEMA,
  validateProviderResponse
} from '../ruleV3ProviderResponseValidator.service';
import { buildRuleV3ExtractionPrompt } from '../ruleV3ExtractionPrompt.service';

export class RuleV3GeminiProvider implements RuleV3GenerationProvider {
  name = 'gemini' as const;
  modelName: string;

  constructor(modelName?: string) {
    const rawModel = modelName || process.env.RULE_V3_GEMINI_MODEL || 'gemini-3.5-flash';
    const modelRegex = /^gemini-[a-zA-Z0-9\.-]+$/;
    if (!modelRegex.test(rawModel)) {
      throw new Error('invalid_provider');
    }
    this.modelName = rawModel;
  }

  async generateCandidates(
    input: RuleV3ProviderInput,
    abortSignal?: AbortSignal
  ): Promise<ProviderCandidate[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('provider_unavailable');
    }

    const encodedModel = encodeURIComponent(this.modelName);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:generateContent`;

    const prompt = buildRuleV3ExtractionPrompt(input);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_JSON_SCHEMA
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

    const resJson = await response.json() as any;
    const textResponse = resJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResponse) {
      throw new Error('provider_schema_invalid');
    }

    return validateProviderResponse(textResponse);
  }

}
