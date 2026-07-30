export interface RagEvaluationClaim {
  text: string;
  citationIds: string[];
  supported: boolean;
}

export interface RagEvaluationCase {
  id: string;
  relevantContextIds: string[];
  retrievedContextIds: string[];
  claims: RagEvaluationClaim[];
  forbiddenContextIds?: string[];
  answerRelevance?: number;
}

export interface RagCaseMetrics {
  id: string;
  precisionAtK: number;
  recallAtK: number;
  reciprocalRank: number;
  faithfulness: number;
  citationTraceability: number;
  privacyPass: boolean;
  answerRelevance: number | null;
}

export interface RagEvaluationSummary {
  caseCount: number;
  macroPrecisionAtK: number;
  macroRecallAtK: number;
  meanReciprocalRank: number;
  macroFaithfulness: number;
  macroCitationTraceability: number;
  privacyPassRate: number;
  macroAnswerRelevance: number | null;
  cases: RagCaseMetrics[];
}

export function evaluateRagCases(cases: RagEvaluationCase[]): RagEvaluationSummary {
  if (cases.length === 0) throw new Error('The RAG evaluation dataset is empty.');
  const results = cases.map(evaluateRagCase);
  const relevanceValues = results
    .map(item => item.answerRelevance)
    .filter((value): value is number => value !== null);
  return {
    caseCount: results.length,
    macroPrecisionAtK: average(results.map(item => item.precisionAtK)),
    macroRecallAtK: average(results.map(item => item.recallAtK)),
    meanReciprocalRank: average(results.map(item => item.reciprocalRank)),
    macroFaithfulness: average(results.map(item => item.faithfulness)),
    macroCitationTraceability: average(results.map(item => item.citationTraceability)),
    privacyPassRate: average(results.map(item => item.privacyPass ? 1 : 0)),
    macroAnswerRelevance: relevanceValues.length ? average(relevanceValues) : null,
    cases: results,
  };
}

export function evaluateRagCase(item: RagEvaluationCase): RagCaseMetrics {
  const relevant = new Set(item.relevantContextIds);
  const retrieved = item.retrievedContextIds;
  const retrievedSet = new Set(retrieved);
  const relevantRetrieved = retrieved.filter(id => relevant.has(id));
  const firstRelevantIndex = retrieved.findIndex(id => relevant.has(id));
  const supportedClaims = item.claims.filter(claim =>
    claim.supported
    && claim.citationIds.length > 0
    && claim.citationIds.every(id => retrievedSet.has(id)));
  const traceableClaims = item.claims.filter(claim =>
    claim.citationIds.length > 0
    && claim.citationIds.every(id => retrievedSet.has(id)));
  const forbidden = new Set(item.forbiddenContextIds || []);
  return {
    id: item.id,
    precisionAtK: retrieved.length ? relevantRetrieved.length / retrieved.length : 0,
    recallAtK: relevant.size ? new Set(relevantRetrieved).size / relevant.size : 1,
    reciprocalRank: firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0,
    faithfulness: item.claims.length ? supportedClaims.length / item.claims.length : 1,
    citationTraceability: item.claims.length ? traceableClaims.length / item.claims.length : 1,
    privacyPass: !retrieved.some(id => forbidden.has(id)),
    answerRelevance: normaliseOptionalScore(item.answerRelevance),
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normaliseOptionalScore(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}
