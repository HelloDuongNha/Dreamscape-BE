import type { Readable } from 'stream';
import cloudinary from '../../../../config/cloudinary';
import {
  fetchUrlWithSafeRedirects,
  SsrfError,
} from '../../../../infrastructure/security/ssrfGuard';
import AcademicSource from '../../models/AcademicSource';
import {
  createOriginalPdfReadStream,
  hasStoredOriginalPdf,
  originalPdfAssetExists,
} from './originalPdfStorage.service';

export interface ApprovedSourceDocumentStatus {
  canEmbed: boolean;
  hasPdf: boolean;
  sourceKind: string;
  viewUrl?: string;
  message: string;
}

export type ApprovedSourcePdf =
  | { kind: 'stream'; stream: Readable; filename: string }
  | { kind: 'buffer'; buffer: Buffer };

export class ApprovedSourceDocumentError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

function isUrlPdfLike(urlString: string): boolean {
  try {
    const parsed = new URL(urlString.trim());
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.endsWith('.pdf')) return true;
    if (pathname.endsWith('/pdf') || pathname.endsWith('/pdf/')) return true;
    if (parsed.hostname.includes('frontiersin.org') && pathname.includes('/pdf')) return true;
    if (parsed.hostname.includes('plos.org') && parsed.searchParams.get('type') === 'printable') return true;
    return false;
  } catch {
    const lower = urlString.trim().toLowerCase();
    return lower.endsWith('.pdf') || lower.includes('/pdf/') || lower.includes('pdfurl');
  }
}

function findRemotePdf(source: any) {
  if (source.originalFile?.storageProvider === 'cloudinary' && source.originalFile?.cloudinarySecureUrl) {
    const mime = source.originalFile.mimeType || '';
    const name = source.originalFile.originalFileName || '';
    const format = source.originalFile.cloudinaryFormat || '';
    if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf') || format === 'pdf') {
      return {
        url: source.originalFile.cloudinarySecureUrl,
        sourceKind: 'cloudinary',
        cloudinaryPublicId: source.originalFile.cloudinaryPublicId || '',
      };
    }
  }

  if (source.pdfUrl?.trim().startsWith('http')) {
    return { url: source.pdfUrl.trim(), sourceKind: 'verified_oa_pdf', cloudinaryPublicId: '' };
  }

  const fallbackUrl = source.fullTextUrl || source.url;
  if (fallbackUrl?.trim().startsWith('http') && isUrlPdfLike(fallbackUrl.trim())) {
    return { url: fallbackUrl.trim(), sourceKind: 'verified_oa_pdf', cloudinaryPublicId: '' };
  }

  const metadataUrls = [
    source.metadata?.pdfUrl,
    source.metadata?.best_oa_location?.url_for_pdf,
    source.metadata?.bestOaLocation?.url_for_pdf,
  ].filter((url: unknown): url is string => (
    typeof url === 'string' && url.trim().startsWith('http')
  ));

  return metadataUrls.length
    ? { url: metadataUrls[0].trim(), sourceKind: 'verified_oa_pdf', cloudinaryPublicId: '' }
    : null;
}

export async function resolveApprovedSourceDocument(id: string): Promise<ApprovedSourceDocumentStatus | null> {
  const source = await AcademicSource.findById(id);
  if (!source) return null;

  if (hasStoredOriginalPdf(source.originalFile)) {
    const exists = await originalPdfAssetExists(source.originalFile!);
    if (!exists) {
      return {
        canEmbed: false,
        hasPdf: false,
        sourceKind: 'stored_pdf_missing',
        message: 'Tham chiếu PDF gốc còn tồn tại nhưng tệp đã mất khỏi kho lưu trữ.',
      };
    }
    return {
      viewUrl: `/sources/approved/${source._id}/pdf-inline`,
      canEmbed: true,
      hasPdf: true,
      sourceKind: source.originalFile?.storageProvider === 'firebase' ? 'firebase' : 'cloudinary',
      message: 'PDF gốc đã sẵn sàng.',
    };
  }

  const sourceData = source as any;
  const remotePdf = findRemotePdf(sourceData);
  if (remotePdf) {
    return {
      viewUrl: remotePdf.url,
      canEmbed: true,
      hasPdf: true,
      sourceKind: remotePdf.sourceKind,
      message: 'PDF gốc đã sẵn sàng.',
    };
  }

  const articleUrl = sourceData.fullTextUrl
    || sourceData.url
    || sourceData.landingPageUrl
    || (sourceData.doi
      ? `https://doi.org/${sourceData.doi.replace(/^(doi|DOI):\s*/, '').trim()}`
      : '');
  if (articleUrl?.trim().startsWith('http')) {
    return {
      canEmbed: false,
      hasPdf: false,
      sourceKind: 'article_only',
      viewUrl: articleUrl.trim(),
      message: 'Tài liệu là trang bài viết HTML, không có PDF để hiển thị trong hệ thống.',
    };
  }

  return {
    canEmbed: false,
    hasPdf: false,
    sourceKind: 'metadata_only',
    message: 'Không có file gốc để hiển thị. Hãy upload PDF hoặc dùng nguồn công khai khác.',
  };
}

export async function openApprovedSourcePdf(id: string): Promise<ApprovedSourcePdf> {
  const source = await AcademicSource.findById(id);
  if (!source) throw new ApprovedSourceDocumentError(404, 'Không tìm thấy tài liệu này.');

  if (hasStoredOriginalPdf(source.originalFile)) {
    try {
      return {
        kind: 'stream',
        stream: await createOriginalPdfReadStream(source.originalFile!),
        filename: source.originalFile?.originalFileName || 'document.pdf',
      };
    } catch (error: any) {
      if (String(error?.message || '').includes('không còn tồn tại')) {
        throw new ApprovedSourceDocumentError(
          404,
          'Tệp PDF gốc không còn tồn tại trong kho lưu trữ.',
          'ORIGINAL_PDF_MISSING',
        );
      }
      if ((source as any).pmcid) {
        throw new ApprovedSourceDocumentError(
          400,
          error.message || 'Lỗi khi tải tài liệu PDF.',
          'PDF_INVALID',
        );
      }
      throw error;
    }
  }

  const sourceData = source as any;
  const remotePdf = findRemotePdf(sourceData);
  if (!remotePdf) {
    throw new ApprovedSourceDocumentError(404, 'Tài liệu này không có tệp PDF.');
  }

  let buffer: Buffer;
  try {
    if (remotePdf.sourceKind === 'cloudinary' && remotePdf.cloudinaryPublicId) {
      const signedUrl = cloudinary.utils.private_download_url(
        remotePdf.cloudinaryPublicId,
        '',
        { resource_type: 'raw', type: 'upload' },
      );
      const response = await fetch(signedUrl);
      if (!response.ok) throw new Error(`Fetch Cloudinary PDF error: ${response.status}`);
      buffer = Buffer.from(await response.arrayBuffer());
    } else {
      buffer = (await fetchUrlWithSafeRedirects(remotePdf.url, true)).buffer;
    }
  } catch (error: any) {
    if (error instanceof SsrfError) throw error;
    if (sourceData.pmcid) {
      throw new ApprovedSourceDocumentError(
        400,
        error.message || 'Lỗi khi tải tài liệu PDF.',
        'PDF_INVALID',
      );
    }
    throw error;
  }

  return { kind: 'buffer', buffer };
}
