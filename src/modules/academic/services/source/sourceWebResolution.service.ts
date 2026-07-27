import * as cheerio from 'cheerio';
import {
  fetchUrlWithSafeRedirects,
  isUrlSafe,
  isValidHttpUrl,
} from '../../../../infrastructure/security/ssrfGuard';
import { SourceImportResolverResult } from '../../dto/sourceImport.dto';
import { sanitizeAcademicSourceData } from './sourceSanitizer';

export async function resolveWebSource(
  url: string,
  warnings: string[],
): Promise<SourceImportResolverResult> {
  if (!isValidHttpUrl(url)) {
    throw new Error('Địa chỉ URL không đúng định dạng giao thức http/https.');
  }
  if (!(await isUrlSafe(url))) {
    return {
      sourceType: 'web_url',
      title: 'Liên kết không an toàn',
      authors: [],
      sourceUrl: url,
      openAccessStatus: 'restricted',
      allowedUse: 'metadata_only',
      fullTextAvailable: false,
      metadataProvider: 'security_block',
      warnings: ['SSRF: Đích đến URL không an toàn hoặc nằm trong dải IP nội bộ.'],
    };
  }

  if (new URL(url).pathname.toLowerCase().endsWith('.pdf')) {
    warnings.push('URL trỏ trực tiếp đến tệp PDF. Việc nhập bản đọc cần được xác nhận bản quyền.');
    return {
      sourceType: 'pdf_url',
      title: 'Tài liệu PDF trực tuyến',
      authors: [],
      sourceUrl: url,
      pdfUrl: url,
      openAccessStatus: 'unknown',
      allowedUse: 'metadata_only',
      fullTextAvailable: true,
      metadataProvider: 'direct_pdf_url',
      warnings,
    };
  }

  let htmlText = '';
  let resolvedUrl = url;
  try {
    const crawled = await fetchUrlWithSafeRedirects(url, false);
    htmlText = crawled.buffer.toString('utf-8');
    resolvedUrl = crawled.finalUrl;
  } catch (error: any) {
    console.warn('[Crawl HTML] Crawling failed gracefully:', error.message || error);
    warnings.push(`Không thể truy cập nội dung URL để trích xuất thẻ metadata (${error.message || error}).`);
    return {
      sourceType: 'web_url',
      title: `Bài viết từ ${new URL(url).hostname}`,
      authors: [],
      sourceUrl: url,
      openAccessStatus: 'unknown',
      allowedUse: 'metadata_only',
      fullTextAvailable: false,
      metadataProvider: 'failed_crawl',
      warnings,
    };
  }

  let title = '';
  const authors: string[] = [];
  let journal = '';
  let publisher = '';
  let year: number | undefined;
  try {
    const $ = cheerio.load(htmlText);
    title = $('meta[name="citation_title"]').attr('content')
      || $('meta[property="og:title"]').attr('content')
      || $('meta[name="twitter:title"]').attr('content')
      || $('title').text()
      || '';
    $('meta[name="citation_author"]').each((_, element) => {
      const content = $(element).attr('content');
      if (content) authors.push(content.trim());
    });
    if (authors.length === 0) {
      const author = $('meta[name="author"]').attr('content')
        || $('meta[property="og:article:author"]').attr('content');
      if (author) authors.push(author.trim());
    }
    journal = $('meta[name="citation_journal_title"]').attr('content')
      || $('meta[property="og:site_name"]').attr('content')
      || '';
    publisher = $('meta[name="citation_publisher"]').attr('content')
      || $('meta[name="publisher"]').attr('content')
      || '';
    const date = $('meta[name="citation_publication_date"]').attr('content')
      || $('meta[property="article:published_time"]').attr('content')
      || $('meta[name="date"]').attr('content')
      || $('meta[name="pubdate"]').attr('content');
    const yearMatch = date?.match(/\b\d{4}\b/);
    if (yearMatch) year = parseInt(yearMatch[0], 10);

    const canonicalUrl = $('link[rel="canonical"]').attr('href');
    if (canonicalUrl && isValidHttpUrl(canonicalUrl)) resolvedUrl = canonicalUrl;
  } catch (error: any) {
    console.warn('[Parse HTML] Parsing cheerio tags failed:', error.message || error);
    warnings.push('Lỗi phân tích thẻ metadata HTML.');
  }

  const sanitized = sanitizeAcademicSourceData({
    title: title || 'Liên kết trang web',
    authors: authors.length > 0 ? authors : undefined,
    journal,
    publisher,
    year,
    url: resolvedUrl,
    openAccessStatus: 'unknown',
    allowedUse: 'metadata_only',
  });
  warnings.push('Địa chỉ trang web. Toàn văn bài viết không được tự động nhập trong giai đoạn này.');
  return {
    sourceType: 'web_url',
    title: sanitized.title,
    authors: sanitized.authors || [],
    year: sanitized.year,
    journal: sanitized.journal,
    publisher: sanitized.publisher,
    sourceUrl: sanitized.url,
    openAccessStatus: sanitized.openAccessStatus,
    allowedUse: sanitized.allowedUse,
    fullTextAvailable: false,
    metadataProvider: 'html_metadata_tags',
    warnings,
  };
}
