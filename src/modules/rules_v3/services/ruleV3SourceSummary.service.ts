import mongoose from 'mongoose';
import AcademicSource from '../../academic/models/AcademicSource';
import SourceContribution from '../../academic/models/SourceContribution';

export interface RuleV3SourceSummary {
  _id: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
}

// Normalizes source metadata before it reaches the moderation response.
export function cleanSourceMetadataText(value: unknown): string {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function toSourceSummary(source: any): RuleV3SourceSummary {
  const metadata = source?.metadata || {};
  return {
    _id: String(source?._id || ''),
    title: cleanSourceMetadataText(source?.title || metadata.title) || 'Tài liệu chưa có tiêu đề',
    authors: (source?.authors?.length ? source.authors : (metadata.authors || []))
      .map((author: unknown) => cleanSourceMetadataText(author))
      .filter(Boolean),
    year: source?.year || metadata.year,
    doi: source?.doi || metadata.doi,
  };
}

export async function loadRuleV3SourceSummaries(sourceIds: string[]): Promise<Map<string, RuleV3SourceSummary>> {
  const validIds = [...new Set(sourceIds)].filter(id => mongoose.Types.ObjectId.isValid(id));
  const objectIds = validIds.map(id => new mongoose.Types.ObjectId(id));
  const [approved, contributions] = await Promise.all([
    AcademicSource.find({ _id: { $in: objectIds } }).select('title authors year doi metadata').lean(),
    SourceContribution.find({ _id: { $in: objectIds } }).select('title authors year doi metadata').lean(),
  ]);
  const summaries = new Map<string, RuleV3SourceSummary>();
  for (const source of [...approved, ...contributions]) {
    summaries.set(String(source._id), toSourceSummary(source));
  }
  return summaries;
}

export function shortRuleLabel(rule: any): string {
  const statement = cleanSourceMetadataText(rule.statement);
  if (!statement) return '';
  return statement.length <= 180 ? statement : `${statement.slice(0, 177).trimEnd()}…`;
}
