import {
  getRuleV3SourceSummary,
  startRuleV3FullExtraction,
} from './ruleV3FullExtraction.service';
import { RuleV3GeminiProvider } from './providers/ruleV3GeminiProvider.service';
import { RuleV3OllamaProvider } from './providers/ruleV3OllamaProvider.service';
import type { RuleV3GenerationProvider } from './ruleV3GenerationProvider.types';

export interface AutomaticRuleExtractionStart {
  runId: string;
  reused: boolean;
  status: 'pending' | 'success';
}

// Start the same extraction pipeline used by the moderation tool when a source is approved.
export async function startAutomaticRuleV3Extraction(
  sourceId: string,
): Promise<AutomaticRuleExtractionStart | null> {
  const existing = await findReusableExtraction(sourceId);
  if (existing) return existing;
  const provider = resolveConfiguredRuleProvider();
  if (!provider) return null;
  return startRuleV3FullExtraction(sourceId, provider);
}

async function findReusableExtraction(
  sourceId: string,
): Promise<AutomaticRuleExtractionStart | null> {
  const summary = await getRuleV3SourceSummary(sourceId);
  const latest = summary.latestRun;
  if (!latest || (latest.status !== 'pending' && latest.status !== 'success')) return null;
  return {
    runId: String(latest.runId),
    reused: true,
    status: latest.status,
  };
}

function resolveConfiguredRuleProvider(): RuleV3GenerationProvider | null {
  const providerName = String(process.env.RULE_V3_PROVIDER || '').trim().toLowerCase();
  const allowedProviders = new Set(
    String(process.env.RULE_V3_ALLOWED_PREVIEW_PROVIDERS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!allowedProviders.has(providerName)) return null;

  if (providerName === 'gemini') {
    if (!process.env.GEMINI_API_KEY?.trim() || !process.env.RULE_V3_GEMINI_MODEL?.trim()) return null;
    return new RuleV3GeminiProvider();
  }
  if (providerName === 'ollama') {
    if (!process.env.OLLAMA_BASE_URL?.trim() || !process.env.RULE_V3_OLLAMA_MODEL?.trim()) return null;
    return new RuleV3OllamaProvider();
  }
  return null;
}
