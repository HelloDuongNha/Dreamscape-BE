import { findOracleCitationUsageExcerpt } from '../evidence/oracleEvidenceUsage.service';

export function presentOracleCitation(
  citation: any,
  contentBlocks: Array<{ text?: string }>,
) {
  const plain = typeof citation?.toObject === 'function'
    ? citation.toObject()
    : { ...citation };
  return {
    ...plain,
    ruleLinks: (plain.ruleLinks || []).map((link: any) => ({
      ...link,
      usageExcerpt: findOracleCitationUsageExcerpt(
        contentBlocks,
        Number(plain.index),
        String(link.statement || ''),
      ) || undefined,
    })),
  };
}
