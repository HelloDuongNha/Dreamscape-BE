import type { EvidenceClaimBinding } from './citationClaim';

export interface DreamEvidenceRecord {
  answer: string;
  claimBindings: EvidenceClaimBinding[];
}

// Collects unresolved evidence context from the current analysis and stored versions.
export function collectDreamEvidenceRecord(dream: any): DreamEvidenceRecord {
  const analyses = distinctDreamAnalyses(dream);
  return {
    answer: analyses.map(dreamAnalysisEvidenceText).filter(Boolean).join('\n'),
    claimBindings: analyses.flatMap((analysis) =>
      Array.isArray(analysis?.claim_bindings) ? analysis.claim_bindings : []),
  };
}

function distinctDreamAnalyses(dream: any): any[] {
  const analyses = [
    dream?.ai_result,
    dream?.aiAnalysis,
    ...(dream?.edit_history || []).map((history: any) => history?.ai_result),
  ].filter((analysis) => analysis && typeof analysis === 'object');
  return [...new Set(analyses)];
}

function dreamAnalysisEvidenceText(analysis: any): string {
  return [
    analysis?.core_analysis,
    analysis?.summary,
    ...(analysis?.interpretive_threads || []).map((thread: any) => thread?.reasoning),
    ...(analysis?.scientific_context_notes || []).map((note: any) => note?.note),
  ].filter(Boolean).join('\n');
}
