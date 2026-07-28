import mongoose, { Types } from 'mongoose';
import type { ReaderCleanupCounts, ReaderCleanupPlan } from '../../dto/readerCleanup.dto';
import AcademicSource from '../../models/AcademicSource';
import SourceContribution from '../../models/SourceContribution';
import {
  deleteReaderOwnedAssets,
  deleteReaderOwnedDatabaseData,
  prepareReaderOwnedDataCleanup,
} from '../reader/persistence/readerOwnedDataCleanup.service';
import { deleteOriginalPdfAsset } from '../storage/originalPdfStorage.service';
import {
  applyOracleSourceInvalidation,
  prepareOracleSourceInvalidation,
  rematchInvalidatedOracleTurns,
} from '../../../oracle/services/lifecycle/oracleSourceInvalidation.service';
import { recomputeRuleValidationScores } from '../../../rules_v3/services/evidence/ruleV3ValidationScore.service';

export interface SourceDeletionResult {
  status: number;
  body: Record<string, unknown>;
}

interface StoredFile {
  storageProvider?: string;
  cloudinaryPublicId?: string;
  firebaseStoragePath?: string;
  [key: string]: unknown;
}

interface DeletionSummary extends ReaderCleanupCounts {
  source?: number;
  contribution?: number;
  readerAssets: number;
  originalFiles: number;
}

export async function deleteSourceData(sourceId: string): Promise<SourceDeletionResult> {
  const source = await AcademicSource.findById(sourceId);
  if (source) return deleteApprovedSource(source);

  const contribution = await SourceContribution.findById(sourceId);
  if (contribution) return deleteContributions(contribution);

  return {
    status: 404,
    body: { success: false, message: 'Không tìm thấy tài liệu này.' },
  };
}

async function deleteContributions(contribution: any): Promise<SourceDeletionResult> {
  const contributions = await findDuplicateContributions(contribution);
  const oracleInvalidation = await prepareOracleSourceInvalidation(
    contributions.map((item) => String(item._id)),
  );
  const plans = await prepareContributionCleanupPlans(contributions);
  const files = contributions.map(item => plainStoredFile(item.originalFile)).filter(Boolean) as StoredFile[];
  const deleted = emptyDeletionSummary({ contribution: contributions.length });
  const warnings: string[] = [];

  const databaseResult = await runOptionalTransaction(async session => {
    await applyOracleSourceInvalidation(oracleInvalidation, session);
    for (const plan of plans) {
      mergeCleanupCounts(deleted, await deleteReaderOwnedDatabaseData(plan.owner, { session }));
    }
    await SourceContribution.deleteMany(
      { _id: { $in: contributions.map(item => item._id) } },
      session ? { session } : {},
    );
  });
  if (!databaseResult.success) return deletionFailure('Có lỗi xảy ra khi xóa đóng góp.', databaseResult.error);
  await recomputeRuleValidationScores(oracleInvalidation.feedbackRuleIds);
  try {
    await rematchInvalidatedOracleTurns(
      oracleInvalidation.turnIds,
      oracleInvalidation.dreamIds,
    );
  } catch (error) {
    warnings.push(`Không thể chạy lại đối chiếu Evidence Needed: ${String(error)}`);
  }

  deleted.readerAssets = await deleteCleanupAssets(plans);
  deleted.originalFiles = await deleteUnreferencedStoredFiles(files, warnings);
  return { status: 200, body: { success: true, deleted, warnings } };
}

async function deleteApprovedSource(source: any): Promise<SourceDeletionResult> {
  const linkedContributions = await findLinkedContributions(source);
  const sourcePlan = await prepareReaderOwnedDataCleanup({
    targetType: 'approved_source',
    targetId: source._id,
  });
  const contributionPlans = await prepareContributionCleanupPlans(linkedContributions);
  const plans = [sourcePlan, ...contributionPlans];
  const sourceIds = [
    String(source._id),
    ...linkedContributions.map((item) => String(item._id)),
  ];
  const oracleInvalidation = await prepareOracleSourceInvalidation(sourceIds);
  const files = [
    plainStoredFile(source.originalFile),
    ...linkedContributions.map(item => plainStoredFile(item.originalFile)),
  ].filter(Boolean) as StoredFile[];
  const deleted = emptyDeletionSummary({
    source: 1,
    contribution: linkedContributions.length,
  });
  const warnings: string[] = [];

  const databaseResult = await runOptionalTransaction(async session => {
    await applyOracleSourceInvalidation(oracleInvalidation, session);
    for (const plan of plans) {
      mergeCleanupCounts(deleted, await deleteReaderOwnedDatabaseData(plan.owner, { session }));
    }
    if (linkedContributions.length) {
      await SourceContribution.deleteMany(
        { _id: { $in: linkedContributions.map(item => item._id) } },
        session ? { session } : {},
      );
    }
    await AcademicSource.deleteOne({ _id: source._id }, session ? { session } : {});
  });
  if (!databaseResult.success) return deletionFailure('Có lỗi xảy ra khi xóa tài liệu.', databaseResult.error);
  await recomputeRuleValidationScores(oracleInvalidation.feedbackRuleIds);
  try {
    await rematchInvalidatedOracleTurns(
      oracleInvalidation.turnIds,
      oracleInvalidation.dreamIds,
    );
  } catch (error) {
    warnings.push(`Không thể chạy lại đối chiếu Evidence Needed: ${String(error)}`);
  }

  deleted.readerAssets = await deleteCleanupAssets(plans);
  deleted.originalFiles = await deleteUnreferencedStoredFiles(files, warnings);
  return { status: 200, body: { success: true, deleted, warnings } };
}

async function findDuplicateContributions(contribution: any): Promise<any[]> {
  if (!contribution.doi && !contribution.normalizedDoi) return [contribution];
  const doiValues = [...new Set([contribution.doi, contribution.normalizedDoi].filter(Boolean))];
  const matches = await SourceContribution.find({
    $or: doiValues.flatMap(doi => [{ doi }, { normalizedDoi: doi }]),
  });
  return matches.length ? matches : [contribution];
}

async function findLinkedContributions(source: any): Promise<any[]> {
  const conditions: Record<string, unknown>[] = [];
  if (source.sourceContributionId) {
    conditions.push(
      { _id: source.sourceContributionId },
      { duplicateOf: source.sourceContributionId },
    );
  }
  if (source.doi || source.normalizedDoi) {
    const doiValues = [...new Set([source.doi, source.normalizedDoi].filter(Boolean))];
    conditions.push(...doiValues.flatMap(doi => [{ doi }, { normalizedDoi: doi }]));
  }
  return conditions.length ? SourceContribution.find({ $or: conditions }) : [];
}

async function prepareContributionCleanupPlans(contributions: any[]): Promise<ReaderCleanupPlan[]> {
  const plans: ReaderCleanupPlan[] = [];
  for (const contribution of contributions) {
    plans.push(await prepareReaderOwnedDataCleanup({
      targetType: 'contribution',
      targetId: contribution._id as Types.ObjectId,
    }));
  }
  return plans;
}

async function runOptionalTransaction(
  operation: (session?: mongoose.ClientSession) => Promise<void>,
): Promise<{ success: true } | { success: false; error: unknown }> {
  const session = await mongoose.startSession();
  try {
    const hello = await mongoose.connection.db?.command({ hello: 1 }).catch(() => null);
    const supportsTransactions = Boolean(hello && (hello.setName || hello.msg === 'isdbgrid'));
    if (supportsTransactions) await session.withTransaction(() => operation(session));
    else await operation();
    return { success: true };
  } catch (error) {
    return { success: false, error };
  } finally {
    await session.endSession();
  }
}

async function deleteCleanupAssets(plans: ReaderCleanupPlan[]): Promise<number> {
  let deleted = 0;
  for (const plan of plans) deleted += await deleteReaderOwnedAssets(plan);
  return deleted;
}

async function deleteUnreferencedStoredFiles(
  files: StoredFile[],
  warnings: string[],
): Promise<number> {
  let deleted = 0;
  const uniqueFiles = new Map(files.map(file => [storedFileKey(file), file]));
  uniqueFiles.delete('');

  for (const file of uniqueFiles.values()) {
    if (await storedFileIsReferenced(file)) continue;
    try {
      await deleteOriginalPdfAsset(file as any);
      deleted += 1;
    } catch (error: any) {
      warnings.push(`Xóa tệp PDF thất bại: ${error.message || error}`);
    }
  }
  return deleted;
}

async function storedFileIsReferenced(file: StoredFile): Promise<boolean> {
  const filter = storedFileFilter(file);
  if (!filter) return false;
  const [sourceExists, contributionExists] = await Promise.all([
    AcademicSource.exists(filter),
    SourceContribution.exists(filter),
  ]);
  return Boolean(sourceExists || contributionExists);
}

function storedFileFilter(file: StoredFile): Record<string, unknown> | null {
  if (file.cloudinaryPublicId) {
    return { 'originalFile.cloudinaryPublicId': file.cloudinaryPublicId };
  }
  if (file.firebaseStoragePath) {
    return { 'originalFile.firebaseStoragePath': file.firebaseStoragePath };
  }
  return null;
}

function storedFileKey(file: StoredFile): string {
  return file.cloudinaryPublicId
    ? `cloudinary:${file.cloudinaryPublicId}`
    : file.firebaseStoragePath
      ? `firebase:${file.firebaseStoragePath}`
      : '';
}

function plainStoredFile(file: any): StoredFile | undefined {
  if (!file) return undefined;
  return { ...(file.toObject?.() || {}), ...file };
}

function emptyDeletionSummary(
  owners: Pick<DeletionSummary, 'source' | 'contribution'>,
): DeletionSummary {
  return {
    ...owners,
    documents: 0,
    sections: 0,
    chunks: 0,
    ruleEvidence: 0,
    rulesRemoved: 0,
    rulesRescored: 0,
    ruleRuns: 0,
    readerAssets: 0,
    originalFiles: 0,
  };
}

function mergeCleanupCounts(target: DeletionSummary, counts: ReaderCleanupCounts): void {
  target.documents += counts.documents;
  target.sections += counts.sections;
  target.chunks += counts.chunks;
  target.ruleEvidence += counts.ruleEvidence;
  target.rulesRemoved += counts.rulesRemoved;
  target.rulesRescored += counts.rulesRescored;
  target.ruleRuns += counts.ruleRuns;
}

function deletionFailure(message: string, error: unknown): SourceDeletionResult {
  return {
    status: 500,
    body: {
      success: false,
      message,
      error: error instanceof Error ? error.message : String(error),
    },
  };
}
