const activeDreamAnalysisControllers = new Map<string, AbortController>();

// Stop one active provider request without changing the persisted Dream state.
export function abortDreamAnalysisExecution(dreamId: string, runId: string): void {
  activeDreamAnalysisControllers.get(`${dreamId}:${runId}`)?.abort();
}

// Register the provider controller for a persisted analysis run.
export function registerDreamAnalysisController(
  dreamId: string,
  runId: string,
  controller: AbortController,
): void {
  activeDreamAnalysisControllers.set(`${dreamId}:${runId}`, controller);
}

// Remove the controller only when it still belongs to the finishing run.
export function clearDreamAnalysisController(
  dreamId: string,
  runId: string,
  controller: AbortController,
): void {
  const key = `${dreamId}:${runId}`;
  if (activeDreamAnalysisControllers.get(key) === controller) {
    activeDreamAnalysisControllers.delete(key);
  }
}
