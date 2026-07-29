import crypto from 'crypto';
import type { EvidenceBatchPlan } from './evidenceBatchPlanner.types';
import type { EvidenceWorkUnit } from './hierarchicalEvidencePlanner.types';
import type { EvidenceCandidateGroup } from './hierarchicalEvidenceGrouping.service';

interface PlannedChunk {
  chunkId: string;
  text: string;
  chunkOrder: number;
}

// Builds work units, assigns every technical batch, and rejects incomplete plans.
export function buildEvidenceWorkUnits(
  documentId: string,
  candidateGroups: EvidenceCandidateGroup[],
  evidenceBatchPlan: EvidenceBatchPlan,
): EvidenceWorkUnit[] {
  const chunksBySection = indexChunksBySection(evidenceBatchPlan);
  const workUnits = createWorkUnits(documentId, candidateGroups, chunksBySection);
  assignBatchesToWorkUnits(workUnits, evidenceBatchPlan);
  assertEvidenceWorkUnitInvariants(workUnits, evidenceBatchPlan);
  return workUnits;
}

function indexChunksBySection(evidenceBatchPlan: EvidenceBatchPlan): Map<string, PlannedChunk[]> {
  const chunksBySection = new Map<string, PlannedChunk[]>();
  for (const batch of evidenceBatchPlan.batches) {
    for (const chunk of batch.chunks) {
      const chunks = chunksBySection.get(chunk.sectionId) || [];
      chunks.push({
        chunkId: chunk.chunkId,
        text: chunk.text,
        chunkOrder: chunk.chunkOrder,
      });
      chunksBySection.set(chunk.sectionId, chunks);
    }
  }
  return chunksBySection;
}

function createWorkUnits(
  documentId: string,
  candidateGroups: EvidenceCandidateGroup[],
  chunksBySection: Map<string, PlannedChunk[]>,
): EvidenceWorkUnit[] {
  const workUnits: EvidenceWorkUnit[] = [];

  for (const group of candidateGroups) {
    const chunks = group.sectionIds.flatMap(sectionId =>
      [...(chunksBySection.get(sectionId) || [])].sort((left, right) =>
        left.chunkOrder - right.chunkOrder),
    );
    if (chunks.length === 0) continue;

    workUnits.push({
      workUnitId: `wku_${sha256(`${documentId}|${group.sectionIds.join(',')}`).slice(0, 20)}`,
      ordinal: workUnits.length + 1,
      label: group.label,
      strategy: group.strategy,
      sectionIds: group.sectionIds,
      targetChunkIds: chunks.map(chunk => chunk.chunkId),
      chunkCount: chunks.length,
      characterCount: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
      batchIds: [],
      batchCount: 0,
    });
  }

  return workUnits;
}

function assignBatchesToWorkUnits(
  workUnits: EvidenceWorkUnit[],
  evidenceBatchPlan: EvidenceBatchPlan,
): void {
  const workUnitBySection = new Map<string, EvidenceWorkUnit>();
  for (const workUnit of workUnits) {
    for (const sectionId of workUnit.sectionIds) {
      workUnitBySection.set(sectionId, workUnit);
    }
  }

  for (const batch of evidenceBatchPlan.batches) {
    if (batch.chunks.length === 0) continue;
    const matchingUnits = new Set(
      batch.chunks
        .map(chunk => workUnitBySection.get(chunk.sectionId))
        .filter((unit): unit is EvidenceWorkUnit => Boolean(unit)),
    );
    if (matchingUnits.size > 1) {
      throw new Error('Invalid hierarchical evidence plan: batch spans multiple work units');
    }

    const [workUnit] = matchingUnits;
    if (!workUnit) continue;
    workUnit.batchIds.push(batch.batchId);
    workUnit.batchCount = workUnit.batchIds.length;
  }
}

function assertEvidenceWorkUnitInvariants(
  workUnits: EvidenceWorkUnit[],
  evidenceBatchPlan: EvidenceBatchPlan,
): void {
  const expectedChunkIds = new Set(
    evidenceBatchPlan.batches.flatMap(batch => batch.chunks.map(chunk => chunk.chunkId)),
  );
  const expectedBatchIds = new Set(evidenceBatchPlan.batches.map(batch => batch.batchId));
  const assignedChunkIds = new Set<string>();
  const assignedBatchIds = new Set<string>();

  for (const workUnit of workUnits) {
    if (workUnit.chunkCount > 0 && workUnit.batchCount === 0) {
      throw new Error(`Invalid hierarchical evidence plan: work unit ${workUnit.label} has chunks but zero batches`);
    }
    addUniqueIds(
      workUnit.targetChunkIds,
      assignedChunkIds,
      'Invalid hierarchical evidence plan: chunk assigned to multiple work units',
    );
    addUniqueIds(
      workUnit.batchIds,
      assignedBatchIds,
      'Invalid hierarchical evidence plan: batch assigned to multiple work units',
    );
  }

  if (!setsEqual(expectedChunkIds, assignedChunkIds)) {
    throw new Error('Invalid hierarchical evidence plan: target chunk mismatch');
  }
  if (!setsEqual(expectedBatchIds, assignedBatchIds)) {
    throw new Error('Invalid hierarchical evidence plan: technical batch mismatch');
  }
}

function addUniqueIds(ids: string[], target: Set<string>, errorMessage: string): void {
  for (const id of ids) {
    if (target.has(id)) throw new Error(errorMessage);
    target.add(id);
  }
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every(value => right.has(value));
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
