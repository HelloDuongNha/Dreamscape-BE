// Phase I18N-3B.2B-MT0 — Local Machine Translation Benchmark Runner
import { benchmarkFixtures } from './mtBenchmarkFixtures';
import { ModelMetrics, WorkerTranslateResponse, WorkerTranslateRequest } from './mtBenchmark.types';

/**
 * Checks if all expected protected tokens (citations, DOIs, numbers, p-values, units)
 * are present exactly in the translated text.
 */
export function verifyProtectedTokens(
  originalText: string,
  translatedText: string,
  expectedTokens: string[]
): { isPreserved: boolean; missingTokens: string[] } {
  const missingTokens: string[] = [];
  
  for (const token of expectedTokens) {
    // Simple exact substring match
    if (!translatedText.includes(token)) {
      missingTokens.push(token);
    }
  }

  return {
    isPreserved: missingTokens.length === 0,
    missingTokens
  };
}

/**
 * Mock/Skeleton of the Local MT Benchmark Runner.
 * Under MT0 constraints, it must return 'engine_unavailable' and avoid downloading weights/packages.
 */
export async function runLocalMTBenchmark(modelName: string): Promise<ModelMetrics> {
  const startLoad = Date.now();
  
  // Under Phase MT0, we return 'engine_unavailable' response simulation.
  const simulatedResponse: WorkerTranslateResponse = {
    error: 'Offline engine is not enabled in Phase MT0. No weights downloaded.',
    errorCode: 'engine_unavailable',
    loadTimeMs: Date.now() - startLoad,
    inferenceTimeMs: 0,
    peakRssBytes: process.memoryUsage().rss
  };

  const failures = benchmarkFixtures.map(fixture => ({
    targetId: fixture.targetId,
    originalText: fixture.text,
    translatedText: undefined as string | undefined,
    reason: `Engine unavailable: ${simulatedResponse.error}`
  }));

  // JSON-lines Worker Protocol Schema documentation/simulation
  const simulatedWorkerRequest: WorkerTranslateRequest = {
    modelName,
    sourceLanguage: 'en',
    targetLanguage: 'vi',
    text: benchmarkFixtures[0].text
  };

  const simulatedJsonLineRequest = JSON.stringify(simulatedWorkerRequest);
  const simulatedJsonLineResponse = JSON.stringify(simulatedResponse);

  console.log(`[MT0 Protocol Audit] Request JSON line: ${simulatedJsonLineRequest}`);
  console.log(`[MT0 Protocol Audit] Response JSON line: ${simulatedJsonLineResponse}`);

  return {
    modelName,
    isDeterministic: false,
    coldLoadTimeMs: simulatedResponse.loadTimeMs || 0,
    coldLatencyMs: 0,
    warmLatencyMs: 0,
    peakRssBytes: simulatedResponse.peakRssBytes || 0,
    pipelineAccuracy: 0.0,
    failures
  };
}
