import type { RuleV3SourceSummary } from './ruleV3SourceSummary.service';

// Ghép các span gần nhau thành một đoạn dẫn chứng dễ đọc trong màn hình duyệt.
export function groupRuleV3EvidenceExcerpts(
  evidence: any[],
  chunkMap: Map<string, any>,
  sourceSummaries: Map<string, RuleV3SourceSummary>,
) {
  const evidenceByOwner = new Map<string, any[]>();
  for (const item of evidence) {
    const ownerKey = `${String(item.ruleId)}:${String(item.sourceId)}:${String(item.chunkId)}:${item.stance}`;
    const ownerEvidence = evidenceByOwner.get(ownerKey) || [];
    ownerEvidence.push(item);
    evidenceByOwner.set(ownerKey, ownerEvidence);
  }

  const groups: any[] = [];
  for (const [ownerKey, items] of evidenceByOwner) {
    const sorted = [...items].sort((a, b) => a.startOffset - b.startOffset);
    const clusters: any[][] = [];
    for (const item of sorted) {
      const current = clusters[clusters.length - 1];
      const previousEnd = current?.length ? Math.max(...current.map(entry => entry.endOffset)) : -1;
      if (!current || item.startOffset - previousEnd > 240) clusters.push([item]);
      else current.push(item);
    }

    for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
      const cluster = clusters[clusterIndex];
      const first = cluster[0];
      const chunk: any = chunkMap.get(String(first.chunkId));
      const startOffset = Math.min(...cluster.map(item => item.startOffset));
      const endOffset = Math.max(...cluster.map(item => item.endOffset));
      const chunkText = String(chunk?.text || '');
      const source = sourceSummaries.get(String(first.sourceId));
      groups.push({
        evidenceGroupId: `${ownerKey}:${clusterIndex}`,
        ruleId: String(first.ruleId),
        sourceId: String(first.sourceId),
        sourceTitle: source?.title,
        sourceDoi: source?.doi,
        chunkId: String(first.chunkId),
        stance: first.stance,
        spanCount: cluster.length,
        excerpt: chunkText ? chunkText.slice(startOffset, endOffset) : cluster.map(item => item.exactQuote).join(' '),
        pageStart: chunk?.pageStart,
        pageEnd: chunk?.pageEnd,
        sectionTitle: chunk?.sectionTitle,
        sectionType: chunk?.sectionType || chunk?.blockType || 'paragraph',
      });
    }
  }

  return groups;
}
