import AcademicSource from '../../models/AcademicSource';
import type { ApprovedSourceCatalogQuery } from '../../dto/approvedSource.dto';
import { mapSourceOriginAndUrls } from './academicSourceResponse.service';

const CATALOG_FIELDS = '_id title authors year journal publisher doi url sourceProvider verificationStatus allowedUse copyrightStatus createdAt fullTextStatus fullTextUrl license oaStatus readableInApp fullTextSourceType originalFile pdfUrl sourceOrigin metadata smartReaderStats readerBuildSnapshots';
const DETAIL_FIELDS = '_id title authors year journal publisher doi url sourceProvider verificationStatus allowedUse copyrightStatus createdAt fullTextStatus fullTextUrl license oaStatus readableInApp fullTextSourceType fullTextImportError fullTextImportedAt fullTextImportedBy landingPageUrl pdfUrl xmlUrl htmlUrl chunkBuildStatus chunkBuiltAt chunkEmbeddingModel chunkCount chunkBuildError originalFile sourceOrigin metadata pmcid normalizedPmcid smartReaderStats readerBuildSnapshots pdfPageCount extractionMethod pdfImportProgress pdfImportHistory';

function buildCatalogFilter(q: string): Record<string, unknown> {
  if (!q) return {};

  const escaped = q.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const searchRegex = new RegExp(escaped, 'i');
  return {
    $or: [
      { title: searchRegex },
      { journal: searchRegex },
      { doi: searchRegex },
      { url: searchRegex },
      { authors: searchRegex },
    ],
  };
}

function buildApprovedSourceFilter(query: ApprovedSourceCatalogQuery): Record<string, unknown> {
  if (query.doi) {
    return { normalizedDoi: query.doi };
  }
  return buildCatalogFilter(query.q);
}

export async function listApprovedSources(query: ApprovedSourceCatalogQuery) {
  const filter = buildApprovedSourceFilter(query);
  const skip = (query.page - 1) * query.limit;
  const total = await AcademicSource.countDocuments(filter);
  const items = await AcademicSource.find(filter)
    .select(CATALOG_FIELDS)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(query.limit);

  const normalizedItems = items.map(item => {
    const source = mapSourceOriginAndUrls(item);
    if (!source.authors) source.authors = [];
    else if (!Array.isArray(source.authors)) source.authors = [String(source.authors)];
    else source.authors = source.authors.map(String).filter(Boolean);
    return source;
  });

  return {
    items: normalizedItems,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.ceil(total / query.limit),
    },
  };
}

export async function findApprovedSourceDetail(id: string) {
  const source = await AcademicSource.findOne({
    $or: [{ _id: id }, { sourceContributionId: id }],
  }).select(DETAIL_FIELDS);
  return source ? mapSourceOriginAndUrls(source) : null;
}
