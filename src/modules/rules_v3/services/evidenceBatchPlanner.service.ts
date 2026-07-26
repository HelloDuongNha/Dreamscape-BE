import crypto from 'crypto';
import { DocumentExtractionPlan } from './documentResearchProfile.types';
import {
  EvidenceBatch,
  EvidenceBatchPlan,
  EvidenceBatchPlannerOptions,
  EvidenceChunkInput,
  PlannedEvidenceChunk,
} from './evidenceBatchPlanner.types';

const DEFAULT_MAX_CHARACTERS = 14_000;
const DEFAULT_MAX_CHUNKS = 4;

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

/**
 * Creates deterministic, bounded evidence batches without changing chunk text.
 * Exact citation offsets therefore remain relative to the persisted canonical chunk.
 */
export function planEvidenceBatches(
  extractionPlan: DocumentExtractionPlan,
  chunks: EvidenceChunkInput[],
  options: EvidenceBatchPlannerOptions = {}
): EvidenceBatchPlan {
  const maxCharacters = positiveInteger(options.maxCharactersPerBatch, DEFAULT_MAX_CHARACTERS);
  const maxChunks = positiveInteger(options.maxChunksPerBatch, DEFAULT_MAX_CHUNKS);
  const decisions = new Map(extractionPlan.sectionDecisions.map(decision => [decision.sectionId, decision]));
  const seenChunkIds = new Set<string>();
  const selected: PlannedEvidenceChunk[] = [];
  let skippedChunkCount = 0;
  let missingSectionChunkCount = 0;
  let duplicateChunkCount = 0;

  const ordered = [...chunks].sort((a, b) => a.chunkOrder - b.chunkOrder || a.chunkId.localeCompare(b.chunkId));
  for (const chunk of ordered) {
    if (seenChunkIds.has(chunk.chunkId)) {
      duplicateChunkCount++;
      continue;
    }
    seenChunkIds.add(chunk.chunkId);

    const decision = decisions.get(chunk.sectionId);
    if (!decision) {
      missingSectionChunkCount++;
      continue;
    }
    if (decision.usage !== 'target' || decision.strategy === 'skip' || !chunk.text.trim()) {
      skippedChunkCount++;
      continue;
    }

    selected.push({
      ...chunk,
      sectionRole: decision.sectionRole,
      strategy: decision.strategy,
      contentHash: sha256(chunk.text),
    });
  }

  const batches: EvidenceBatch[] = [];
  let current: PlannedEvidenceChunk[] = [];
  let currentCharacters = 0;

  const flush = () => {
    if (!current.length) return;
    const strategy = current[0].strategy;
    const pageStarts = current.map(chunk => chunk.pageStart).filter((v): v is number => Number.isFinite(v));
    const pageEnds = current.map(chunk => chunk.pageEnd).filter((v): v is number => Number.isFinite(v));
    const fingerprint = current.map(chunk => `${chunk.chunkId}:${chunk.contentHash}`).join('|');
    batches.push({
      batchId: `evb_${sha256(`${extractionPlan.documentId}|${strategy}|${fingerprint}`).slice(0, 20)}`,
      strategy,
      sourceLanguage: extractionPlan.sourceLanguage,
      chunks: current,
      characterCount: currentCharacters,
      pageStart: pageStarts.length ? Math.min(...pageStarts) : undefined,
      pageEnd: pageEnds.length ? Math.max(...pageEnds) : undefined,
      oversizedSingleChunk: current.length === 1 && currentCharacters > maxCharacters,
    });
    current = [];
    currentCharacters = 0;
  };

  for (const chunk of selected) {
    const strategyChanged = current.length > 0 && current[0].strategy !== chunk.strategy;
    const sectionChanged = current.length > 0 && current[0].sectionId !== chunk.sectionId;
    const wouldOverflow = current.length > 0 && currentCharacters + chunk.text.length > maxCharacters;
    const reachedChunkLimit = current.length >= maxChunks;
    if (strategyChanged || sectionChanged || wouldOverflow || reachedChunkLimit) flush();
    current.push(chunk);
    currentCharacters += chunk.text.length;
    if (chunk.text.length > maxCharacters) flush();
  }
  flush();

  return {
    documentId: extractionPlan.documentId,
    sourceLanguage: extractionPlan.sourceLanguage,
    researchType: extractionPlan.documentType,
    batches,
    diagnostics: {
      inputChunkCount: chunks.length,
      targetChunkCount: selected.length,
      skippedChunkCount,
      missingSectionChunkCount,
      duplicateChunkCount,
      oversizedChunkCount: batches.filter(batch => batch.oversizedSingleChunk).length,
      batchCount: batches.length,
    },
  };
}
