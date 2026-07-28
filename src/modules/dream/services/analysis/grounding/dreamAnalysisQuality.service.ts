import type { ILLMOutput } from '../../../../../infrastructure/llm.service';
import {
  isResearchableOracleEvidenceClaim,
} from '../../../../oracle/services/evidence/oracleEvidenceClaim.service';

export interface DreamAnalysisDepth {
  acceptable: boolean;
  coreWordCount: number;
  reasoningWordCount: number;
  threadCount: number;
  symbolicNoteCount: number;
  shallowSymbolCount: number;
  evidenceClaimCount: number;
  linkedEvidenceClaimCount: number;
}

// Keeps post analysis and Oracle on the same capable model unless Dream has an explicit override.
export function resolveDreamAnalysisModel(): string {
  return process.env.DREAM_OLLAMA_ANALYSIS_MODEL
    || process.env.ORACLE_OLLAMA_ANALYSIS_MODEL
    || process.env.ORACLE_OLLAMA_MODEL
    || 'qwen3.6:27b';
}

// Checks whether the analysis depth is proportional to the supplied narrative.
export function assessDreamAnalysisDepth(
  analysis: ILLMOutput,
  narrative: string,
  hasCitableRules = false,
): DreamAnalysisDepth {
  const narrativeWords = countWords(narrative);
  const coreWordCount = countWords(analysis.core_analysis);
  const threads = Array.isArray(analysis.interpretive_threads)
    ? analysis.interpretive_threads
    : [];
  const reasoningWordCount = threads.reduce(
    (total, thread) => total + countWords(thread.reasoning),
    0,
  );
  const symbolicNotes = Array.isArray(analysis.symbolic_notes)
    ? analysis.symbolic_notes
    : [];
  const shallowSymbolCount = symbolicNotes.filter(note =>
    countWords(note?.meaning) < 18
    || countSentences(note?.meaning) < 2,
  ).length;
  const thresholds = depthThresholds(narrativeWords);
  const evidenceClaims = validEvidenceClaims(analysis);
  const minimumEvidenceClaims = narrativeWords >= 120 ? 2 : 1;

  return {
    acceptable: coreWordCount >= thresholds.core
      && coreWordCount + reasoningWordCount >= thresholds.total
      && threads.length >= thresholds.threads
      && symbolicNotes.length >= (narrativeWords >= 120 ? 2 : 1)
      && shallowSymbolCount === 0
      && evidenceClaims.length >= minimumEvidenceClaims
      && (!hasCitableRules || evidenceClaims.some(item => item.supportRuleId)),
    coreWordCount,
    reasoningWordCount,
    threadCount: threads.length,
    symbolicNoteCount: symbolicNotes.length,
    shallowSymbolCount,
    evidenceClaimCount: evidenceClaims.length,
    linkedEvidenceClaimCount: evidenceClaims.filter(item => item.supportRuleId).length,
  };
}

// Keeps the more complete valid answer when a repair attempt is not better.
export function selectDeeperDreamAnalysis(
  first: ILLMOutput,
  repaired: ILLMOutput,
  narrative: string,
  hasCitableRules = false,
): ILLMOutput {
  const firstDepth = assessDreamAnalysisDepth(first, narrative, hasCitableRules);
  const repairedDepth = assessDreamAnalysisDepth(repaired, narrative, hasCitableRules);
  if (repairedDepth.acceptable !== firstDepth.acceptable) {
    return repairedDepth.acceptable ? repaired : first;
  }
  if (repairedDepth.shallowSymbolCount !== firstDepth.shallowSymbolCount) {
    return repairedDepth.shallowSymbolCount < firstDepth.shallowSymbolCount
      ? repaired
      : first;
  }
  if (repairedDepth.evidenceClaimCount !== firstDepth.evidenceClaimCount) {
    return repairedDepth.evidenceClaimCount > firstDepth.evidenceClaimCount
      ? repaired
      : first;
  }
  if (hasCitableRules
    && repairedDepth.linkedEvidenceClaimCount !== firstDepth.linkedEvidenceClaimCount) {
    return repairedDepth.linkedEvidenceClaimCount > firstDepth.linkedEvidenceClaimCount
      ? repaired
      : first;
  }
  return analysisDepthScore(repaired) > analysisDepthScore(first) ? repaired : first;
}

function validEvidenceClaims(analysis: ILLMOutput) {
  return (analysis.evidence_claims || []).filter((claim) => {
    const text = readClaimContent(analysis, String(claim.contentPath || ''));
    const claimText = String(claim.claimText || '').trim();
    return claimText.length > 0
      && text.includes(claimText)
      && isResearchableOracleEvidenceClaim(claimText);
  });
}

function readClaimContent(analysis: ILLMOutput, contentPath: string): string {
  if (contentPath === 'core_analysis') return String(analysis.core_analysis || '');
  const index = Number(
    contentPath.match(/^interpretive_threads\.(\d+)\.reasoning$/u)?.[1],
  );
  return Number.isInteger(index)
    ? String(analysis.interpretive_threads?.[index]?.reasoning || '')
    : '';
}

function depthThresholds(narrativeWords: number): { core: number; total: number; threads: number } {
  if (narrativeWords >= 120) return { core: 220, total: 360, threads: 2 };
  if (narrativeWords >= 60) return { core: 140, total: 220, threads: 1 };
  return { core: 70, total: 100, threads: 1 };
}

function analysisDepthScore(analysis: ILLMOutput): number {
  const threads = Array.isArray(analysis.interpretive_threads)
    ? analysis.interpretive_threads
    : [];
  return countWords(analysis.core_analysis)
    + threads.reduce((total, thread) => total + countWords(thread.reasoning), 0)
    + (analysis.symbolic_notes || []).reduce((total, note) => total + countWords(note.meaning), 0)
    + threads.length * 30;
}

function countWords(value: unknown): number {
  return String(value || '').trim().split(/\s+/u).filter(Boolean).length;
}

function countSentences(value: unknown): number {
  return String(value || '')
    .split(/(?<=[.!?…])\s+/u)
    .map(item => item.trim())
    .filter(Boolean)
    .length;
}
