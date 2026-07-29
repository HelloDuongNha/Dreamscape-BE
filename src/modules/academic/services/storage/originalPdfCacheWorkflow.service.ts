import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { CacheAttemptSummary, OriginalPdfCacheResult } from '../../dto/originalPdfAsset.dto';
import { processPdfUpload, toOriginalFileRecord } from './pdfUpload.service';
import { deleteOriginalPdfAsset } from './originalPdfStorage.service';
import { collectOriginalPdfCandidates, isValidOriginalPdfAsset } from './originalPdfCandidate.service';
import { fetchOriginalPdfCandidate } from './originalPdfFetch.service';

// Cache one document while preserving its previous asset until the new save succeeds.
export async function cacheOriginalPdfForDocument(
  source: any,
  userId?: string,
  force?: boolean
): Promise<OriginalPdfCacheResult> {
  if (isValidOriginalPdfAsset(source.originalFile) && !force) {
    return {
      status: 'already_cached',
      source,
      attemptedCandidates: [],
      message: 'Tài liệu đã được lưu trong kho PDF gốc.',
    };
  }

  const oldOriginalFile = isValidOriginalPdfAsset(source.originalFile)
    ? (source.originalFile as any)?.toObject?.() || { ...source.originalFile }
    : undefined;
  const candidates = collectOriginalPdfCandidates(source);
  if (!candidates.length) {
    return {
      status: 'external_only',
      attemptedCandidates: [],
      message: 'Không tìm thấy đường dẫn PDF khả dụng để lưu trữ.',
    };
  }

  const attemptedCandidates: CacheAttemptSummary[] = [];
  const tmpDir = path.join(__dirname, '../../../tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  for (const url of candidates) {
    try {
      const fetched = await fetchOriginalPdfCandidate(url);
      if (!fetched.ok) {
        attemptedCandidates.push(fetched.attempt);
        continue;
      }

      const tempFilename = `${Date.now()}_cache_${Math.random().toString(36).substring(7)}.pdf`;
      const tempFilePath = path.join(tmpDir, tempFilename);
      fs.writeFileSync(tempFilePath, fetched.buffer);
      try {
        const uploadResult = await processPdfUpload(
          tempFilePath,
          source.title ? `${source.title.substring(0, 30)}.pdf` : 'document.pdf',
          'application/pdf'
        );
        source.originalFile = toOriginalFileRecord(
          uploadResult,
          userId ? new mongoose.Types.ObjectId(userId) : undefined
        );
        await source.save();

        if (oldOriginalFile) {
          try {
            await deleteOriginalPdfAsset(oldOriginalFile);
          } catch (error) {
            console.warn('Failed to delete previous PDF asset:', error);
          }
        }
        attemptedCandidates.push({ url, status: 'success', contentType: fetched.contentType });
        return {
          status: force ? 'recached' : 'cached',
          source,
          attemptedCandidates,
          message: force
            ? 'Cập nhật PDF từ nguồn online thành công.'
            : 'Lưu PDF gốc vào Firebase Storage thành công.',
        };
      } finally {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      }
    } catch (error: any) {
      console.warn(`Cache attempt failed for URL: ${url}. Error: ${error.message}`);
      attemptedCandidates.push({
        url,
        status: 'failed',
        contentType: error.contentType,
        reason: error.message || 'Lỗi khi tải hoặc xử lý PDF.',
      });
    }
  }

  return {
    status: 'cache_failed',
    source,
    attemptedCandidates,
    message: force
      ? 'Không thể lấy PDF online mới. PDF đang lưu vẫn được giữ nguyên.'
      : 'Tất cả các lượt tải PDF tự động đều thất bại hoặc bị chặn bởi máy chủ nguồn.',
  };
}
