import mongoose from 'mongoose';
import * as cheerio from 'cheerio';
import { normalizeDoi, fetchUnpaywallMetadata } from './openAccess.service';
import { sanitizeAcademicSourceData } from '../utils/sourceSanitizer';
import { getAssetMetadata } from './cloudinaryStorage.service';
import {
  isUrlSafe,
  isValidHttpUrl,
  fetchUrlWithSafeRedirects
} from '../utils/ssrfGuard';

export interface SourceImportResolverInput {
  doi?: string;
  pmcid?: string;
  url?: string;
  isbn?: string;
  uploadedFileRef?: {
    storageProvider: 'cloudinary';
    cloudinaryPublicId: string;
    cloudinarySecureUrl: string;
    cloudinaryResourceType: string;
    cloudinaryFormat?: string;
    originalFileName?: string;
    mimeType?: string;
    fileSize?: number;
  };
}

export interface SourceImportResolverResult {
  sourceType: 'doi' | 'pmcid' | 'web_url' | 'pdf_url' | 'pdf_upload' | 'isbn';
  title?: string;
  authors: string[];
  year?: number;
  journal?: string;
  publisher?: string;
  doi?: string;
  pmcid?: string;
  normalizedPmcid?: string;
  isbn?: string;
  sourceUrl?: string;
  pdfUrl?: string;
  htmlUrl?: string;
  xmlUrl?: string;
  openAccessStatus: 'hybrid' | 'gold' | 'green' | 'bronze' | 'open' | 'closed' | 'restricted' | 'unknown';
  license?: string;
  allowedUse: 'metadata_only' | 'abstract_only' | 'open_access_fulltext';
  fullTextAvailable: boolean;
  metadataProvider: string;
  originalFile?: {
    storageProvider: 'cloudinary';
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    cloudinaryPublicId: string;
    cloudinarySecureUrl: string;
    cloudinaryResourceType: string;
    cloudinaryFormat?: string;
    uploadedBy?: mongoose.Types.ObjectId;
    uploadedAt?: Date;
  };
  warnings: string[];
}

/**
 * Helper to fetch DOI metadata from Crossref REST API.
 */
async function fetchCrossrefMetadata(doi: string): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000); // 9-second timeout

  try {
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'DreamScapeAcademicBot/1.0 (mailto:dreamscape.app.service@gmail.com)'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.status === 404) {
      return { success: false, errorType: 'not_found' };
    }

    if (!response.ok) {
      return { success: false, errorType: 'network_error' };
    }

    const data = await response.json() as any;
    if (data.status === 'ok' && data.message) {
      const msg = data.message;
      const title = Array.isArray(msg.title) && msg.title.length > 0 ? msg.title[0] : (msg.title || 'Không có tiêu đề');
      
      const authors = Array.isArray(msg.author)
        ? msg.author.map((a: any) => {
            const family = a.family || '';
            const given = a.given || '';
            return `${given} ${family}`.trim();
          }).filter(Boolean)
        : [];
      
      let year: number | null = null;
      if (msg.published && Array.isArray(msg.published['date-parts']) && msg.published['date-parts'][0]) {
        year = msg.published['date-parts'][0][0] || null;
      } else if (msg.created && Array.isArray(msg.created['date-parts']) && msg.created['date-parts'][0]) {
        year = msg.created['date-parts'][0][0] || null;
      }

      const journal = Array.isArray(msg['container-title']) && msg['container-title'].length > 0
        ? msg['container-title'][0]
        : (msg['container-title'] || '');

      const publisher = msg.publisher || '';

      return {
        success: true,
        metadata: {
          title,
          authors,
          year,
          journal,
          publisher,
          doi: msg.DOI || doi,
          url: msg.URL || `https://doi.org/${doi}`
        }
      };
    }
    return { success: false, errorType: 'not_found' };
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.error('Error querying Crossref API:', err.message || err);
    if (err.name === 'AbortError') {
      return { success: false, errorType: 'timeout' };
    }
    return { success: false, errorType: 'network_error' };
  }
}

/**
 * Helper to fetch PMCID metadata from EuropePMC REST API.
 */
async function fetchEuropePmcMetadata(pmcid: string): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(pmcid)}&format=json&resultType=core`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'DreamScapeAcademicBot/1.0 (mailto:dreamscape.app.service@gmail.com)'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const data = await response.json() as any;
    if (data && data.hitCount > 0 && data.resultList?.result?.[0]) {
      const res = data.resultList.result[0];
      const title = res.title || 'Không có tiêu đề';
      
      const authors = Array.isArray(res.authorList?.author)
        ? res.authorList.author.map((a: any) => `${a.firstName || ''} ${a.lastName || ''}`.trim()).filter(Boolean)
        : [];
      
      const year = res.journalInfo?.yearOfPublication || (res.pubYear ? parseInt(res.pubYear, 10) : undefined);
      const journal = res.journalInfo?.journal?.title || '';
      const publisher = 'PMC';

      return {
        title,
        authors,
        year,
        journal,
        publisher,
        pmcid: res.pmcid || pmcid,
        doi: res.doi || undefined,
        abstract: res.abstractText || undefined
      };
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn('[EuropePMC] Failed to fetch PMC metadata:', err.message || err);
  }
  return null;
}

/**
 * Google Books and Open Library metadata search for ISBN inputs.
 */
async function fetchIsbnMetadata(isbn: string): Promise<any> {
  const cleanIsbn = isbn.replace(/[^0-9Xx]/g, '').trim();
  if (!cleanIsbn) return null;

  // 1. Google Books API Lookup
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(cleanIsbn)}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json() as any;
      if (data.items && data.items.length > 0) {
        const volumeInfo = data.items[0].volumeInfo;
        const title = volumeInfo.title || '';
        const authors = Array.isArray(volumeInfo.authors) ? volumeInfo.authors : [];
        let year: number | undefined;
        if (volumeInfo.publishedDate) {
          const match = volumeInfo.publishedDate.match(/\b\d{4}\b/);
          if (match) year = parseInt(match[0], 10);
        }
        const publisher = volumeInfo.publisher || '';
        return {
          title,
          authors,
          year,
          publisher,
          isbn: cleanIsbn,
          metadataProvider: 'google_books'
        };
      }
    }
  } catch (err: any) {
    console.warn('[Google Books API] Failed to fetch metadata:', err.message || err);
  }

  // 2. Open Library Fallback
  try {
    const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(cleanIsbn)}&format=json&jscmd=data`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json() as any;
      const key = `ISBN:${cleanIsbn}`;
      if (data[key]) {
        const bookInfo = data[key];
        const title = bookInfo.title || '';
        const authors = Array.isArray(bookInfo.authors) ? bookInfo.authors.map((a: any) => a.name) : [];
        let year: number | undefined;
        if (bookInfo.publish_date) {
          const match = bookInfo.publish_date.match(/\b\d{4}\b/);
          if (match) year = parseInt(match[0], 10);
        }
        const publisher = bookInfo.publishers && bookInfo.publishers.length > 0 ? bookInfo.publishers[0].name : '';
        return {
          title,
          authors,
          year,
          publisher,
          isbn: cleanIsbn,
          metadataProvider: 'open_library'
        };
      }
    }
  } catch (err: any) {
    console.warn('[Open Library API] Failed to fetch metadata:', err.message || err);
  }

  return null;
}

/**
 * Main resolution entry point.
 */
export async function resolveSourceImport(
  input: SourceImportResolverInput,
  userId?: mongoose.Types.ObjectId
): Promise<SourceImportResolverResult> {
  const warnings: string[] = [];
  const cleanDoi = (input.doi || '').trim();
  const cleanPmcidInput = (input.pmcid || '').trim();
  const cleanUrl = (input.url || '').trim();
  const cleanIsbn = (input.isbn || '').trim();

  let targetPmcid = '';
  if (/^PMC\d+$/i.test(cleanDoi)) {
    targetPmcid = cleanDoi.toUpperCase();
  } else if (/^PMC\d+$/i.test(cleanPmcidInput)) {
    targetPmcid = cleanPmcidInput.toUpperCase();
  }

  // ─── Case 0: PMCID Resolution (EuropePMC) ──────────────────────────────────
  if (targetPmcid) {
    const pmcMetadata = await fetchEuropePmcMetadata(targetPmcid);
    if (!pmcMetadata) {
      throw new Error(`Không thể tìm thấy tài liệu PMC ID ${targetPmcid} từ EuropePMC.`);
    }

    const sanitized = sanitizeAcademicSourceData({
      title: pmcMetadata.title,
      authors: pmcMetadata.authors,
      journal: pmcMetadata.journal,
      publisher: pmcMetadata.publisher,
      year: pmcMetadata.year,
      doi: pmcMetadata.doi || undefined,
      url: `https://europepmc.org/articles/${targetPmcid}`,
      pdfUrl: `https://europepmc.org/articles/${targetPmcid}?pdf=render`,
      htmlUrl: `https://europepmc.org/articles/${targetPmcid}`,
      xmlUrl: `https://www.ebi.ac.uk/europepmc/webservices/rest/${targetPmcid}/fullTextXML`,
      openAccessStatus: 'gold',
      allowedUse: 'open_access_fulltext',
      license: 'open-access'
    });

    return {
      sourceType: 'pmcid',
      title: sanitized.title,
      authors: sanitized.authors || [],
      year: sanitized.year,
      journal: sanitized.journal,
      publisher: sanitized.publisher,
      doi: sanitized.doi,
      pmcid: targetPmcid,
      normalizedPmcid: targetPmcid,
      sourceUrl: sanitized.url,
      pdfUrl: sanitized.pdfUrl,
      htmlUrl: sanitized.htmlUrl,
      xmlUrl: `https://www.ebi.ac.uk/europepmc/webservices/rest/${targetPmcid}/fullTextXML`,
      openAccessStatus: sanitized.openAccessStatus,
      license: sanitized.license,
      allowedUse: sanitized.allowedUse,
      fullTextAvailable: true,
      metadataProvider: 'europe_pmc',
      warnings
    };
  }

  // ─── Case 1: DOI Resolution ────────────────────────────────────────────────
  if (cleanDoi) {
    const normalized = normalizeDoi(cleanDoi);
    let crossrefResult: any = null;
    let unpaywallResult: any = null;

    // Crossref Query
    try {
      crossrefResult = await fetchCrossrefMetadata(normalized);
    } catch (crossrefErr: any) {
      console.warn('[Crossref] Error fetching metadata:', crossrefErr.message || crossrefErr);
      crossrefResult = { success: false, errorType: 'network_error' };
    }

    if (!crossrefResult.success) {
      warnings.push(`Không thể lấy metadata từ Crossref (${crossrefResult.errorType || 'unknown_error'}).`);
    }

    // Unpaywall Query
    try {
      unpaywallResult = await fetchUnpaywallMetadata(normalized);
    } catch (unpaywallErr: any) {
      console.warn('[Unpaywall] Error fetching metadata:', unpaywallErr.message || unpaywallErr);
      unpaywallResult = { success: false };
    }

    if (!unpaywallResult.success) {
      warnings.push('Không thể truy xuất thông tin Open Access từ Unpaywall.');
    }

    // Construct metadata
    const rawMeta = crossrefResult.metadata || {};
    const up = unpaywallResult.data || {};

    let allowedUse: 'metadata_only' | 'abstract_only' | 'open_access_fulltext' = 'metadata_only';
    let fullTextAvailable = false;
    let pdfUrl = up.pdfUrl || '';
    let htmlUrl = up.htmlUrl || '';
    let landingPageUrl = up.landingPageUrl || '';
    let fullTextUrl = '';
    let fullTextSourceType = 'unknown';

    if (up.is_oa) {
      if (htmlUrl && isValidHttpUrl(htmlUrl)) {
        fullTextUrl = htmlUrl;
        fullTextSourceType = 'html';
      } else if (pdfUrl && isValidHttpUrl(pdfUrl)) {
        fullTextUrl = pdfUrl;
        fullTextSourceType = 'pdf';
      } else if (landingPageUrl && isValidHttpUrl(landingPageUrl)) {
        fullTextUrl = landingPageUrl;
        fullTextSourceType = 'repository_page';
      }
      if (fullTextUrl) {
        allowedUse = 'open_access_fulltext';
        fullTextAvailable = true;
      }
    }

    // Frontiers Heuristics Fallback
    const isFrontiers = normalized.startsWith('10.3389/') || 
                        (rawMeta.publisher && rawMeta.publisher.toLowerCase().includes('frontiers'));
    if (isFrontiers) {
      htmlUrl = `https://www.frontiersin.org/articles/${normalized}/full`;
      pdfUrl = `https://www.frontiersin.org/articles/${normalized}/pdf`;
      allowedUse = 'open_access_fulltext';
      fullTextAvailable = true;
    }

    if (!fullTextAvailable) {
      warnings.push('Tài liệu đóng (Closed Access) hoặc không tìm thấy đường dẫn bản đọc công khai.');
    }

    const sanitized = sanitizeAcademicSourceData({
      title: rawMeta.title || `DOI ${normalized}`,
      authors: rawMeta.authors,
      journal: rawMeta.journal,
      publisher: rawMeta.publisher,
      year: rawMeta.year,
      doi: normalized,
      url: rawMeta.url || `https://doi.org/${normalized}`,
      pdfUrl,
      htmlUrl,
      openAccessStatus: up.oa_status || 'unknown',
      allowedUse,
      license: up.license || 'all-rights-reserved'
    });

    return {
      sourceType: 'doi',
      title: sanitized.title,
      authors: sanitized.authors || [],
      year: sanitized.year,
      journal: sanitized.journal,
      publisher: sanitized.publisher,
      doi: sanitized.doi,
      sourceUrl: sanitized.url,
      pdfUrl: sanitized.pdfUrl,
      htmlUrl: sanitized.htmlUrl,
      openAccessStatus: sanitized.openAccessStatus,
      license: sanitized.license,
      allowedUse: sanitized.allowedUse,
      fullTextAvailable,
      metadataProvider: crossrefResult.success ? 'crossref' : 'fallback_doi',
      warnings
    };
  }

  // ─── Case 2: Uploaded PDF Resolution ────────────────────────────────────────
  if (input.uploadedFileRef) {
    const fileRef = input.uploadedFileRef;
    if (!userId) {
      throw new Error('Yêu cầu định danh tài khoản kiểm duyệt để xác minh tệp tải lên.');
    }

    const publicId = fileRef.cloudinaryPublicId;
    if (!publicId || !publicId.startsWith('academic_sources/')) {
      throw new Error('Cloudinary publicId không đúng cấu trúc thư mục quy định (academic_sources/).');
    }

    let cloudAsset: any = null;
    try {
      cloudAsset = await getAssetMetadata(publicId, 'raw');
    } catch (cloudErr: any) {
      throw new Error(`Xác minh Cloudinary thất bại: Tệp tin không tồn tại hoặc không thể truy cập (${cloudErr.message || cloudErr}).`);
    }

    if (!cloudAsset || cloudAsset.resource_type !== 'raw') {
      throw new Error('Tài liệu đã tải lên không đúng định dạng raw/original document.');
    }

    const originalFileName = fileRef.originalFileName || (cloudAsset.original_filename ? `${cloudAsset.original_filename}.pdf` : 'document.pdf');
    const cleanTitle = originalFileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9]/g, ' ');

    const cleanOriginalFile = {
      storageProvider: 'cloudinary' as const,
      originalFileName,
      mimeType: fileRef.mimeType || 'application/pdf',
      fileSize: cloudAsset.bytes || 0,
      cloudinaryPublicId: publicId,
      cloudinarySecureUrl: cloudAsset.secure_url || '',
      cloudinaryResourceType: 'raw' as const,
      cloudinaryFormat: cloudAsset.format || 'pdf',
      uploadedBy: userId,
      uploadedAt: new Date()
    };

    warnings.push('Tài liệu PDF được lưu trữ thành công. Nội dung toàn văn sẽ được phân tích tự động.');

    return {
      sourceType: 'pdf_upload',
      title: cleanTitle,
      authors: [],
      openAccessStatus: 'open',
      allowedUse: 'open_access_fulltext',
      fullTextAvailable: true,
      metadataProvider: 'cloudinary_metadata',
      originalFile: cleanOriginalFile,
      warnings
    };
  }

  // ─── Case 3: ISBN Resolution ────────────────────────────────────────────────
  if (cleanIsbn) {
    const cleanIsbnDigits = cleanIsbn.replace(/[^0-9Xx]/g, '');
    const isbnResult = await fetchIsbnMetadata(cleanIsbnDigits);

    if (!isbnResult) {
      return {
        sourceType: 'isbn',
        title: `ISBN ${cleanIsbnDigits}`,
        authors: [],
        isbn: cleanIsbnDigits,
        openAccessStatus: 'closed',
        allowedUse: 'metadata_only',
        fullTextAvailable: false,
        metadataProvider: 'none',
        warnings: ['Không tìm thấy thông tin sách cho ISBN này.', 'ISBN chỉ cung cấp thông tin mô tả, không nhập toàn văn sách bản quyền.']
      };
    }

    const sanitized = sanitizeAcademicSourceData({
      title: isbnResult.title,
      authors: isbnResult.authors,
      publisher: isbnResult.publisher,
      year: isbnResult.year,
      isbn: cleanIsbnDigits,
      openAccessStatus: 'closed',
      allowedUse: 'metadata_only'
    });

    warnings.push('ISBN cung cấp thông tin sách bản quyền. Toàn văn sách không được tự động nhập.');

    return {
      sourceType: 'isbn',
      title: sanitized.title,
      authors: sanitized.authors || [],
      year: sanitized.year,
      publisher: sanitized.publisher,
      isbn: sanitized.isbn,
      openAccessStatus: sanitized.openAccessStatus,
      allowedUse: sanitized.allowedUse,
      fullTextAvailable: false,
      metadataProvider: isbnResult.metadataProvider,
      warnings
    };
  }

  // ─── Case 4: URL Resolution (Web HTML or Direct PDF URL) ────────────────────
  if (cleanUrl) {
    if (!isValidHttpUrl(cleanUrl)) {
      throw new Error('Địa chỉ URL không đúng định dạng giao thức http/https.');
    }

    const safe = await isUrlSafe(cleanUrl);
    if (!safe) {
      return {
        sourceType: 'web_url',
        title: 'Liên kết không an toàn',
        authors: [],
        sourceUrl: cleanUrl,
        openAccessStatus: 'restricted',
        allowedUse: 'metadata_only',
        fullTextAvailable: false,
        metadataProvider: 'security_block',
        warnings: ['SSRF: Đích đến URL không an toàn hoặc nằm trong dải IP nội bộ.']
      };
    }

    const pathLower = new URL(cleanUrl).pathname.toLowerCase();
    const isDirectPdf = pathLower.endsWith('.pdf');

    if (isDirectPdf) {
      warnings.push('URL trỏ trực tiếp đến tệp PDF. Việc nhập bản đọc cần được xác nhận bản quyền.');
      return {
        sourceType: 'pdf_url',
        title: 'Tài liệu PDF trực tuyến',
        authors: [],
        sourceUrl: cleanUrl,
        pdfUrl: cleanUrl,
        openAccessStatus: 'unknown',
        allowedUse: 'metadata_only', // Default to metadata_only for direct URL unless proven OA
        fullTextAvailable: true,
        metadataProvider: 'direct_pdf_url',
        warnings
      };
    }

    // Crawl HTML meta-tags using Cheerios safe fetching
    let htmlText = '';
    let resolvedUrl = cleanUrl;
    try {
      const crawlResult = await fetchUrlWithSafeRedirects(cleanUrl, false);
      htmlText = crawlResult.buffer.toString('utf-8');
      resolvedUrl = crawlResult.finalUrl;
    } catch (err: any) {
      console.warn('[Crawl HTML] Crawling failed gracefully:', err.message || err);
      warnings.push(`Không thể truy cập nội dung URL để trích xuất thẻ metadata (${err.message || err}).`);
      
      const parsedHost = new URL(cleanUrl).hostname;
      return {
        sourceType: 'web_url',
        title: `Bài viết từ ${parsedHost}`,
        authors: [],
        sourceUrl: cleanUrl,
        openAccessStatus: 'unknown',
        allowedUse: 'metadata_only',
        fullTextAvailable: false,
        metadataProvider: 'failed_crawl',
        warnings
      };
    }

    // Extract meta tags safely
    let title = '';
    let authors: string[] = [];
    let journal = '';
    let publisher = '';
    let year: number | undefined;

    try {
      const $ = cheerio.load(htmlText);
      title = $('meta[name="citation_title"]').attr('content') ||
              $('meta[property="og:title"]').attr('content') ||
              $('meta[name="twitter:title"]').attr('content') ||
              $('title').text() || '';

      $('meta[name="citation_author"]').each((_, el) => {
        const content = $(el).attr('content');
        if (content) authors.push(content.trim());
      });

      if (authors.length === 0) {
        const fallbackAuthor = $('meta[name="author"]').attr('content') ||
                               $('meta[property="og:article:author"]').attr('content');
        if (fallbackAuthor) authors.push(fallbackAuthor.trim());
      }

      journal = $('meta[name="citation_journal_title"]').attr('content') ||
                $('meta[property="og:site_name"]').attr('content') || '';

      publisher = $('meta[name="citation_publisher"]').attr('content') ||
                  $('meta[name="publisher"]').attr('content') || '';

      const dateStr = $('meta[name="citation_publication_date"]').attr('content') ||
                      $('meta[property="article:published_time"]').attr('content') ||
                      $('meta[name="date"]').attr('content') ||
                      $('meta[name="pubdate"]').attr('content');

      if (dateStr) {
        const match = dateStr.match(/\b\d{4}\b/);
        if (match) year = parseInt(match[0], 10);
      }

      const canonicalLink = $('link[rel="canonical"]').attr('href');
      if (canonicalLink && isValidHttpUrl(canonicalLink)) {
        resolvedUrl = canonicalLink;
      }
    } catch (parseErr: any) {
      console.warn('[Parse HTML] Parsing cheerio tags failed:', parseErr.message || parseErr);
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
      allowedUse: 'metadata_only'
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
      warnings
    };
  }

  throw new Error('Dữ liệu yêu cầu giải quyết nguồn trống hoặc không đúng định dạng.');
}
