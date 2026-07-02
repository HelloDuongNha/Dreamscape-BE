import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import AcademicSource from '../models/AcademicSource';
import SourceContribution from '../models/SourceContribution';
import { fetchUrlWithSafeRedirects } from '../utils/ssrfGuard';
import { processPdfUpload } from './pdfUpload.service';
import { deleteAsset } from './cloudinaryStorage.service';

export interface CacheAttemptSummary {
  url: string;
  status: 'success' | 'failed' | 'skipped';
  contentType?: string;
  reason?: string;
}

export function isValidOriginalPdfAsset(originalFile: any): boolean {
  if (!originalFile || originalFile.storageProvider !== 'cloudinary') return false;
  if (!originalFile.cloudinarySecureUrl) return false;
  
  const mime = originalFile.mimeType || '';
  const name = originalFile.originalFileName || '';
  const format = originalFile.cloudinaryFormat || '';
  
  return (
    mime === 'application/pdf' ||
    name.toLowerCase().endsWith('.pdf') ||
    format.toLowerCase() === 'pdf'
  );
}

export function collectOriginalPdfCandidates(source: any): string[] {
  const candidates: string[] = [];
  
  const isCloudinaryUrl = (u: string): boolean => {
    return u.toLowerCase().includes('cloudinary.com') || u.toLowerCase().includes('res.cloudinary.com');
  };
  
  // 1. Stored source.pdfUrl
  if (source.pdfUrl && typeof source.pdfUrl === 'string' && source.pdfUrl.trim().startsWith('http')) {
    const trimmed = source.pdfUrl.trim();
    if (!isCloudinaryUrl(trimmed)) {
      candidates.push(trimmed);
    }
  }

  // Find pmcid
  let pmcId = source.pmcid || source.normalizedPmcid || source.metadata?.pmcid || source.metadata?.pmcId;
  // Fallback to extract from URL if not direct
  if (!pmcId) {
    const urlsToScan = [source.pdfUrl, source.url, source.htmlUrl, source.metadata?.url, source.metadata?.htmlUrl];
    for (const url of urlsToScan) {
      if (url && typeof url === 'string') {
        const match = url.match(/(PMC\d+)/i);
        if (match) {
          pmcId = match[1];
          break;
        }
      }
    }
  }

  if (pmcId) {
    const cleanPmc = pmcId.trim().toUpperCase().startsWith('PMC') ? pmcId.trim().toUpperCase() : `PMC${pmcId.trim()}`;
    // 2. PMC /pdf/ page URL
    candidates.push(`https://pmc.ncbi.nlm.nih.gov/articles/${cleanPmc}/pdf/`);
    // 3. PMC HTML page URL
    candidates.push(`https://pmc.ncbi.nlm.nih.gov/articles/${cleanPmc}/`);
  }

  // 4. Wiley ePDF from DOI
  const doi = source.doi || source.normalizedDoi || source.metadata?.doi;
  if (doi && doi.trim().startsWith('10.1111/')) {
    candidates.push(`https://onlinelibrary.wiley.com/doi/epdf/${doi.trim()}`);
  }

  // 5. Other URL fields only if they look directly PDF-like
  const urlsToCheck = [source.url, source.htmlUrl, source.landingPageUrl, source.metadata?.url, source.metadata?.htmlUrl];
  for (const u of urlsToCheck) {
    if (u && typeof u === 'string' && u.trim().startsWith('http')) {
      const trimmed = u.trim();
      if (isCloudinaryUrl(trimmed)) continue;
      const lower = trimmed.toLowerCase();
      if (lower.endsWith('.pdf') || lower.includes('/pdf/') || lower.includes('/pdf?')) {
        candidates.push(trimmed);
      }
    }
  }

  return Array.from(new Set(candidates));
}


export async function cacheOriginalPdfForSource(
  sourceId: string,
  userId?: string,
  force?: boolean
): Promise<{
  status: 'cached' | 'already_cached' | 'cache_failed' | 'external_only' | 'recached';
  source?: any;
  attemptedCandidates: CacheAttemptSummary[];
  message: string;
}> {
  const source = await AcademicSource.findById(sourceId);
  if (!source) {
    throw new Error('Không tìm thấy tài liệu học thuật.');
  }
  
  // If already cached, skip (unless force is true)
  if (isValidOriginalPdfAsset(source.originalFile) && !force) {
    return {
      status: 'already_cached',
      source,
      attemptedCandidates: [],
      message: 'Tài liệu đã được lưu PDF gốc trên Cloudinary.'
    };
  }
  
  let oldPublicId: string | undefined;
  let oldResourceType: string | undefined;
  if (isValidOriginalPdfAsset(source.originalFile)) {
    oldPublicId = source.originalFile?.cloudinaryPublicId;
    oldResourceType = source.originalFile?.cloudinaryResourceType || 'raw';
  }
  
  const candidates = collectOriginalPdfCandidates(source);
  if (candidates.length === 0) {
    return {
      status: 'external_only',
      attemptedCandidates: [],
      message: 'Không tìm thấy đường dẫn PDF khả dụng để lưu trữ.'
    };
  }
  
  const attemptedCandidates: CacheAttemptSummary[] = [];
  
  // Create tmp dir if not exists
  const tmpDir = path.join(__dirname, '../../tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  
  for (const url of candidates) {
    try {
      let targetUrl = url;
      
      // If PMC article HTML page, try scraping direct relative PDF link first
      if (url.includes('pmc.ncbi.nlm.nih.gov/articles/') && !url.includes('/pdf/') && url.endsWith('/')) {
        try {
          const pageRes = await fetchUrlWithSafeRedirects(url, false);
          const html = pageRes.buffer.toString('utf-8');
          
          // Detect reCAPTCHA challenge on the PMC landing page itself
          if (html.includes('recaptcha') || html.includes('g-recaptcha') || pageRes.contentType.includes('recaptcha')) {
            attemptedCandidates.push({
              url,
              status: 'failed',
              contentType: pageRes.contentType,
              reason: 'recaptcha_challenge_page'
            });
            continue;
          }
          
          const regex = /\/articles\/PMC\d+\/pdf\/[^"'>\s]+/gi;
          const matches = html.match(regex);
          if (matches && matches.length > 0) {
            targetUrl = `https://pmc.ncbi.nlm.nih.gov${matches[0]}`;
            console.log(`Discovered direct PMC PDF URL from HTML page: ${targetUrl}`);
          } else {
            attemptedCandidates.push({
              url,
              status: 'failed',
              contentType: pageRes.contentType,
              reason: 'html_not_pdf'
            });
            continue;
          }
        } catch (discoverErr: any) {
          attemptedCandidates.push({
            url,
            status: 'failed',
            reason: 'fetch_failed'
          });
          continue;
        }
      }

      // Skip non-PMC publisher domains that we know will block automated fetches
      const lowerTarget = targetUrl.toLowerCase();
      if (
        (lowerTarget.includes('wiley.com') ||
         lowerTarget.includes('elsevier.com') ||
         lowerTarget.includes('sciencedirect.com') ||
         lowerTarget.includes('springer.com')) &&
        !lowerTarget.includes('pmc.ncbi.nlm.nih.gov')
      ) {
        attemptedCandidates.push({
          url: targetUrl,
          status: 'failed',
          reason: 'publisher_blocked'
        });
        continue;
      }
      
      // Fetch the PDF file
      let fetchRes;
      try {
        fetchRes = await fetchUrlWithSafeRedirects(targetUrl, false);
      } catch (fetchErr: any) {
        let reason = 'fetch_failed';
        const errMsg = fetchErr.message || '';
        if (errMsg.includes('403') || errMsg.toLowerCase().includes('forbidden') || errMsg.toLowerCase().includes('access denied')) {
          reason = 'publisher_blocked';
        } else if (errMsg.includes('401') || errMsg.includes('429')) {
          reason = 'publisher_blocked';
        }
        attemptedCandidates.push({
          url: targetUrl,
          status: 'failed',
          reason
        });
        continue;
      }
      
      const { buffer, contentType } = fetchRes;
      
      // Strict PDF validation: mime-type or starting bytes
      const isPdfType = contentType.includes('application/pdf') || contentType.includes('application/x-pdf');
      const hasPdfMagic = buffer.slice(0, 4).toString('ascii') === '%PDF';
      
      if (!isPdfType && !hasPdfMagic) {
        const bodyStr = buffer.toString('utf-8').substring(0, 2000);
        let reason: 'recaptcha_challenge_page' | 'publisher_blocked' | 'preparing_download_page' | 'html_not_pdf' = 'html_not_pdf';
        
        if (bodyStr.includes('recaptcha') || bodyStr.includes('g-recaptcha')) {
          reason = 'recaptcha_challenge_page';
        } else if (bodyStr.includes('Wiley Online Library') || bodyStr.includes('cookie') || bodyStr.includes('Access Denied')) {
          reason = 'publisher_blocked';
        } else if (bodyStr.includes('preparing') || bodyStr.includes('download')) {
          reason = 'preparing_download_page';
        }
        
        attemptedCandidates.push({
          url: targetUrl,
          status: 'failed',
          contentType,
          reason
        });
        continue;
      }
      
      // Write buffer to temp file
      const tempFilename = `${Date.now()}_cache_${Math.random().toString(36).substring(7)}.pdf`;
      const tempFilePath = path.join(tmpDir, tempFilename);
      fs.writeFileSync(tempFilePath, buffer);
      
      try {
        // 3. Upload to Cloudinary via existing processor service
        const uploadResult = await processPdfUpload(
          tempFilePath,
          source.title ? `${source.title.substring(0, 30)}.pdf` : 'document.pdf',
          'application/pdf'
        );
        
        // 4. Update Mongoose source
        source.originalFile = {
          storageProvider: 'cloudinary',
          originalFileName: uploadResult.original_filename,
          mimeType: 'application/pdf',
          fileSize: uploadResult.bytes,
          cloudinaryPublicId: uploadResult.public_id,
          cloudinarySecureUrl: uploadResult.secure_url,
          cloudinaryResourceType: 'raw',
          cloudinaryFormat: uploadResult.format,
          uploadedBy: userId ? new mongoose.Types.ObjectId(userId) : undefined,
          uploadedAt: new Date(),
          fileHash: uploadResult.fileHash
        };
        
        await source.save();
        
        // ONLY after save succeeds, delete old Cloudinary asset
        if (oldPublicId) {
          try {
            await deleteAsset(oldPublicId, oldResourceType || 'raw');
          } catch (deleteOldErr) {
            console.warn(`Failed to delete old Cloudinary asset ${oldPublicId}:`, deleteOldErr);
          }
        }
        
        attemptedCandidates.push({
          url,
          status: 'success',
          contentType
        });
        
        return {
          status: force ? 'recached' : 'cached',
          source,
          attemptedCandidates,
          message: force ? 'Cập nhật PDF từ nguồn online thành công.' : 'Lưu PDF gốc vào Cloudinary thành công.'
        };
      } finally {
        // Cleanup temp file
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    } catch (err: any) {
      console.warn(`Cache attempt failed for URL: ${url}. Error: ${err.message}`);
      attemptedCandidates.push({
        url,
        status: 'failed',
        contentType: err.contentType,
        reason: err.message || 'Lỗi khi tải hoặc xử lý PDF.'
      });
    }
  }
  
  return {
    status: 'cache_failed',
    source,
    attemptedCandidates,
    message: force ? 'Không thể lấy PDF online mới. PDF đang lưu trên Cloudinary vẫn được giữ nguyên.' : 'Tất cả các lượt tải PDF tự động đều thất bại hoặc bị chặn bởi máy chủ nguồn.'
  };
}

export async function cacheOriginalPdfForContribution(
  contributionId: string,
  userId?: string,
  force?: boolean
): Promise<{
  status: 'cached' | 'already_cached' | 'cache_failed' | 'external_only' | 'recached';
  source?: any;
  attemptedCandidates: CacheAttemptSummary[];
  message: string;
}> {
  const source = await SourceContribution.findById(contributionId);
  if (!source) {
    throw new Error('Không tìm thấy tài liệu học thuật.');
  }
  
  // If already cached, skip (unless force is true)
  if (isValidOriginalPdfAsset(source.originalFile) && !force) {
    return {
      status: 'already_cached',
      source,
      attemptedCandidates: [],
      message: 'Tài liệu đã được lưu PDF gốc trên Cloudinary.'
    };
  }
  
  let oldPublicId: string | undefined;
  let oldResourceType: string | undefined;
  if (isValidOriginalPdfAsset(source.originalFile)) {
    oldPublicId = source.originalFile?.cloudinaryPublicId;
    oldResourceType = source.originalFile?.cloudinaryResourceType || 'raw';
  }
  
  const candidates = collectOriginalPdfCandidates(source);
  if (candidates.length === 0) {
    return {
      status: 'external_only',
      attemptedCandidates: [],
      message: 'Không tìm thấy đường dẫn PDF khả dụng để lưu trữ.'
    };
  }
  
  const attemptedCandidates: CacheAttemptSummary[] = [];
  
  // Create tmp dir if not exists
  const tmpDir = path.join(__dirname, '../../tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  
  for (const url of candidates) {
    try {
      let targetUrl = url;
      
      // If PMC article HTML page, try scraping direct relative PDF link first
      if (url.includes('pmc.ncbi.nlm.nih.gov/articles/') && !url.includes('/pdf/') && url.endsWith('/')) {
        try {
          const pageRes = await fetchUrlWithSafeRedirects(url, false);
          const html = pageRes.buffer.toString('utf-8');
          
          // Detect reCAPTCHA challenge on the PMC landing page itself
          if (html.includes('recaptcha') || html.includes('g-recaptcha') || pageRes.contentType.includes('recaptcha')) {
            attemptedCandidates.push({
              url,
              status: 'failed',
              contentType: pageRes.contentType,
              reason: 'recaptcha_challenge_page'
            });
            continue;
          }
          
          const regex = /\/articles\/PMC\d+\/pdf\/[^"'>\s]+/gi;
          const matches = html.match(regex);
          if (matches && matches.length > 0) {
            targetUrl = `https://pmc.ncbi.nlm.nih.gov${matches[0]}`;
            console.log(`Discovered direct PMC PDF URL from HTML page: ${targetUrl}`);
          } else {
            attemptedCandidates.push({
              url,
              status: 'failed',
              contentType: pageRes.contentType,
              reason: 'html_not_pdf'
            });
            continue;
          }
        } catch (discoverErr: any) {
          attemptedCandidates.push({
            url,
            status: 'failed',
            reason: 'fetch_failed'
          });
          continue;
        }
      }

      // Skip non-PMC publisher domains that we know will block automated fetches
      const lowerTarget = targetUrl.toLowerCase();
      if (
        (lowerTarget.includes('wiley.com') ||
         lowerTarget.includes('elsevier.com') ||
         lowerTarget.includes('sciencedirect.com') ||
         lowerTarget.includes('springer.com')) &&
        !lowerTarget.includes('pmc.ncbi.nlm.nih.gov')
      ) {
        attemptedCandidates.push({
          url: targetUrl,
          status: 'failed',
          reason: 'publisher_blocked'
        });
        continue;
      }
      
      // Fetch the PDF file
      let fetchRes;
      try {
        fetchRes = await fetchUrlWithSafeRedirects(targetUrl, false);
      } catch (fetchErr: any) {
        let reason = 'fetch_failed';
        const errMsg = fetchErr.message || '';
        if (errMsg.includes('403') || errMsg.toLowerCase().includes('forbidden') || errMsg.toLowerCase().includes('access denied')) {
          reason = 'publisher_blocked';
        } else if (errMsg.includes('401') || errMsg.includes('429')) {
          reason = 'publisher_blocked';
        }
        attemptedCandidates.push({
          url: targetUrl,
          status: 'failed',
          reason
        });
        continue;
      }
      
      const { buffer, contentType } = fetchRes;
      
      // Strict PDF validation: mime-type or starting bytes
      const isPdfType = contentType.includes('application/pdf') || contentType.includes('application/x-pdf');
      const hasPdfMagic = buffer.slice(0, 4).toString('ascii') === '%PDF';
      
      if (!isPdfType && !hasPdfMagic) {
        const bodyStr = buffer.toString('utf-8').substring(0, 2000);
        let reason: 'recaptcha_challenge_page' | 'publisher_blocked' | 'preparing_download_page' | 'html_not_pdf' = 'html_not_pdf';
        
        if (bodyStr.includes('recaptcha') || bodyStr.includes('g-recaptcha')) {
          reason = 'recaptcha_challenge_page';
        } else if (bodyStr.includes('Wiley Online Library') || bodyStr.includes('cookie') || bodyStr.includes('Access Denied')) {
          reason = 'publisher_blocked';
        } else if (bodyStr.includes('preparing') || bodyStr.includes('download')) {
          reason = 'preparing_download_page';
        }
        
        attemptedCandidates.push({
          url: targetUrl,
          status: 'failed',
          contentType,
          reason
        });
        continue;
      }
      
      // Write buffer to temp file
      const tempFilename = `${Date.now()}_cache_${Math.random().toString(36).substring(7)}.pdf`;
      const tempFilePath = path.join(tmpDir, tempFilename);
      fs.writeFileSync(tempFilePath, buffer);
      
      try {
        // 3. Upload to Cloudinary via existing processor service
        const uploadResult = await processPdfUpload(
          tempFilePath,
          source.title ? `${source.title.substring(0, 30)}.pdf` : 'document.pdf',
          'application/pdf'
        );
        
        // 4. Update Mongoose source
        source.originalFile = {
          storageProvider: 'cloudinary',
          originalFileName: uploadResult.original_filename,
          mimeType: 'application/pdf',
          fileSize: uploadResult.bytes,
          cloudinaryPublicId: uploadResult.public_id,
          cloudinarySecureUrl: uploadResult.secure_url,
          cloudinaryResourceType: 'raw',
          cloudinaryFormat: uploadResult.format,
          uploadedBy: userId ? new mongoose.Types.ObjectId(userId) : undefined,
          uploadedAt: new Date(),
          fileHash: uploadResult.fileHash
        };
        
        await source.save();
        
        // ONLY after save succeeds, delete old Cloudinary asset
        if (oldPublicId) {
          try {
            await deleteAsset(oldPublicId, oldResourceType || 'raw');
          } catch (deleteOldErr) {
            console.warn(`Failed to delete old Cloudinary asset ${oldPublicId}:`, deleteOldErr);
          }
        }
        
        attemptedCandidates.push({
          url,
          status: 'success',
          contentType
        });
        
        return {
          status: force ? 'recached' : 'cached',
          source,
          attemptedCandidates,
          message: force ? 'Cập nhật PDF từ nguồn online thành công.' : 'Lưu PDF gốc vào Cloudinary thành công.'
        };
      } finally {
        // Cleanup temp file
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    } catch (err: any) {
      console.warn(`Cache attempt failed for URL: ${url}. Error: ${err.message}`);
      attemptedCandidates.push({
        url,
        status: 'failed',
        contentType: err.contentType,
        reason: err.message || 'Lỗi khi tải hoặc xử lý PDF.'
      });
    }
  }
  
  return {
    status: 'cache_failed',
    source,
    attemptedCandidates,
    message: force ? 'Không thể lấy PDF online mới. PDF đang lưu trên Cloudinary vẫn được giữ nguyên.' : 'Tất cả các lượt tải PDF tự động đều thất bại hoặc bị chặn bởi máy chủ nguồn.'
  };
}
