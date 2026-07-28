import { startRuleV3FullExtraction } from './ruleV3FullExtraction.service';
import { getDefaultProductionRuleV3Provider } from '../providers/ruleV3ProviderRuntime.service';

export type AutomaticRuleExtractionStart =
  | {
    runId: string;
    reused: boolean;
    status: 'pending' | 'success';
  }
  | {
    status: 'failed';
    errorCode: 'provider_unavailable' | 'automatic_start_failed';
  };

// Start the same extraction pipeline used by the moderation tool when a source is approved.
export async function startAutomaticRuleV3Extraction(
  sourceId: string,
): Promise<AutomaticRuleExtractionStart> {
  const provider = await getDefaultProductionRuleV3Provider();
  if (!provider) {
    return {
      status: 'failed',
      errorCode: 'provider_unavailable',
    };
  }
  return startRuleV3FullExtraction(sourceId, provider);
}
