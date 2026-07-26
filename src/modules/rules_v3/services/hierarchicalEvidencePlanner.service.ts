import crypto from 'crypto';
import { isMajorChapterHeading } from './documentProfiler.service';
import type { DocumentResearchProfile, DocumentExtractionPlan, ExtractionStrategy } from './documentResearchProfile.types';
import type { EvidenceBatchPlan } from './evidenceBatchPlanner.types';
import type { HierarchicalEvidencePlan, EvidenceWorkUnit } from './hierarchicalEvidencePlanner.types';

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Pure, deterministic hierarchical evidence work-unit planner.
 * Groups target sections and chunks into meaningful units (by chapter for books, by section for articles).
 */
export function planHierarchicalEvidence(
  profile: DocumentResearchProfile,
  extractionPlan: DocumentExtractionPlan,
  evidenceBatchPlan: EvidenceBatchPlan
): HierarchicalEvidencePlan {
  const sectionProfiles = profile.sectionProfiles;
  const decisionsMap = new Map(extractionPlan.sectionDecisions.map(d => [d.sectionId, d]));

  // 1. Determine organization mode and define candidate groups
  let organizationMode: 'article_sections' | 'book_chapters' = 'article_sections';
  const candidateGroups: { label: string; strategy: ExtractionStrategy; sectionIds: string[] }[] = [];

  if (profile.documentType === 'book_or_monograph') {
    const hasChapters = sectionProfiles.some(s => isMajorChapterHeading(s.heading));
    if (hasChapters) {
      organizationMode = 'book_chapters';

      interface ChapterGroup {
        chapterHeading: string;
        sections: { sectionId: string; strategy: ExtractionStrategy }[];
      }

      const chapters: ChapterGroup[] = [];
      let currentChapterHeading: string | null = null;
      let currentChapterSections: { sectionId: string; strategy: ExtractionStrategy }[] = [];

      for (const sec of sectionProfiles) {
        const decision = decisionsMap.get(sec.sectionId);
        if (!decision) continue;

        if (isMajorChapterHeading(sec.heading)) {
          if (currentChapterHeading !== null) {
            chapters.push({
              chapterHeading: currentChapterHeading,
              sections: currentChapterSections,
            });
          }
          currentChapterHeading = sec.heading;
          currentChapterSections = [];
        }

        if (currentChapterHeading !== null) {
          currentChapterSections.push({
            sectionId: sec.sectionId,
            strategy: decision.strategy,
          });
        }
      }

      if (currentChapterHeading !== null) {
        chapters.push({
          chapterHeading: currentChapterHeading,
          sections: currentChapterSections,
        });
      }

      // Track split groups to format split labels
      const tempGroups: { chapterHeading: string; strategy: ExtractionStrategy; sectionIds: string[] }[] = [];
      for (const chap of chapters) {
        const targetSections = chap.sections.filter(s => {
          const dec = decisionsMap.get(s.sectionId);
          return dec && dec.usage === 'target' && dec.strategy !== 'skip';
        });

        if (targetSections.length === 0) continue;

        let currentStrategy: ExtractionStrategy | null = null;
        let currentSectionIds: string[] = [];

        for (const sec of targetSections) {
          if (currentStrategy === null) {
            currentStrategy = sec.strategy;
            currentSectionIds = [sec.sectionId];
          } else if (currentStrategy === sec.strategy) {
            currentSectionIds.push(sec.sectionId);
          } else {
            tempGroups.push({
              chapterHeading: chap.chapterHeading,
              strategy: currentStrategy,
              sectionIds: currentSectionIds,
            });
            currentStrategy = sec.strategy;
            currentSectionIds = [sec.sectionId];
          }
        }

        if (currentStrategy !== null) {
          tempGroups.push({
            chapterHeading: chap.chapterHeading,
            strategy: currentStrategy,
            sectionIds: currentSectionIds,
          });
        }
      }

      const chapterUsageCount = new Map<string, number>();
      for (const g of tempGroups) {
        chapterUsageCount.set(g.chapterHeading, (chapterUsageCount.get(g.chapterHeading) || 0) + 1);
      }

      for (const g of tempGroups) {
        const isSplit = (chapterUsageCount.get(g.chapterHeading) || 0) > 1;
        const label = isSplit ? `${g.chapterHeading} (${g.strategy})` : g.chapterHeading;
        candidateGroups.push({
          label,
          strategy: g.strategy,
          sectionIds: g.sectionIds,
        });
      }
    }
  }

  // Fallback / standard article grouping
  if (organizationMode === 'article_sections') {
    for (const dec of extractionPlan.sectionDecisions) {
      if (dec.usage === 'target' && dec.strategy !== 'skip') {
        const heading = sectionProfiles.find(s => s.sectionId === dec.sectionId)?.heading || dec.sectionRole;
        candidateGroups.push({
          label: heading,
          strategy: dec.strategy,
          sectionIds: [dec.sectionId],
        });
      }
    }
  }

  // 2. Map all target chunks to sections for lookup
  const chunksBySection = new Map<string, { chunkId: string; text: string; chunkOrder: number }[]>();
  for (const batch of evidenceBatchPlan.batches) {
    for (const chunk of batch.chunks) {
      if (!chunksBySection.has(chunk.sectionId)) {
        chunksBySection.set(chunk.sectionId, []);
      }
      chunksBySection.get(chunk.sectionId)!.push({
        chunkId: chunk.chunkId,
        text: chunk.text,
        chunkOrder: chunk.chunkOrder,
      });
    }
  }

  // 3. Build Work Units
  const workUnits: EvidenceWorkUnit[] = [];
  let ordinalCounter = 1;

  // Track which work unit contains each section ID
  const sectionToWorkUnitMap = new Map<string, EvidenceWorkUnit>();

  for (const group of candidateGroups) {
    const targetChunkIds: string[] = [];
    let characterCount = 0;

    for (const secId of group.sectionIds) {
      const secChunks = chunksBySection.get(secId) || [];
      secChunks.sort((a, b) => a.chunkOrder - b.chunkOrder);
      for (const chunk of secChunks) {
        targetChunkIds.push(chunk.chunkId);
        characterCount += chunk.text.length;
      }
    }

    if (targetChunkIds.length === 0) {
      // Do not create empty work units
      continue;
    }

    const unit: EvidenceWorkUnit = {
      workUnitId: `wku_${sha256(`${extractionPlan.documentId}|${group.sectionIds.join(',')}`).slice(0, 20)}`,
      ordinal: ordinalCounter++,
      label: group.label,
      strategy: group.strategy,
      sectionIds: group.sectionIds,
      targetChunkIds,
      chunkCount: targetChunkIds.length,
      characterCount,
      batchIds: [],
      batchCount: 0,
    };

    workUnits.push(unit);
    for (const secId of group.sectionIds) {
      sectionToWorkUnitMap.set(secId, unit);
    }
  }

  // 4. Assign batches to work units deterministically
  for (const batch of evidenceBatchPlan.batches) {
    if (batch.chunks.length === 0) continue;

    // Verify all chunks in this batch belong to the exact same work unit
    const workUnitsForBatch = new Set<EvidenceWorkUnit>();
    for (const chunk of batch.chunks) {
      const targetUnit = sectionToWorkUnitMap.get(chunk.sectionId);
      if (targetUnit) {
        workUnitsForBatch.add(targetUnit);
      }
    }

    if (workUnitsForBatch.size > 1) {
      throw new Error('Invalid hierarchical evidence plan: batch spans multiple work units');
    }

    const [targetUnit] = Array.from(workUnitsForBatch);
    if (targetUnit) {
      targetUnit.batchIds.push(batch.batchId);
      targetUnit.batchCount = targetUnit.batchIds.length;
    }
  }

  // 5. Assert strict invariants
  const targetChunkSet = new Set<string>();
  const technicalBatchSet = new Set<string>();

  for (const batch of evidenceBatchPlan.batches) {
    technicalBatchSet.add(batch.batchId);
    for (const chunk of batch.chunks) {
      targetChunkSet.add(chunk.chunkId);
    }
  }

  const assignedChunkSet = new Set<string>();
  const assignedBatchSet = new Set<string>();
  let duplicateChunkCount = 0;
  let duplicateBatchCount = 0;

  for (const wu of workUnits) {
    if (wu.chunkCount > 0 && wu.batchCount === 0) {
      throw new Error(`Invalid hierarchical evidence plan: work unit ${wu.label} has chunks but zero batches`);
    }

    for (const chunkId of wu.targetChunkIds) {
      if (assignedChunkSet.has(chunkId)) {
        duplicateChunkCount++;
      }
      assignedChunkSet.add(chunkId);
    }

    for (const batchId of wu.batchIds) {
      if (assignedBatchSet.has(batchId)) {
        duplicateBatchCount++;
      }
      assignedBatchSet.add(batchId);
    }
  }

  const allTargetChunksAssigned = targetChunkSet.size === assignedChunkSet.size &&
    Array.from(targetChunkSet).every(id => assignedChunkSet.has(id));

  const allTechnicalBatchesAssigned = technicalBatchSet.size === assignedBatchSet.size &&
    Array.from(technicalBatchSet).every(id => assignedBatchSet.has(id));

  if (!allTargetChunksAssigned) {
    throw new Error('Invalid hierarchical evidence plan: target chunk mismatch');
  }

  if (!allTechnicalBatchesAssigned) {
    throw new Error('Invalid hierarchical evidence plan: technical batch mismatch');
  }

  if (duplicateChunkCount > 0) {
    throw new Error('Invalid hierarchical evidence plan: chunk assigned to multiple work units');
  }

  if (duplicateBatchCount > 0) {
    throw new Error('Invalid hierarchical evidence plan: batch assigned to multiple work units');
  }

  const targetSectionCount = extractionPlan.sectionDecisions.filter(d => d.usage === 'target').length;
  const targetChunkCount = evidenceBatchPlan.diagnostics.targetChunkCount;
  const assignedChunkCount = workUnits.reduce((sum, wu) => sum + wu.chunkCount, 0);
  const unassignedChunkCount = targetChunkCount - assignedChunkCount;

  return {
    documentId: extractionPlan.documentId,
    researchType: extractionPlan.documentType,
    sourceLanguage: extractionPlan.sourceLanguage,
    organizationMode,
    workUnits,
    diagnostics: {
      workUnitCount: workUnits.length,
      targetSectionCount,
      targetChunkCount,
      assignedChunkCount,
      unassignedChunkCount,
      duplicateAssignmentCount: 0,
      technicalBatchCount: evidenceBatchPlan.batches.length,
    },
  };
}
