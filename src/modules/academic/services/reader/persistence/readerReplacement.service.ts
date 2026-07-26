import mongoose from 'mongoose';
import AcademicChunk from '../../../models/AcademicChunk';
import AcademicDocument from '../../../models/AcademicDocument';
import AcademicSection from '../../../models/AcademicSection';
import AcademicSource from '../../../models/AcademicSource';
import ReaderReplacementBackup from '../../../models/ReaderReplacementBackup';
import ReaderReplacementRun, {
  ReaderReplacementTargetType,
} from '../../../models/ReaderReplacementRun';
import SourceContribution from '../../../models/SourceContribution';
import { deleteAsset } from '../../../../../infrastructure/storage/cloudinaryStorage.service';
import KnowledgeRuleV3 from '../../../../rules_v3/models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../../../rules_v3/models/KnowledgeRuleEvidence';
import { resolveRuleV3SourceAliases } from '../../../../rules_v3/services/ruleV3Lifecycle.service';

const SNAPSHOT_FIELDS = [
  'title', 'metadata', 'authors', 'pmcid', 'normalizedPmcid', 'pdfUrl', 'htmlUrl',
  'fullTextUrl', 'sourceUrl', 'xmlUrl', 'url', 'doi', 'normalizedDoi', 'isbn',
  'journal', 'publisher', 'year', 'license', 'allowedUse', 'openAccessStatus',
  'fullTextStatus', 'fullTextImportError', 'readableInApp', 'chunkBuildStatus',
  'chunkBuiltAt', 'fullTextImportedAt', 'fullTextImportedBy', 'chunkEmbeddingModel',
  'chunkCount', 'extractionMethod', 'extractionQuality', 'extractionStatus',
  'smartReaderStats', 'pdfPageCount',
] as const;

function targetModel(targetType: ReaderReplacementTargetType): any {
  return targetType === 'contribution' ? SourceContribution : AcademicSource;
}

function cancellationError(): Error {
  const error = new Error('reader_replacement_cancelled');
  error.name = 'AbortError';
  return error;
}

export async function beginReaderReplacement(input: {
  targetType: ReaderReplacementTargetType;
  targetId: string;
  kind: 'pdf' | 'structured';
}): Promise<string> {
  const model = targetModel(input.targetType);
  const source = await model.findById(input.targetId).lean();
  if (!source) throw new Error('Không tìm thấy tài liệu để tạo phiên thay thế Bản đọc.');

  const previousRun = await ReaderReplacementRun.findOne({
    targetType: input.targetType,
    targetId: source._id,
    status: 'running',
  }).select('_id').lean();
  if (previousRun) throw new Error('reader_replacement_already_running');

  const sourceSnapshot: Record<string, unknown> = {};
  for (const field of SNAPSHOT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) sourceSnapshot[field] = (source as any)[field];
  }

  const run = await ReaderReplacementRun.create({
    targetType: input.targetType,
    targetId: source._id,
    kind: input.kind,
    sourceSnapshot,
  });
  return String(run._id);
}

export async function requestReaderReplacementCancellation(
  targetType: ReaderReplacementTargetType,
  targetId: string,
): Promise<boolean> {
  const result = await ReaderReplacementRun.findOneAndUpdate(
    { targetType, targetId, status: 'running' },
    { $set: { cancelRequested: true } },
    { sort: { createdAt: -1 } },
  );
  return Boolean(result);
}

export async function waitForReaderReplacementTerminal(
  targetType: ReaderReplacementTargetType,
  targetId: string,
  timeoutMs = 15 * 60 * 1000,
): Promise<'completed' | 'cancelled' | 'failed' | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const run = await ReaderReplacementRun.findOne({ targetType, targetId })
      .sort({ createdAt: -1 })
      .select('status')
      .lean();
    if (!run) return null;
    if (run.status !== 'running') return run.status;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('reader_replacement_cancellation_timeout');
}

export async function assertReaderReplacementActive(
  runId?: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  if (abortSignal?.aborted) throw cancellationError();
  if (!runId) return;
  const run = await ReaderReplacementRun.findById(runId).select('status cancelRequested').lean();
  if (!run || run.status !== 'running' || run.cancelRequested) throw cancellationError();
}

export async function recordReaderReplacementAssets(
  runId: string | undefined,
  input: { newAssetIds?: string[]; oldAssetIds?: string[] },
): Promise<void> {
  if (!runId) return;
  const update: Record<string, unknown> = {};
  if (input.newAssetIds?.length) update.$addToSet = { newAssetIds: { $each: input.newAssetIds } };
  if (input.oldAssetIds?.length) {
    update.$addToSet = {
      ...((update.$addToSet as Record<string, unknown>) || {}),
      oldAssetIds: { $each: input.oldAssetIds },
    };
  }
  if (Object.keys(update).length) await ReaderReplacementRun.updateOne({ _id: runId }, update);
}

export async function captureReaderReplacementBackup(
  runId: string | undefined,
  selector: Record<string, unknown>,
): Promise<void> {
  if (!runId) return;
  if (await ReaderReplacementBackup.exists({ runId })) return;
  const documents = await AcademicDocument.find(selector).lean();
  const documentIds = documents.map(item => item._id);
  const [sections, chunks] = documentIds.length
    ? await Promise.all([
        AcademicSection.find({ documentId: { $in: documentIds } }).lean(),
        AcademicChunk.find({ documentId: { $in: documentIds } }).lean(),
      ])
    : [[], []];
  const rows = [
    ...documents.map(payload => ({ runId, entityType: 'document', entityId: payload._id, payload })),
    ...sections.map(payload => ({ runId, entityType: 'section', entityId: payload._id, payload })),
    ...chunks.map(payload => ({ runId, entityType: 'chunk', entityId: payload._id, payload })),
  ];
  if (rows.length) await ReaderReplacementBackup.insertMany(rows, { ordered: false });
}

export async function captureReaderRuleBackup(
  runId: string,
  sourceId: string,
): Promise<void> {
  if (await ReaderReplacementBackup.exists({ runId, entityType: 'rule_evidence' })) return;
  const sourceAliases = await resolveRuleV3SourceAliases(sourceId);
  if (!sourceAliases.length) return;
  const evidence = await KnowledgeRuleEvidenceV3.find({ sourceId: { $in: sourceAliases } }).lean();
  const ruleIds = [...new Set(evidence.map(item => String(item.ruleId)))];
  const rules = ruleIds.length
    ? await KnowledgeRuleV3.find({ _id: { $in: ruleIds } }).lean()
    : [];
  const rows = [
    ...rules.map(payload => ({
      runId,
      entityType: 'rule',
      entityId: payload._id,
      payload,
    })),
    ...evidence.map(payload => ({
      runId,
      entityType: 'rule_evidence',
      entityId: payload._id,
      payload,
    })),
  ];
  if (rows.length) await ReaderReplacementBackup.insertMany(rows, { ordered: false });
}

export async function markReaderReplacementWritten(runId?: string): Promise<void> {
  if (!runId) return;
  await ReaderReplacementRun.updateOne({ _id: runId }, { $set: { readerWritten: true } });
}

async function removeCurrentReader(run: any, session?: mongoose.ClientSession): Promise<void> {
  const selector = run.targetType === 'contribution'
    ? { previewContributionId: run.targetId }
    : { sourceId: run.targetId };
  const documents = await AcademicDocument.find(selector).session(session || null);
  const ids = documents.map(item => item._id);
  const options = session ? { session } : {};
  if (ids.length) {
    await AcademicSection.deleteMany({ documentId: { $in: ids } }, options);
    await AcademicChunk.deleteMany({ documentId: { $in: ids } }, options);
  }
  await AcademicDocument.deleteMany(selector, options);
}

export async function rollbackReaderReplacement(
  runId: string | undefined,
  status: 'cancelled' | 'failed',
): Promise<{ newAssetIds: string[] }> {
  if (!runId) return { newAssetIds: [] };
  const run = await ReaderReplacementRun.findById(runId).lean();
  if (!run || run.status === 'completed') return { newAssetIds: [] };
  if (run.status !== 'running') return { newAssetIds: run.newAssetIds || [] };
  const backups = await ReaderReplacementBackup.find({ runId }).lean();
  const execute = async (session?: mongoose.ClientSession) => {
    if (backups.length > 0 || run.readerWritten) await removeCurrentReader(run, session);
    const options = session ? { session } : {};
    const documents = backups.filter(item => item.entityType === 'document').map(item => item.payload);
    const sections = backups.filter(item => item.entityType === 'section').map(item => item.payload);
    const chunks = backups.filter(item => item.entityType === 'chunk').map(item => item.payload);
    if (documents.length) await AcademicDocument.insertMany(documents, options);
    if (sections.length) await AcademicSection.insertMany(sections, options);
    if (chunks.length) await AcademicChunk.insertMany(chunks, options);
    const rules = backups.filter(item => item.entityType === 'rule').map(item => item.payload as any);
    const evidence = backups.filter(item => item.entityType === 'rule_evidence').map(item => item.payload as any);
    if (rules.length) {
      await KnowledgeRuleV3.bulkWrite(
        rules.map(payload => ({
          replaceOne: { filter: { _id: payload._id }, replacement: payload, upsert: true },
        })),
        options,
      );
    }
    if (evidence.length) {
      await KnowledgeRuleEvidenceV3.bulkWrite(
        evidence.map(payload => ({
          replaceOne: { filter: { _id: payload._id }, replacement: payload, upsert: true },
        })),
        options,
      );
    }
    const unset: Record<string, 1> = {};
    for (const field of SNAPSHOT_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(run.sourceSnapshot, field)) unset[field] = 1;
    }
    await targetModel(run.targetType).updateOne(
      { _id: run.targetId },
      { $set: run.sourceSnapshot, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      options,
    );
    await ReaderReplacementRun.updateOne(
      { _id: runId },
      { $set: { status, finishedAt: new Date() } },
      options,
    );
  };
  const session = await mongoose.startSession();
  try {
    const hello = await mongoose.connection.db?.command({ hello: 1 }).catch(() => null);
    if (hello && (hello.setName || hello.msg === 'isdbgrid')) await session.withTransaction(() => execute(session));
    else await execute();
  } finally {
    await session.endSession();
  }
  await ReaderReplacementBackup.deleteMany({ runId });
  return { newAssetIds: run.newAssetIds || [] };
}

export async function completeReaderReplacement(runId?: string): Promise<{ oldAssetIds: string[] }> {
  if (!runId) return { oldAssetIds: [] };
  await assertReaderReplacementActive(runId);
  const run = await ReaderReplacementRun.findById(runId).select('oldAssetIds').lean();
  const completed = await ReaderReplacementRun.findOneAndUpdate(
    { _id: runId, status: 'running', cancelRequested: false },
    { $set: { status: 'completed', committedAt: new Date(), finishedAt: new Date() } },
    { new: true },
  );
  if (!completed) throw cancellationError();
  await ReaderReplacementBackup.deleteMany({ runId });
  return { oldAssetIds: run?.oldAssetIds || [] };
}

export async function recoverInterruptedReaderReplacements(): Promise<void> {
  // This process owns in-flight reader jobs. After a process restart no worker
  // can still complete a persisted "running" run, so every such run is stale.
  const runs = await ReaderReplacementRun.find({ status: 'running' }).select('_id').lean();
  for (const run of runs) {
    try {
      const rollback = await rollbackReaderReplacement(String(run._id), 'cancelled');
      await Promise.all(rollback.newAssetIds.map(id => deleteAsset(id, 'image').catch(() => undefined)));
    } catch (error) {
      console.error('[Reader Replacement] Failed to recover interrupted run:', error);
    }
  }
}
