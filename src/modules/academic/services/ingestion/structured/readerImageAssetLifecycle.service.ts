import { deleteAsset } from '../../../../../infrastructure/storage/cloudinaryStorage.service';
import AcademicChunk from '../../../models/AcademicChunk';

export function collectReaderImageAssetIdsFromHtml(html: string): string[] {
  const ids: string[] = [];
  const pattern = /data-cloudinary-public-id="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) ids.push(match[1]);
  return ids;
}

export async function getPersistedReaderImageAssetIds(
  source: any,
  isContribution: boolean,
): Promise<string[]> {
  const query: any = isContribution
    ? { previewContributionId: source._id, chunkPurpose: 'reader', blockType: 'figure' }
    : { sourceId: source._id, chunkPurpose: 'reader', blockType: 'figure' };
  const chunks = await AcademicChunk.find(query).select('html').lean();
  return [...new Set(chunks.flatMap((chunk) => collectReaderImageAssetIdsFromHtml(String(chunk.html || ''))))];
}

export function getUsedReaderImageAssetIds(blocks: any[]): Set<string> {
  return new Set(
    blocks.flatMap((block) => collectReaderImageAssetIdsFromHtml(String(block.html || ''))),
  );
}

export async function deleteReaderImageAssets(publicIds: string[]): Promise<void> {
  await Promise.all(publicIds.map((id) => deleteAsset(id, 'image').catch(() => undefined)));
}

export async function deleteUnreferencedReaderImageAssets(publicIds: string[]): Promise<number> {
  let deleted = 0;
  for (const publicId of [...new Set(publicIds.filter(Boolean))]) {
    const escapedId = publicId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stillReferenced = await AcademicChunk.exists({
      html: { $regex: `data-cloudinary-public-id="${escapedId}"` },
    });
    if (stillReferenced) continue;
    try {
      await deleteAsset(publicId, 'image');
      deleted += 1;
    } catch {
      // Reader deletion must still complete when a remote asset is already gone.
    }
  }
  return deleted;
}
