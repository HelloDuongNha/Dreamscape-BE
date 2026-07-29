import AcademicSource from '../../models/AcademicSource';
import SourceContribution from '../../models/SourceContribution';
import { OriginalPdfCacheResult } from '../../dto/originalPdfAsset.dto';
import { cacheOriginalPdfForDocument } from './originalPdfCacheWorkflow.service';

export type { CacheAttemptSummary, OriginalPdfCacheResult } from '../../dto/originalPdfAsset.dto';

export async function cacheOriginalPdfForSource(
  sourceId: string,
  userId?: string,
  force?: boolean
): Promise<OriginalPdfCacheResult> {
  const source = await AcademicSource.findById(sourceId);
  if (!source) throw new Error('Không tìm thấy tài liệu học thuật.');
  return cacheOriginalPdfForDocument(source, userId, force);
}

export async function cacheOriginalPdfForContribution(
  contributionId: string,
  userId?: string,
  force?: boolean
): Promise<OriginalPdfCacheResult> {
  const source = await SourceContribution.findById(contributionId);
  if (!source) throw new Error('Không tìm thấy tài liệu học thuật.');
  return cacheOriginalPdfForDocument(source, userId, force);
}
