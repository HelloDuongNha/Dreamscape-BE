import { RuleV3GeminiProvider } from './ruleV3GeminiProvider.service';
import { RuleV3OllamaProvider } from './ruleV3OllamaProvider.service';
import type { RuleV3GenerationProvider } from './ruleV3GenerationProvider.types';
import { ollamaRequestHeaders } from '../../../../infrastructure/ollamaHttp';

export type RuleV3ProviderName = 'ollama' | 'gemini';
export type RuleV3ProviderFailure =
  | 'not_allowed'
  | 'not_configured'
  | 'runtime_unreachable'
  | 'model_missing'
  | null;

export interface RuleV3ProviderStatus {
  provider: RuleV3ProviderName;
  configured: boolean;
  available: boolean;
  model: string | null;
  reasonCode: RuleV3ProviderFailure;
}

export interface RuleV3ProviderAvailability {
  defaultProvider: RuleV3ProviderName | null;
  availableProviders: RuleV3ProviderName[];
  providerStatuses: RuleV3ProviderStatus[];
}

// Resolve provider health and configuration without involving HTTP controllers.
export async function getProductionAvailabilityConfig(): Promise<RuleV3ProviderAvailability> {
  const allowed = configuredAllowedProviders();
  const gemini = geminiStatus(allowed);
  const ollama = await ollamaStatus(allowed);
  const providerStatuses = [gemini, ollama];
  const availableProviders = providerStatuses
    .filter((status) => status.available)
    .map((status) => status.provider);
  const configuredDefault = configuredDefaultProvider();
  const defaultProvider = configuredDefault && availableProviders.includes(configuredDefault)
    ? configuredDefault
    : null;
  return { defaultProvider, availableProviders, providerStatuses };
}

export function createRuleV3Provider(
  provider: RuleV3ProviderName,
  model?: string,
): RuleV3GenerationProvider {
  return provider === 'ollama'
    ? new RuleV3OllamaProvider(model)
    : new RuleV3GeminiProvider(model);
}

export async function getDefaultProductionRuleV3Provider(): Promise<RuleV3GenerationProvider | null> {
  const availability = await getProductionAvailabilityConfig();
  return availability.defaultProvider
    ? createRuleV3Provider(availability.defaultProvider)
    : null;
}

export async function checkOllamaAvailability(
  baseUrl: string,
  modelName: string,
): Promise<{ available: boolean; reasonCode: 'runtime_unreachable' | 'model_missing' | null }> {
  try {
    const response = await fetchOllamaModels(baseUrl);
    if (!response.ok) return { available: false, reasonCode: 'runtime_unreachable' };
    const data = await response.json() as { models?: Array<{ name: string; model?: string }> };
    if (!Array.isArray(data.models)) return { available: false, reasonCode: 'model_missing' };
    const available = data.models.some((model) =>
      modelNameMatches(model.name, modelName) || modelNameMatches(model.model, modelName));
    return available
      ? { available: true, reasonCode: null }
      : { available: false, reasonCode: 'model_missing' };
  } catch {
    return { available: false, reasonCode: 'runtime_unreachable' };
  }
}

async function fetchOllamaModels(baseUrl: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    return await fetch(`${baseUrl}/api/tags`, {
      headers: ollamaRequestHeaders(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function configuredAllowedProviders(): Set<string> {
  return new Set(
    String(process.env.RULE_V3_ALLOWED_PREVIEW_PROVIDERS || '')
      .split(',')
      .map((provider) => provider.trim().toLowerCase())
      .filter(Boolean),
  );
}

function configuredDefaultProvider(): RuleV3ProviderName | null {
  const value = String(process.env.RULE_V3_PROVIDER || '').trim().toLowerCase();
  return value === 'ollama' || value === 'gemini' ? value : null;
}

function geminiStatus(allowed: Set<string>): RuleV3ProviderStatus {
  const model = process.env.RULE_V3_GEMINI_MODEL?.trim() || null;
  if (!allowed.has('gemini')) return unavailableStatus('gemini', model, 'not_allowed');
  if (!model || !process.env.GEMINI_API_KEY?.trim()) {
    return unavailableStatus('gemini', model, 'not_configured');
  }
  return { provider: 'gemini', configured: true, available: true, model, reasonCode: null };
}

async function ollamaStatus(allowed: Set<string>): Promise<RuleV3ProviderStatus> {
  const model = process.env.RULE_V3_OLLAMA_MODEL?.trim() || null;
  const baseUrl = process.env.OLLAMA_BASE_URL?.trim() || null;
  if (!allowed.has('ollama')) return unavailableStatus('ollama', model, 'not_allowed');
  if (!model || !baseUrl) return unavailableStatus('ollama', model, 'not_configured');
  const health = await checkOllamaAvailability(baseUrl, model);
  return {
    provider: 'ollama',
    configured: true,
    available: health.available,
    model,
    reasonCode: health.reasonCode,
  };
}

function unavailableStatus(
  provider: RuleV3ProviderName,
  model: string | null,
  reasonCode: Exclude<RuleV3ProviderFailure, 'runtime_unreachable' | 'model_missing' | null>,
): RuleV3ProviderStatus {
  return { provider, configured: false, available: false, model, reasonCode };
}

function modelNameMatches(candidate: string | undefined, configured: string): boolean {
  if (!candidate) return false;
  const normalize = (value: string) => value.trim().includes(':')
    ? [value.trim()]
    : [value.trim(), `${value.trim()}:latest`];
  const expected = normalize(configured);
  return normalize(candidate).some((name) => expected.includes(name));
}
