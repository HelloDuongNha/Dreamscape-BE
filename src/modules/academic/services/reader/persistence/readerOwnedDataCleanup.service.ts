import AcademicChunk from '../../../models/AcademicChunk';
import AcademicDocument from '../../../models/AcademicDocument';
import AcademicSection from '../../../models/AcademicSection';
import type {
  ReaderCleanupCounts,
  ReaderCleanupOptions,
  ReaderCleanupPlan,
  ReaderOwner,
} from '../../../dto/readerCleanup.dto';
import { removeRuleV3SourceData } from '../../../../rules_v3/services/ruleV3Lifecycle.service';
import {
  collectReaderImageAssetIdsFromHtml,
  deleteUnreferencedReaderImageAssets,
} from '../../ingestion/structured/readerImageAssetLifecycle.service';
import { purgeReaderReplacementLifecycle } from './readerReplacementCleanup.service';

export async function prepareReaderOwnedDataCleanup(
  owner: ReaderOwner,
): Promise<ReaderCleanupPlan> {
  const replacementAssetIds = await purgeReaderReplacementLifecycle(
    owner.targetType,
    String(owner.targetId),
  );
  const selector = ownerSelector(owner);
  const documents = await AcademicDocument.find(selector).select('_id').lean();
  const documentIds = documents.map(document => document._id);
  const chunks = await AcademicChunk.find({
    $or: [
      selector,
      ...(documentIds.length ? [{ documentId: { $in: documentIds } }] : []),
    ],
  }).select('html').lean();
  const imageAssetIds = chunks.flatMap(chunk =>
    collectReaderImageAssetIdsFromHtml(String(chunk.html || '')),
  );

  return {
    owner,
    imageAssetIds: [...new Set(imageAssetIds)],
    replacementAssetIds,
  };
}

export async function deleteReaderOwnedDatabaseData(
  owner: ReaderOwner,
  options: ReaderCleanupOptions = {},
): Promise<ReaderCleanupCounts> {
  const selector = ownerSelector(owner);
  const querySession = options.session || null;
  const writeOptions = options.session ? { session: options.session } : {};
  const documents = await AcademicDocument.find(selector).session(querySession).select('_id').lean();
  const documentIds = documents.map(document => document._id);
  const dependentSelector = {
    $or: [
      selector,
      ...(documentIds.length ? [{ documentId: { $in: documentIds } }] : []),
    ],
  };

  const [sectionCount, chunkCount, ruleCleanup] = await Promise.all([
    AcademicSection.countDocuments(dependentSelector).session(querySession),
    AcademicChunk.countDocuments(dependentSelector).session(querySession),
    removeRuleV3SourceData(String(owner.targetId), {
      session: options.session,
      deleteRunHistory: true,
    }),
  ]);

  await AcademicSection.deleteMany(dependentSelector, writeOptions);
  await AcademicChunk.deleteMany(dependentSelector, writeOptions);
  await AcademicDocument.deleteMany(selector, writeOptions);

  return {
    documents: documents.length,
    sections: sectionCount,
    chunks: chunkCount,
    ruleEvidence: ruleCleanup.evidenceRemoved,
    rulesRemoved: ruleCleanup.rulesRemoved,
    rulesRescored: ruleCleanup.rulesRescored,
    ruleRuns: ruleCleanup.runsRemoved,
  };
}

export async function deleteReaderOwnedAssets(plan: ReaderCleanupPlan): Promise<number> {
  return deleteUnreferencedReaderImageAssets([
    ...plan.imageAssetIds,
    ...plan.replacementAssetIds,
  ]);
}

function ownerSelector(owner: ReaderOwner): Record<string, unknown> {
  return owner.targetType === 'contribution'
    ? { previewContributionId: owner.targetId }
    : { sourceId: owner.targetId };
}
