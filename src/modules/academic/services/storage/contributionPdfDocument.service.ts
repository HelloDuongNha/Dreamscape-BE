import { v2 as cloudinary } from 'cloudinary';
import {
  fetchUrlWithSafeRedirects,
  SsrfError,
} from '../../../../infrastructure/security/ssrfGuard';
import SourceContribution from '../../models/SourceContribution';
import {
  createOriginalPdfReadStream,
  hasStoredOriginalPdf,
} from './originalPdfStorage.service';

export class ContributionPdfError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function isPdfLike(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    const path = parsed.pathname.toLowerCase();
    return path.endsWith('.pdf')
      || path.endsWith('/pdf')
      || path.endsWith('/pdf/')
      || (parsed.hostname.includes('frontiersin.org') && path.includes('/pdf'))
      || (parsed.hostname.includes('plos.org')
        && parsed.searchParams.get('type') === 'printable');
  } catch {
    return false;
  }
}

export async function openContributionPdf(contributionId: string) {
  const contribution = await SourceContribution.findById(contributionId);
  if (!contribution) {
    throw new ContributionPdfError(404, 'NOT_FOUND', 'Không tìm thấy tài liệu này.');
  }
  if (hasStoredOriginalPdf(contribution.originalFile)) {
    return {
      kind: 'stream' as const,
      filename: contribution.originalFile?.originalFileName || 'document.pdf',
      stream: await createOriginalPdfReadStream(contribution.originalFile!),
    };
  }

  const legacyFile = contribution.originalFile;
  const legacyCloudinaryPdf = legacyFile?.storageProvider === 'cloudinary'
    && legacyFile.cloudinarySecureUrl
    && (
      legacyFile.mimeType === 'application/pdf'
      || legacyFile.originalFileName?.toLowerCase().endsWith('.pdf')
      || legacyFile.cloudinaryFormat === 'pdf'
    );
  let url = legacyCloudinaryPdf
    ? legacyFile?.cloudinarySecureUrl || ''
    : contribution.pdfUrl?.trim() || '';
  if (!url && contribution.url?.trim().startsWith('http') && isPdfLike(contribution.url)) {
    url = contribution.url.trim();
  }
  if (!url) {
    throw new ContributionPdfError(404, 'NOT_FOUND', 'Tài liệu này không có tệp PDF.');
  }

  if (legacyCloudinaryPdf && legacyFile?.cloudinaryPublicId) {
    const signedUrl = cloudinary.utils.private_download_url(
      legacyFile.cloudinaryPublicId,
      '',
      { resource_type: 'raw', type: 'upload' },
    );
    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new ContributionPdfError(
        422,
        'PDF_FETCH_FAILED',
        'Không thể tải tệp PDF từ nguồn bên ngoài.',
      );
    }
    return { kind: 'buffer' as const, buffer: Buffer.from(await response.arrayBuffer()) };
  }

  try {
    const fetched = await fetchUrlWithSafeRedirects(url, true);
    return { kind: 'buffer' as const, buffer: fetched.buffer };
  } catch (error: any) {
    if (error instanceof SsrfError) throw error;
    if (error.message === 'Tệp không phải PDF hợp lệ.') {
      throw new ContributionPdfError(
        400,
        'PDF_INVALID',
        'Tài liệu tải về không phải tệp PDF hợp lệ.',
      );
    }
    throw new ContributionPdfError(
      422,
      'PDF_FETCH_FAILED',
      'Không thể tải tệp PDF từ nguồn bên ngoài.',
    );
  }
}
