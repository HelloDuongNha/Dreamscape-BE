import ReaderReplacementBackup from '../../../models/ReaderReplacementBackup';
import ReaderReplacementRun, {
  ReaderReplacementTargetType,
} from '../../../models/ReaderReplacementRun';
import { rollbackReaderReplacement } from './readerReplacement.service';

export async function purgeReaderReplacementLifecycle(
  targetType: ReaderReplacementTargetType,
  targetId: string,
): Promise<string[]> {
  const runningRuns = await ReaderReplacementRun.find({
    targetType,
    targetId,
    status: 'running',
  }).select('_id').lean();

  if (runningRuns.length) {
    await ReaderReplacementRun.updateMany(
      { _id: { $in: runningRuns.map(run => run._id) } },
      { $set: { cancelRequested: true } },
    );
    for (const run of runningRuns) {
      await rollbackReaderReplacement(String(run._id), 'cancelled');
    }
  }

  const runs = await ReaderReplacementRun.find({ targetType, targetId })
    .select('_id newAssetIds oldAssetIds')
    .lean();
  if (!runs.length) return [];

  const runIds = runs.map(run => run._id);
  const assetIds = runs.flatMap(run => [
    ...(run.newAssetIds || []),
    ...(run.oldAssetIds || []),
  ]);

  await ReaderReplacementBackup.deleteMany({ runId: { $in: runIds } });
  await ReaderReplacementRun.deleteMany({ _id: { $in: runIds } });
  return [...new Set(assetIds)];
}
