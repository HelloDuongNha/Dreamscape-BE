import AcademicChunk from '../../models/AcademicChunk';

export interface ContributionReaderStats {
  pageCount: number;
  figureCount: number;
  tableCount: number;
  referenceCount: number;
  updatedAt: Date;
}

export function calculateContributionReaderStats(chunks: any[]): ContributionReaderStats | null {
  if (!chunks.length) return null;

  let pageCount = 0;
  let wordCount = 0;
  for (const chunk of chunks) {
    const words = String(chunk.text || '').split(/\s+/).filter(Boolean).length;
    if (chunk.blockType === 'heading' && wordCount >= 1000) {
      pageCount += 1;
      wordCount = 0;
    }
    wordCount += words;
    if (chunk.blockType !== 'heading' && wordCount >= 1500) {
      pageCount += 1;
      wordCount = 0;
    }
  }
  if (wordCount > 0) pageCount += 1;

  return {
    pageCount,
    figureCount: chunks.filter(chunk => chunk.blockType === 'figure').length,
    tableCount: chunks.filter(chunk => chunk.blockType === 'table').length,
    referenceCount: chunks.filter(chunk => chunk.blockType === 'reference').length,
    updatedAt: new Date(),
  };
}

export async function loadContributionReaderStats(contributionId: any) {
  const chunks = await AcademicChunk.find({
    previewContributionId: contributionId,
    chunkPurpose: 'reader',
  }).sort({ chunkOrder: 1 }).lean();
  return calculateContributionReaderStats(chunks);
}

export async function repairContributionReaderStats(contribution: any): Promise<void> {
  const hasReader = contribution.fullTextStatus === 'imported' || contribution.readableInApp;
  const needsRepair = !contribution.smartReaderStats
    || contribution.smartReaderStats.pageCount <= 1;
  if (!hasReader || !needsRepair) return;

  const stats = await loadContributionReaderStats(contribution._id);
  if (!stats) return;
  contribution.smartReaderStats = stats;
  await contribution.save();
}
