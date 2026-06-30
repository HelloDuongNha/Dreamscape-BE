// @ts-nocheck
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import SourceContribution from '../models/SourceContribution';
import AcademicSource from '../models/AcademicSource';
import AcademicDocument from '../models/AcademicDocument';
import AcademicSection from '../models/AcademicSection';
import AcademicChunk from '../models/AcademicChunk';
import PendingKnowledgeRule from '../models/PendingKnowledgeRule';
import VerifiedKnowledgeRule from '../models/VerifiedKnowledgeRule';
import KnowledgeRuleEvidence from '../models/KnowledgeRuleEvidence';
import AcademicRuleExtractionRun from '../models/AcademicRuleExtractionRun';
import { generateEmbedding } from '../services/llm.service';
import {
  extractRuleCandidatesFromSource,
  splitIntoSentences,
  cleanExcerptText,
  extractExcerptsFromChunk
} from '../services/ruleCandidateExtraction.service';
import {
  isUrlSafe,
  isValidHttpUrl,
  SsrfError,
  fetchUrlWithSafeRedirects
} from '../utils/ssrfGuard';
import { PDFParse } from 'pdf-parse';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { parseHtmlArticle } from '../utils/htmlArticleParser';
import { importFullTextForSource } from '../services/fullTextImport.service';
import { resolveSourceImport } from '../services/sourceImportResolver.service';
import { recordApproval, recordRejection } from '../services/contributionStats.service';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { uploadPdf, deleteAsset } from '../services/cloudinaryStorage.service';
import { sanitizeAcademicSourceData } from '../utils/sourceSanitizer';
import { processPdfUpload } from '../services/pdfUpload.service';

const activeExtractions = new Set<string>();

const sanitizeError = (err: any): string => {
  const msg = err?.message || String(err);
  return msg
    .replace(/mongodb(\+srv)?:\/\/[^\s]+/gi, '[DATABASE_URI_REDACTED]')
    .replace(/\/[a-zA-Z0-9_\.\-\/]+/g, (match: string) => {
      if (match.includes('/') && (match.includes('Users') || match.includes('home') || match.includes('var') || match.includes('tmp') || match.includes('node_modules'))) {
        return '[FILE_PATH_REDACTED]';
      }
      return match;
    });
};

export function mapSourceContribution(doc: any) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  
  const hasOriginalFile = obj.originalFile && (obj.originalFile.originalFileName || obj.originalFile.cloudinarySecureUrl);
  if (hasOriginalFile) {
    const orig = { ...obj.originalFile };
    
    // Map alternative names inside originalFile
    orig.cloudinarySecureUrl = orig.cloudinarySecureUrl || '';
    orig.secureUrl = orig.cloudinarySecureUrl || '';
    orig.url = orig.cloudinarySecureUrl || '';
    
    orig.originalFilename = orig.originalFileName || '';
    orig.originalFileName = orig.originalFileName || '';
    orig.bytes = orig.fileSize || 0;
    orig.size = orig.fileSize || 0;
    orig.fileSize = orig.fileSize || 0;
    orig.mimeType = orig.mimeType || '';
    orig.fileHash = orig.fileHash || '';
    orig.sha256 = orig.fileHash || '';
    
    obj.originalFile = orig;
    
    // Top-level mappings
    obj.pdfUrl = obj.pdfUrl || orig.cloudinarySecureUrl || '';
    obj.fullTextUrl = obj.fullTextUrl || orig.cloudinarySecureUrl || '';
    obj.fileHash = obj.fileHash || orig.fileHash || '';
    
    // Determine contributionType/sourceType
    obj.contributionType = obj.doi ? 'doi' : 'pdf_upload';
    obj.sourceType = obj.doi ? 'doi' : 'pdf_upload';
    obj.sourceOrigin = 'uploaded_pdf';
  } else {
    // If no originalFile, still set defaults/sourceType if available
    obj.originalFile = undefined;
    obj.contributionType = obj.doi ? 'doi' : 'metadata';
    obj.sourceType = obj.doi ? 'doi' : 'metadata';
    obj.sourceOrigin = obj.sourceOrigin || (obj.doi ? 'doi_import' : 'unspecified');
  }
  
  return obj;
}


/**
 * GET /api/moderation/sources
 * Retrieves source contributions by status with pagination.
 * Access: Moderator only
 */
export const getPendingSources = async (req: Request, res: Response): Promise<void> => {
  try {
    let status: 'pending' | 'approved' | 'rejected' = 'pending';
    const queryStatus = req.query.status as string;
    if (queryStatus === 'approved' || queryStatus === 'rejected') {
      status = queryStatus;
    }

    let page = parseInt(req.query.page as string, 10);
    if (isNaN(page) || page < 1) page = 1;

    let limit = parseInt(req.query.limit as string, 10);
    if (isNaN(limit) || limit < 1) limit = 20;
    if (limit > 50) limit = 50;

    const skip = (page - 1) * limit;

    const total = await SourceContribution.countDocuments({ reviewStatus: status });
    const sources = await SourceContribution.find({ reviewStatus: status })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('submittedBy', 'username display_name email avatar');

    res.status(200).json({
      success: true,
      message: 'Source contributions retrieved successfully.',
      data: {
        sources: sources.map(mapSourceContribution),
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching moderation sources.',
      error: err.message || err,
    });
  }
};

/**
 * PATCH /api/moderation/sources/:id/status
 * Approves or rejects a source contribution. If approved, promotes it to AcademicSource.
 * Access: Moderator only
 */
/**
 * PATCH /api/moderation/sources/:id/status
 * Approves or rejects a source contribution. If approved, promotes it to AcademicSource.
 * Access: Moderator only
 */
export const reviewSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { reviewStatus, reviewNote } = req.body as {
      reviewStatus: string;
      reviewNote?: string;
    };

    const reviewerId = req.user?._id;
    if (!reviewerId) {
      res.status(401).json({ success: false, message: 'Unauthorized. User session not found.' });
      return;
    }

    // 1. Validation of reviewStatus
    if (!reviewStatus || !['approved', 'rejected'].includes(reviewStatus)) {
      res.status(400).json({
        success: false,
        message: 'Invalid review status. Only "approved" or "rejected" are allowed.',
      });
      return;
    }

    // 2. Validation of reviewNote length
    const cleanNote = (reviewNote || '').trim();
    if (cleanNote.length > 1000) {
      res.status(400).json({
        success: false,
        message: 'Review note must not exceed 1000 characters.',
      });
      return;
    }

    // 3. Find target contribution
    const contribution = await SourceContribution.findById(id);
    if (!contribution) {
      res.status(404).json({
        success: false,
        message: 'Source contribution not found.',
      });
      return;
    }

    const previousStatus = contribution.reviewStatus;

    // 4. Reject re-reviews (cannot review an already approved/rejected contribution)
    if (contribution.reviewStatus !== 'pending') {
      res.status(409).json({
        success: false,
        message: `This contribution has already been reviewed (status: ${contribution.reviewStatus}).`,
      });
      return;
    }

    // 5. If approved, verify uniqueness before promotion and create AcademicSource
    if (reviewStatus === 'approved') {
      // Build conditions to search AcademicSource for existing entry with same contribution ID, DOI, or URL
      const orConditions: any[] = [{ sourceContributionId: contribution._id }];
      if (contribution.normalizedDoi) {
        orConditions.push({ normalizedDoi: contribution.normalizedDoi });
      }
      if (contribution.normalizedUrl) {
        orConditions.push({ normalizedUrl: contribution.normalizedUrl });
      }

      const duplicateSource = await AcademicSource.findOne({ $or: orConditions });
      if (duplicateSource) {
        res.status(409).json({
          success: false,
          message: 'An academic source with the same contribution ID, DOI, or URL already exists.',
        });
        return;
      }

      // Defensive Metadata Sanitization
      const rawMetadata = contribution.metadata || {};
      const sanitizedMeta = sanitizeAcademicSourceData({
        title: rawMetadata.title || contribution.title,
        authors: rawMetadata.authors || contribution.authors,
        journal: rawMetadata.journal || rawMetadata.publisher || contribution.journal,
        publisher: rawMetadata.publisher || contribution.publisher,
        year: rawMetadata.year || contribution.year,
        doi: contribution.doi || rawMetadata.doi,
        url: contribution.url || rawMetadata.url,
        pdfUrl: contribution.pdfUrl || rawMetadata.pdfUrl,
        htmlUrl: contribution.htmlUrl || rawMetadata.htmlUrl,
        xmlUrl: contribution.xmlUrl || rawMetadata.xmlUrl,
        landingPageUrl: contribution.landingPageUrl || rawMetadata.landingPageUrl,
        openAccessStatus: contribution.openAccessStatus || rawMetadata.openAccessStatus || contribution.oaStatus || rawMetadata.oaStatus,
        allowedUse: contribution.allowedUse || rawMetadata.allowedUse,
        license: contribution.license || rawMetadata.license,
      });

      const isUploadedPdf = !!(contribution.originalFile && (contribution.originalFile.originalFileName || contribution.originalFile.cloudinarySecureUrl));

      // Update SourceContribution's own metadata with sanitized fields to match
      contribution.metadata = { ...rawMetadata, ...sanitizedMeta };
      contribution.title = sanitizedMeta.title || contribution.title;
      contribution.authors = sanitizedMeta.authors || contribution.authors;
      contribution.year = sanitizedMeta.year || contribution.year;
      contribution.journal = sanitizedMeta.journal || contribution.journal;
      contribution.publisher = sanitizedMeta.publisher || contribution.publisher;
      contribution.openAccessStatus = sanitizedMeta.openAccessStatus;
      contribution.oaStatus = sanitizedMeta.oaStatus;
      contribution.license = sanitizedMeta.license || contribution.license || 'all-rights-reserved';
      contribution.pdfUrl = sanitizedMeta.pdfUrl || contribution.pdfUrl;
      contribution.htmlUrl = sanitizedMeta.htmlUrl || contribution.htmlUrl;
      
      if (isUploadedPdf) {
        contribution.allowedUse = 'open_access_fulltext';
        contribution.readableInApp = true;
        contribution.fullTextStatus = 'available';
        contribution.fullTextSourceType = 'pdf';
        contribution.pdfUrl = contribution.originalFile?.cloudinarySecureUrl;
        contribution.fullTextUrl = contribution.originalFile?.cloudinarySecureUrl;
        contribution.copyrightStatus = 'paywalled';
        contribution.verificationStatus = 'manual';
        contribution.metadata.allowedUse = 'open_access_fulltext';
        contribution.sourceOrigin = 'uploaded_pdf';
      } else {
        contribution.allowedUse = sanitizedMeta.allowedUse || contribution.allowedUse || 'metadata_only';
        contribution.sourceOrigin = contribution.sourceOrigin || (contribution.doi ? 'doi_import' : 'url_import');
      }

      // Create AcademicSource document with fully sanitized data
      const academicSource = new AcademicSource({
        sourceContributionId: contribution._id,
        doi: sanitizedMeta.doi || contribution.doi,
        normalizedDoi: contribution.normalizedDoi,
        url: isUploadedPdf ? contribution.url : (sanitizedMeta.url || contribution.url),
        normalizedUrl: contribution.normalizedUrl,
        metadata: contribution.metadata,
        license: contribution.license,
        allowedUse: contribution.allowedUse,
        copyrightStatus: contribution.copyrightStatus || (contribution.allowedUse === 'open_access_fulltext' ? 'copyrighted_with_open_access' : 'paywalled'),
        verificationStatus: contribution.verificationStatus || 'unverified',
        sourceQuality: contribution.sourceQuality || 'informal',
        fullTextStatus: contribution.fullTextStatus || 'none',
        fullTextUrl: contribution.fullTextUrl,
        oaStatus: contribution.oaStatus,
        openAccessStatus: contribution.openAccessStatus,
        readableInApp: contribution.readableInApp || false,
        fullTextSourceType: contribution.fullTextSourceType || 'unknown',
        landingPageUrl: sanitizedMeta.landingPageUrl || contribution.landingPageUrl,
        pdfUrl: contribution.pdfUrl,
        xmlUrl: sanitizedMeta.xmlUrl || contribution.xmlUrl,
        htmlUrl: sanitizedMeta.htmlUrl || contribution.htmlUrl,
        title: sanitizedMeta.title,
        authors: sanitizedMeta.authors,
        journal: sanitizedMeta.journal || sanitizedMeta.publisher,
        year: sanitizedMeta.year,
        originalFile: contribution.originalFile,
        sourceOrigin: contribution.sourceOrigin || (isUploadedPdf ? 'uploaded_pdf' : 'doi_import')
      });

      await academicSource.save();

      // Update SourceContribution status to approved
      contribution.reviewStatus = 'approved';
      contribution.reviewedBy = reviewerId;
      contribution.reviewedAt = new Date();
      if (reviewNote !== undefined) {
        contribution.reviewNote = cleanNote || undefined;
      }
      await contribution.save();

      if (previousStatus !== 'approved') {
        try {
          await recordApproval(contribution.submittedBy.toString(), contribution);
        } catch (statsErr) {
          console.error('Failed to record contribution approval:', statsErr);
        }
      }

      // Initialize status reporting info
      let resMessage = 'Nguồn đã được duyệt.';
      let warning = false;
      let code = undefined;
      let details = undefined;
      let importResult = null;

      // Promotion Check: check if preview document exists
      const previewDoc = await AcademicDocument.findOne({ previewContributionId: contribution._id });
      if (previewDoc) {
        console.log(`Promoting preview full text data for source ${academicSource._id}`);
        // Promotes all preview records: set sourceId and unset previewContributionId
        await AcademicDocument.updateOne({ previewContributionId: contribution._id }, { $set: { sourceId: academicSource._id }, $unset: { previewContributionId: 1 } });
        await AcademicSection.updateMany({ previewContributionId: contribution._id }, { $set: { sourceId: academicSource._id }, $unset: { previewContributionId: 1 } });
        await AcademicChunk.updateMany({ previewContributionId: contribution._id }, { $set: { sourceId: academicSource._id }, $unset: { previewContributionId: 1 } });

        const ragCount = await AcademicChunk.countDocuments({ sourceId: academicSource._id, chunkPurpose: 'rag' });

        // Copy lightweight metadata flags
        academicSource.fullTextStatus = contribution.fullTextStatus || 'imported';
        academicSource.readableInApp = contribution.readableInApp || true;
        academicSource.chunkBuildStatus = 'completed';
        academicSource.chunkCount = ragCount;
        academicSource.chunkEmbeddingModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
        academicSource.chunkBuiltAt = new Date();
        academicSource.fullTextImportedAt = new Date();
        academicSource.fullTextImportedBy = reviewerId;
        academicSource.fullTextImportError = undefined;
        await academicSource.save();

        resMessage = 'Nguồn đã được duyệt và dữ liệu xem trước đã được chuyển giao thành công.';
      } else {
        // Handle custom warning message logic for FE
        if (sanitizedMeta.openAccessStatus === 'hybrid') {
          resMessage = "Hybrid Open Access metadata saved. Full text import is available only if a direct public PDF/HTML URL exists.";
          warning = true;
          code = "HYBRID_OA_METADATA_ONLY";
        } else if (academicSource.allowedUse !== 'open_access_fulltext' || (!academicSource.pdfUrl && !academicSource.url && !academicSource.fullTextUrl)) {
          resMessage = "Nguồn đã được duyệt, nhưng chưa có toàn văn để nhập.";
          warning = true;
          code = "APPROVED_METADATA_ONLY";
        } else {
          // Automatically attempt full-text import on approval if eligible and copyright permits
          const isUploadedPdf = !!(academicSource.originalFile && (academicSource.originalFile.originalFileName || academicSource.originalFile.cloudinarySecureUrl));
          const hasAllowedCopyright = isUploadedPdf || academicSource.copyrightStatus === 'copyrighted_with_open_access' || academicSource.copyrightStatus === 'public_domain' || academicSource.allowedUse === 'open_access_fulltext';
          if (hasAllowedCopyright) {
            try {
              console.log(`Auto-importing full text on approval for source ${academicSource._id}`);
              const result = await importFullTextInternal(academicSource, reviewerId);
              if (result.success) {
                if (result.warning) {
                  resMessage = result.message || 'Nguồn đã được duyệt, nhưng nhập bản đọc tự động bị chặn.';
                  warning = true;
                  code = result.code;
                  details = result.details;
                } else {
                  resMessage = 'Nguồn đã được duyệt và nhập bản đọc thành công.';
                  importResult = result.data;
                }
              } else {
                resMessage = 'Nguồn đã được duyệt, nhưng nhập bản đọc tự động thất bại.';
                warning = true;
                code = "FULLTEXT_IMPORT_FAILED";
                details = { error: result.error || result.message };
              }
            } catch (importErr: any) {
              console.error('Auto-import on approval crashed:', importErr);
              resMessage = 'Nguồn đã được duyệt, nhưng nhập bản đọc tự động gặp lỗi hệ thống.';
              warning = true;
              code = "FULLTEXT_IMPORT_SYSTEM_ERROR";
              details = { error: importErr.message || importErr };
            }
          } else {
            resMessage = "Nguồn đã được duyệt, nhưng chưa có toàn văn để nhập.";
            warning = true;
            code = "APPROVED_METADATA_ONLY";
          }
        }
      }

      res.status(200).json({
        success: true,
        warning,
        code,
        message: resMessage,
        details,
        data: {
          contribution: mapSourceContribution(contribution),
          academicSource: mapSourceContribution(academicSource),
          fullText: importResult ? importResult.fullText : undefined
        },
      });
      return;
    }

    // 6. If rejected, update SourceContribution status only
    contribution.reviewStatus = 'rejected';
    contribution.reviewedBy = reviewerId;
    contribution.reviewedAt = new Date();
    if (reviewNote !== undefined) {
      contribution.reviewNote = cleanNote || undefined;
    }
    await contribution.save();

    // Retrieve chunk IDs linked to the contribution
    const chunkIds = await AcademicChunk.find({ previewContributionId: contribution._id }).distinct('_id');

    // Clean up preview staging records on rejection
    await AcademicDocument.deleteMany({ previewContributionId: contribution._id });
    await AcademicSection.deleteMany({ previewContributionId: contribution._id });
    await AcademicChunk.deleteMany({ previewContributionId: contribution._id });
    await AcademicRuleExtractionRun.deleteMany({ academicSourceId: contribution._id });
    await PendingKnowledgeRule.deleteMany({ evidenceChunkIds: { $in: chunkIds } });
    await KnowledgeRuleEvidence.deleteMany({ chunkId: { $in: chunkIds } });

    if (previousStatus !== 'rejected') {
      try {
        await recordRejection(contribution.submittedBy.toString());
      } catch (statsErr) {
        console.error('Failed to record contribution rejection:', statsErr);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Source contribution rejected.',
      data: {
        contribution: mapSourceContribution(contribution),
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message || 'An error occurred while reviewing the source contribution.',
      error: err.message || err,
    });
  }
};


async function fetchPdfWithSafeRedirects(
  initialUrl: string,
  maxRedirects = 3
): Promise<{ buffer: Buffer, finalUrl: string }> {
  const result = await fetchUrlWithSafeRedirects(initialUrl, true, maxRedirects);
  return { buffer: result.buffer, finalUrl: result.finalUrl };
}

function splitTextIntoSections(text: string): string[] {
  let parts = text.split('\f');
  parts = parts.map(p => p.trim()).filter(p => p.length > 0);

  if (parts.length <= 1) {
    parts = [];
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = '';
    
    for (const p of paragraphs) {
      const trimmed = p.trim();
      if (!trimmed) continue;
      
      if (currentChunk.length + trimmed.length > 4000) {
        if (currentChunk) {
          parts.push(currentChunk.trim());
        }
        currentChunk = trimmed;
      } else {
        currentChunk = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed;
      }
    }
    if (currentChunk.trim()) {
      parts.push(currentChunk.trim());
    }
  }

  const finalParts: string[] = [];
  for (const part of parts) {
    let remaining = part;
    while (remaining.length > 8000) {
      finalParts.push(remaining.substring(0, 8000));
      remaining = remaining.substring(8000);
    }
    if (remaining.trim()) {
      finalParts.push(remaining.trim());
    }
  }

  return finalParts;
}

/**
 * POST /api/moderation/sources/:id/import-fulltext
 * Manually imports full text for eligible Open Access AcademicSource.
 * Access: Moderator only
 */
/**
 * Shared helper function to import fulltext for an AcademicSource document.
 * This performs safe URL downloads, runs pdf parsing, saves sections, and updates fullTextStatus.
 */
export const importFullTextInternal = async (
  source: any,
  moderatorId: mongoose.Types.ObjectId
): Promise<any> => {
  return importFullTextForSource(source, moderatorId);
};

/**
 * POST /api/moderation/sources/:id/import-fulltext
 * Manually imports full text for eligible Open Access AcademicSource.
 * Access: Moderator only
 */
export const importFullText = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const moderatorId = req.user?._id;

  if (!moderatorId) {
    res.status(401).json({ success: false, message: 'Unauthorized. User session not found.' });
    return;
  }

  try {
    const cleanId = id as string;
    if (!cleanId || !mongoose.Types.ObjectId.isValid(cleanId)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    let source = await AcademicSource.findById(cleanId);
    let isContribution = false;
    if (!source) {
      source = await SourceContribution.findById(cleanId);
      if (source) {
        isContribution = true;
      }
    }

    if (!source) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    // 1. Eligibility Check
    if (source.allowedUse !== 'open_access_fulltext') {
      res.status(400).json({ success: false, message: 'Tài liệu không hỗ trợ bản đọc toàn văn mở (Metadata only).' });
      return;
    }

    const isUploadedPdf = !!(source.originalFile && (source.originalFile.originalFileName || source.originalFile.cloudinarySecureUrl));
    const hasAllowedCopyright = isContribution || isUploadedPdf || source.copyrightStatus === 'copyrighted_with_open_access' || source.copyrightStatus === 'public_domain' || source.allowedUse === 'open_access_fulltext';
    if (!hasAllowedCopyright) {
      res.status(400).json({ success: false, message: 'Tài liệu không có bản quyền thích hợp để nhập.' });
      return;
    }

    const statusVal = source.fullTextStatus;
    if (statusVal !== 'none' && statusVal !== 'available' && statusVal !== 'failed' && statusVal !== 'imported') {
      res.status(400).json({ success: false, message: 'Trạng thái tài liệu hiện tại không hỗ trợ nhập bản đọc.' });
      return;
    }

    const result = await importFullTextInternal(source, moderatorId);
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(422).json(result);
    }
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra trong quá trình nhập bản đọc.',
      error: err.message || err
    });
  }
};

/**
 * POST /api/moderation/sources/:id/build-chunks
 * Builds RAG chunks from fulltext sections and generates embeddings using the local Ollama service.
 * Access: Moderator only
 */
export const buildChunks = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const moderatorId = req.user?._id;

  if (!moderatorId) {
    res.status(401).json({ success: false, message: 'Unauthorized. User session not found.' });
    return;
  }

  try {
    const cleanId = id as string;
    if (!cleanId || !mongoose.Types.ObjectId.isValid(cleanId)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    let source = await AcademicSource.findById(cleanId);
    let isContribution = false;
    if (!source) {
      source = await SourceContribution.findById(cleanId);
      if (source) {
        isContribution = true;
      }
    }

    if (!source) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    // Eligibility Check
    if (source.allowedUse !== 'open_access_fulltext') {
      res.status(400).json({ success: false, message: 'Tài liệu không hỗ trợ RAG (Metadata only).' });
      return;
    }

    const statusVal = source.fullTextStatus;
    const isReadable = source.readableInApp;
    if (statusVal !== 'imported' || !isReadable) {
      res.status(400).json({ success: false, message: 'Tài liệu chưa được nhập bản đọc đầy đủ.' });
      return;
    }

    const fullText = isContribution
      ? await AcademicDocument.findOne({ previewContributionId: source._id })
      : await AcademicDocument.findOne({ sourceId: source._id });

    if (!fullText) {
      res.status(400).json({ success: false, message: 'Không tìm thấy thông tin bản đọc đầy đủ.' });
      return;
    }

    // Set build status to building first on AcademicSource only
    if (!isContribution) {
      source.chunkBuildStatus = 'building';
      await source.save();
    }

    interface TempChunk {
      text: string;
      sectionType: 'title' | 'abstract' | 'heading' | 'paragraph' | 'list_item' | 'reference_item' | 'caption' | 'metadata' | 'unknown' | 'figure' | 'table' | 'page_break' | 'reference';
      sectionTitle?: string;
      pageStart?: number;
      pageEnd?: number;
      academicFullTextSectionId: mongoose.Types.ObjectId;
    }

    let tempChunks: TempChunk[] = [];

    try {
      // 1. Fetch sections and sort them by sectionIds array
      const sectionIds = fullText.sectionIds || [];
      const rawSections = await AcademicSection.find({ documentId: fullText._id });
      const sections = sectionIds.map(sid => 
        rawSections.find(s => s._id.toString() === sid.toString())
      ).filter(Boolean);

      if (sections.length === 0) {
        throw new Error('Tài liệu không chứa phân đoạn văn bản nào.');
      }

      // 2. Filter sections: Skip metadata and reference_item completely from body evidence
      const eligibleSections = sections.filter(
        sec => sec.sectionType !== 'metadata' && sec.sectionType !== 'reference_item'
      );
      if (eligibleSections.length === 0) {
        throw new Error('Tài liệu không chứa phân đoạn hợp lệ để xây dựng dữ liệu RAG.');
      }

      let currentHeadingText = '';
      let accumulatedSections: any[] = [];
      let accumulatedWordCount = 0;

      const flushAccumulated = () => {
        if (accumulatedSections.length === 0) return;

        const joinedText = accumulatedSections.map(s => s.text).join('\n\n');
        let chunkText = joinedText;
        if (currentHeadingText) {
          chunkText = `[Heading: ${currentHeadingText}]\n\n${joinedText}`;
        }

        // Safe limit guard on chunk size characters
        if (chunkText.length > 8000) {
          chunkText = chunkText.substring(0, 8000);
        }

        const wordCount = chunkText.split(/\s+/).filter(Boolean).length;
        const isAbstract = accumulatedSections.some(s => s.sectionType === 'abstract');

        // minChunkWords: 80 words (or 10 words if it is abstract)
        // minChunkWords: 40 words (or 10 words if it is abstract)
        if (wordCount >= 40 || (isAbstract && wordCount >= 10)) {
          const pageStart = accumulatedSections.reduce(
            (min, s) => (s.pageStart !== undefined ? Math.min(min, s.pageStart) : min),
            Infinity
          );
          const pageEnd = accumulatedSections.reduce(
            (max, s) => (s.pageEnd !== undefined ? Math.max(max, s.pageEnd) : max),
            -Infinity
          );

          tempChunks.push({
            text: chunkText,
            sectionType: (isAbstract ? 'abstract' : accumulatedSections[0].sectionType) || 'paragraph',
            sectionTitle: currentHeadingText || undefined,
            pageStart: pageStart === Infinity ? undefined : pageStart,
            pageEnd: pageEnd === -Infinity ? undefined : pageEnd,
            academicFullTextSectionId: accumulatedSections[0]._id,
          });
        }

        accumulatedSections = [];
        accumulatedWordCount = 0;
      };

      for (const sec of eligibleSections) {
        if (sec.sectionType === 'heading') {
          // Respect heading boundary by flushing
          flushAccumulated();
          currentHeadingText = sec.text;
        } else {
          const secWords = sec.text.split(/\s+/).filter(Boolean).length;

          if (secWords > 1200) {
            // Large section: Flush accumulated first, then split into smaller sub-chunks
            flushAccumulated();

            const words = sec.text.split(/\s+/).filter(Boolean);
            let startIdx = 0;
            while (startIdx < words.length) {
              let endIdx = startIdx + 1000;
              if (endIdx > words.length) endIdx = words.length;

              const subText = words.slice(startIdx, endIdx).join(' ');
              let chunkText = subText;
              if (currentHeadingText) {
                chunkText = `[Heading: ${currentHeadingText}]\n\n${subText}`;
              }
              if (chunkText.length > 8000) {
                chunkText = chunkText.substring(0, 8000);
              }

              const subWordCount = chunkText.split(/\s+/).filter(Boolean).length;
              if (subWordCount >= 80) {
                tempChunks.push({
                  text: chunkText,
                  sectionType: sec.sectionType || 'paragraph',
                  sectionTitle: currentHeadingText || undefined,
                  pageStart: sec.pageStart,
                  pageEnd: sec.pageEnd,
                  academicFullTextSectionId: sec._id,
                });
              }

              if (endIdx === words.length) break;
              startIdx += 850; // 150-word overlap
            }
          } else {
            // Normal section
            if (accumulatedWordCount + secWords > 1200) {
              flushAccumulated();
            }
            accumulatedSections.push(sec);
            accumulatedWordCount += secWords;
          }
        }
      }

      // Flush remainder
      flushAccumulated();

      // Fallback: If no chunks were created but there is valid content, create a fallback chunk
      if (tempChunks.length === 0) {
        const allContentText = eligibleSections
          .filter(s => s.sectionType !== 'heading')
          .map(s => s.text)
          .join('\n\n');
        if (allContentText.trim().length > 0) {
          const firstSec = eligibleSections.find(s => s.sectionType !== 'heading') || eligibleSections[0];
          tempChunks.push({
            text: allContentText.substring(0, 8000),
            sectionType: firstSec.sectionType || 'paragraph',
            pageStart: firstSec.pageStart,
            pageEnd: firstSec.pageEnd,
            academicFullTextSectionId: firstSec._id,
          });
        }
      }

      // Enforce max chunks limit guard (300 chunks)
      if (tempChunks.length > 300) {
        throw new Error('Tài liệu quá dài để xây dựng dữ liệu RAG trong phiên bản hiện tại.');
      }

      if (tempChunks.length === 0) {
        throw new Error('Không có nội dung văn bản hợp lệ để xây dựng dữ liệu RAG.');
      }

      // 3. Sequential Embedding Generation
      const embedModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
      const finalChunks: any[] = [];
      const sectionChunkCount = new Map<string, number>();
      const chunkIdsBySection = new Map<string, mongoose.Types.ObjectId[]>();

      for (let i = 0; i < tempChunks.length; i++) {
        const tc = tempChunks[i];
        
        // Generate embedding via existing helper
        const embedding = await generateEmbedding(tc.text);
        if (!embedding || !Array.isArray(embedding) || embedding.length !== 768) {
          throw new Error('Định dạng embedding không hợp lệ từ dịch vụ Ollama.');
        }

        const wordCount = tc.text.split(/\s+/).filter(Boolean).length;
        const secIdStr = tc.academicFullTextSectionId.toString();
        const currentSecOrder = sectionChunkCount.get(secIdStr) || 0;
        sectionChunkCount.set(secIdStr, currentSecOrder + 1);

        const chunkId = new mongoose.Types.ObjectId();
        if (!chunkIdsBySection.has(secIdStr)) {
          chunkIdsBySection.set(secIdStr, []);
        }
        chunkIdsBySection.get(secIdStr)!.push(chunkId);

        finalChunks.push({
          _id: chunkId,
          sourceId: isContribution ? undefined : source._id,
          previewContributionId: isContribution ? source._id : undefined,
          chunkPurpose: 'rag',
          documentId: fullText._id,
          sectionId: tc.academicFullTextSectionId,
          sectionOrder: currentSecOrder,
          chunkOrder: i,
          text: tc.text,
          embedding: embedding,
          tokenCount: Math.round(wordCount * 1.3),
          // legacy compatibility fields:
          academicSourceId: isContribution ? undefined : source._id,
          academicFullTextId: fullText._id,
          academicFullTextSectionId: tc.academicFullTextSectionId,
          chunkIndex: i,
          chunkText: tc.text,
          sectionType: tc.sectionType,
          sectionTitle: tc.sectionTitle,
          pageStart: tc.pageStart,
          pageEnd: tc.pageEnd,
          embeddingModel: embedModel,
          characterCount: tc.text.length,
          wordCount: wordCount,
          tokenEstimate: Math.round(wordCount * 1.3),
          sourceOrder: i,
        });
      }

      // 4. Database atomic swap: Delete old, insert new
      if (isContribution) {
        await AcademicChunk.deleteMany({ previewContributionId: source._id, chunkPurpose: 'rag' });
      } else {
        await AcademicChunk.deleteMany({ sourceId: source._id, chunkPurpose: 'rag' });
      }
      
      if (finalChunks.length > 0) {
        await AcademicChunk.insertMany(finalChunks);
      }

      // 5. Update status
      if (!isContribution) {
        source.chunkBuildStatus = 'completed';
        source.chunkBuiltAt = new Date();
        source.chunkEmbeddingModel = embedModel;
        source.chunkCount = finalChunks.length;
        source.chunkBuildError = undefined;
        await source.save();
      }

      res.status(200).json({
        success: true,
        message: 'Xây dựng dữ liệu RAG thành công.',
        data: {
          chunkCount: finalChunks.length,
          embeddingModel: embedModel,
        },
      });

    } catch (innerErr: any) {
      console.error('Error during RAG build inner process:', innerErr);

      // Sanitize chunkBuildError (no raw stack traces, no internal URLs)
      let cleanMessage = 'Không thể tạo embedding. Vui lòng kiểm tra Ollama và model embedding.';
      const allowedMessages = [
        'Tài liệu quá dài để xây dựng dữ liệu RAG trong phiên bản hiện tại.',
        'Tài liệu không chứa phân đoạn văn bản nào.',
        'Tài liệu không chứa phân đoạn hợp lệ để xây dựng dữ liệu RAG.',
        'Không có nội dung văn bản hợp lệ để xây dựng dữ liệu RAG.',
      ];
      if (allowedMessages.includes(innerErr.message)) {
        cleanMessage = innerErr.message;
      }

      source.chunkBuildStatus = 'failed';
      source.chunkBuildError = cleanMessage;
      await source.save();

      res.status(500).json({
        success: false,
        message: cleanMessage,
      });
    }

  } catch (outerErr: any) {
    console.error('Fatal outer buildChunks controller error:', outerErr);
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi bắt đầu xây dựng dữ liệu RAG.',
    });
  }
};

/**
 * GET /api/moderation/rule-candidates
 * Lấy danh sách quy luật ứng viên (hỗ trợ lọc status và academicSourceId).
 * Access: Moderator only
 */
export const getRuleCandidates = async (req: Request, res: Response): Promise<void> => {
  const { academicSourceId, status } = req.query;
  try {
    const filter: any = {};
    if (status) {
      filter.status = String(status);
    }
    if (academicSourceId) {
      if (!mongoose.Types.ObjectId.isValid(String(academicSourceId))) {
        res.status(400).json({ success: false, message: 'academicSourceId không hợp lệ.' });
        return;
      }
      filter.academicSourceId = new mongoose.Types.ObjectId(String(academicSourceId));
    }

    const candidates = await PendingKnowledgeRule.find(filter)
      .select('_id ruleStatement classifications scientificBasis status mergeRuleId createdAt')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: candidates,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi lấy danh sách quy luật ứng viên.',
      error: err.message,
    });
  }
};

function extractKeywords(texts: string[]): Set<string> {
  const stopwords = new Set([
    'the', 'and', 'that', 'for', 'with', 'from', 'this', 'have', 'been', 'were', 'was', 'are', 'about', 'their', 'they', 'them',
    'của', 'và', 'cho', 'với', 'trong', 'những', 'một', 'này', 'được', 'các', 'như', 'bởi', 'tại', 'trên', 'dưới'
  ]);
  const keywords = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    const words = text.toLowerCase()
      .replace(/[^a-z0-9áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]/g, ' ')
      .split(/\s+/);
    for (const word of words) {
      if (word.length > 3 && !stopwords.has(word)) {
        keywords.add(word);
      }
    }
  }
  return keywords;
}

export const getRuleCandidateDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật ứng viên này.' });
      return;
    }

    const candidate = await PendingKnowledgeRule.findById(id);
    if (!candidate) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật ứng viên này.' });
      return;
    }

    const chunks = await AcademicChunk.find({
      _id: { $in: candidate.evidenceChunkIds }
    });

    const evidenceChunks = chunks.map(chunk => {
      const previewText = (chunk.text || '').substring(0, 2000);
      return {
        chunkId: chunk._id,
        sectionTitle: chunk.sectionTitle,
        sectionType: chunk.sectionType,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        chunkPreview: previewText
      };
    });

    const keywords = extractKeywords([
      candidate.ruleStatement,
      candidate.scientificBasis
    ]);

    const evidenceExcerpts: any[] = [];
    outerLoop:
    for (const chunk of chunks) {
      const excerpts = extractExcerptsFromChunk(chunk.text || '', keywords);
      for (const excerpt of excerpts) {
        if (evidenceExcerpts.length >= 3) {
          break outerLoop;
        }
        evidenceExcerpts.push({
          chunkId: chunk._id,
          excerpt,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          sectionTitle: chunk.sectionTitle,
          sectionType: chunk.sectionType
        });
      }
    }

    const candidateData = candidate.toObject();

    res.status(200).json({
      success: true,
      data: {
        candidate: candidateData,
        evidenceChunks,
        evidenceExcerpts
      }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi lấy chi tiết quy luật ứng viên.',
      error: err.message
    });
  }
};

export const updateRuleCandidate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật ứng viên này.' });
      return;
    }

    const candidate = await PendingKnowledgeRule.findById(id);
    if (!candidate) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật ứng viên này.' });
      return;
    }

    if (candidate.status === 'rejected') {
      res.status(400).json({ success: false, message: 'Không thể chỉnh sửa quy luật ứng viên đã bị từ chối.' });
      return;
    }

    const allowedFields = [
      'ruleStatement',
      'classifications',
      'scientificBasis',
      'status',
      'mergeRuleId'
    ];

    const updates = req.body;
    const errors: string[] = [];

    const requiredTextFields = [
      'ruleStatement',
      'scientificBasis'
    ];

    for (const f of requiredTextFields) {
      if (updates[f] !== undefined && (typeof updates[f] !== 'string' || String(updates[f]).trim() === '')) {
        errors.push(`${f} không được để trống.`);
      }
    }

    if (errors.length > 0) {
      res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ.', errors });
      return;
    }

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        (candidate as any)[key] = updates[key];
      }
    }

    await candidate.save();
    res.status(200).json({ success: true, data: candidate });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi chỉnh sửa quy luật ứng viên.',
      error: err.message
    });
  }
};

export const approveRuleCandidate = async (req: Request, res: Response): Promise<void> => {
  let createdRuleId: string | null = null;
  let createdLinkId: mongoose.Types.ObjectId | null = null;

  try {
    const id = String(req.params.id);
    const moderatorUserId = req.user?._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật ứng viên này.' });
      return;
    }

    const candidate = await PendingKnowledgeRule.findById(id);
    if (!candidate) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật ứng viên này.' });
      return;
    }

    if (candidate.status === 'rejected') {
      res.status(400).json({ success: false, message: 'Không thể duyệt quy luật ứng viên đã bị từ chối.' });
      return;
    }

    const chunkIds = candidate.evidenceChunkIds || [];
    if (chunkIds.length < 1) {
      res.status(400).json({ success: false, message: 'Ứng viên phải liên kết với ít nhất một phân đoạn minh chứng.' });
      return;
    }

    const chunks = await AcademicChunk.find({ _id: { $in: chunkIds } });
    if (chunks.length !== chunkIds.length) {
      res.status(400).json({ success: false, message: 'Một hoặc nhiều phân đoạn minh chứng không tồn tại.' });
      return;
    }

    try {
      let finalRuleId: mongoose.Types.ObjectId;

      if (candidate.mergeRuleId) {
        const existingRule = await VerifiedKnowledgeRule.findById(candidate.mergeRuleId);
        if (!existingRule) {
          throw new Error('Quy luật muốn hợp nhất không tồn tại.');
        }
        finalRuleId = existingRule._id;
      } else {
        let embedding: number[] | undefined = undefined;
        try {
          embedding = await generateEmbedding(candidate.ruleStatement);
        } catch (embErr) {
          console.error('Failed to generate embedding for rule statement:', embErr);
        }

        const liveRule = new VerifiedKnowledgeRule({
          ruleStatement: candidate.ruleStatement.trim(),
          classifications: candidate.classifications,
          scientificBasis: candidate.scientificBasis.trim(),
          embedding,
          usageStatistics: {
            timesRetrieved: 0,
            timesApplied: 0,
            positiveFeedback: 0,
            negativeFeedback: 0,
            confirmationRate: 0
          },
          lastEvidenceUpdatedAt: new Date(),
          version: 1,
          createdBy: moderatorUserId,
          createdFromExtractionRunId: chunks[0]?.sourceId || new mongoose.Types.ObjectId()
        });

        await liveRule.save();
        finalRuleId = liveRule._id;
        createdRuleId = liveRule._id.toString();
      }

      const ruleSourceLink = new KnowledgeRuleEvidence({
        ruleId: finalRuleId,
        chunkId: chunks[0]._id,
        quote: chunks[0].text || '',
        evidenceSummary: 'Bằng chứng trích xuất từ tài liệu học thuật.',
        confidence: 1.0,
        extractionRunId: chunks[0]?.sourceId || new mongoose.Types.ObjectId()
      });
      await ruleSourceLink.save();
      createdLinkId = ruleSourceLink._id;

      await VerifiedKnowledgeRule.updateOne(
        { _id: finalRuleId },
        { $addToSet: { evidenceIds: ruleSourceLink._id } }
      );

      await PendingKnowledgeRule.deleteOne({ _id: candidate._id });

      res.status(200).json({
        success: true,
        message: 'Duyệt và đồng bộ hóa quy luật thành công.',
        data: {
          ruleId: finalRuleId,
          evidenceId: ruleSourceLink._id
        }
      });

    } catch (innerErr: any) {
      console.error('Approval transaction write failed:', innerErr);
      if (createdLinkId) {
        try {
          await KnowledgeRuleEvidence.deleteOne({ _id: createdLinkId });
        } catch (cleanupErr) {
          console.error('Failed to rollback evidence link:', cleanupErr);
        }
      }
      if (createdRuleId) {
        try {
          await VerifiedKnowledgeRule.deleteOne({ _id: createdRuleId });
        } catch (cleanupErr) {
          console.error('Failed to rollback rule:', cleanupErr);
        }
      }
      throw innerErr;
    }

  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi duyệt quy luật ứng viên.',
      error: err.message
    });
  }
};

export const rejectRuleCandidate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const moderatorUserId = req.user?._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật ứng viên này.' });
      return;
    }

    const candidate = await PendingKnowledgeRule.findById(id);
    if (!candidate) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật ứng viên này.' });
      return;
    }

    if (candidate.status === 'rejected') {
      res.status(200).json({
        success: true,
        message: 'Quy luật ứng viên đã được từ chối trước đó.',
        data: candidate
      });
      return;
    }

    candidate.status = 'rejected';
    await candidate.save();

    res.status(200).json({
      success: true,
      message: 'Từ chối quy luật ứng viên thành công.',
      data: candidate
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi từ chối quy luật ứng viên.',
      error: err.message
    });
  }
};

export const analyzeRules = async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const moderatorUserId = String(req.user!._id);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({
      success: false,
      message: 'Không tìm thấy tài liệu này.',
    });
    return;
  }

  try {
    const source = await AcademicSource.findById(new mongoose.Types.ObjectId(id));
    if (!source) {
      res.status(404).json({
        success: false,
        message: 'Không tìm thấy tài liệu này.',
      });
      return;
    }

    if (source.allowedUse !== 'open_access_fulltext') {
      res.status(400).json({
        success: false,
        message: 'Tài liệu không hỗ trợ trích xuất quy luật (Metadata only).',
      });
      return;
    }

    if (source.fullTextStatus !== 'imported' || !source.readableInApp) {
      res.status(400).json({
        success: false,
        message: 'Tài liệu chưa được nhập bản đọc đầy đủ.',
      });
      return;
    }

    // Check if approved candidates already exist for the source
    const existsApproved = await PendingKnowledgeRule.find({
      academicSourceId: source._id,
      status: 'approved'
    });

    if (existsApproved.length > 0) {
      res.status(200).json({
        success: true,
        outcome: 'success_with_existing_candidates',
        createdCount: 0,
        updatedCandidateCount: 0,
        reusedCandidateCount: existsApproved.length,
        reasonCode: 'existing_candidates_reused',
        message: 'Không tạo bản mới vì các ứng viên tương tự đã tồn tại. Đã mở danh sách hiện có.',
        sourceId: id,
        preparedRAG: false,
        chunkBuildStatus: source.chunkBuildStatus,
        extractionStatus: 'skipped',
        existingCount: existsApproved.length,
        candidateIds: existsApproved.map(c => c._id.toString()),
        data: {
          createdCount: 0,
          skippedCount: 0,
          candidateIds: existsApproved.map(c => c._id.toString()),
          validationErrors: [],
          alreadyApproved: true,
          preparedRAG: false,
          chunkBuildStatus: source.chunkBuildStatus,
          extractionStatus: 'skipped',
          existingCount: existsApproved.length,
          sourceId: id
        }
      });
      return;
    }

    // Check if pending/needs_edit candidates already exist for the source
    const existsPending = await PendingKnowledgeRule.find({
      academicSourceId: source._id,
      status: { $in: ['pending', 'needs_edit'] }
    });

    if (existsPending.length > 0) {
      res.status(200).json({
        success: true,
        outcome: 'success_with_existing_candidates',
        createdCount: 0,
        updatedCandidateCount: existsPending.length,
        reusedCandidateCount: 0,
        reasonCode: 'existing_candidates_updated',
        message: 'Không tạo bản mới vì các ứng viên tương tự đã tồn tại. Đã mở danh sách hiện có.',
        sourceId: id,
        preparedRAG: false,
        chunkBuildStatus: source.chunkBuildStatus,
        extractionStatus: 'skipped',
        existingCount: existsPending.length,
        candidateIds: existsPending.map(c => c._id.toString()),
        data: {
          createdCount: 0,
          skippedCount: 0,
          candidateIds: existsPending.map(c => c._id.toString()),
          validationErrors: [],
          alreadyExists: true,
          preparedRAG: false,
          chunkBuildStatus: source.chunkBuildStatus,
          extractionStatus: 'skipped',
          existingCount: existsPending.length,
          sourceId: id
        }
      });
      return;
    }



    // Guard concurrent extraction/analysis
    if (activeExtractions.has(id)) {
      res.status(200).json({
        success: true,
        message: 'Quá trình phân tích đang được thực hiện.',
        data: {
          isAnalyzing: true,
          candidateIds: []
        }
      });
      return;
    }

    activeExtractions.add(id);

    // Run chunking and extraction sequentially
    try {
      const fullText = await AcademicDocument.findOne({ sourceId: source._id });
      if (!fullText) {
        throw new Error('Không tìm thấy thông tin bản đọc đầy đủ.');
      }

      let didPrepareRAG = false;
      // Check if we need to build chunks
      if (source.chunkBuildStatus !== 'completed' || !source.chunkCount || source.chunkCount <= 0) {
        didPrepareRAG = true;
        source.chunkBuildStatus = 'building';
        await source.save();

        interface TempChunk {
          text: string;
          sectionType: 'title' | 'abstract' | 'heading' | 'paragraph' | 'list_item' | 'reference_item' | 'caption' | 'metadata' | 'unknown' | 'figure' | 'table' | 'page_break' | 'reference';
          sectionTitle?: string;
          pageStart?: number;
          pageEnd?: number;
          academicFullTextSectionId: mongoose.Types.ObjectId;
        }

        let tempChunks: TempChunk[] = [];
        const sections = await AcademicSection.find({ documentId: fullText._id }).sort({ sectionIndex: 1 });
        if (sections.length === 0) {
          throw new Error('Tài liệu không chứa phân đoạn văn bản nào.');
        }

        const eligibleSections = sections.filter(
          sec => sec.sectionType !== 'metadata' && sec.sectionType !== 'reference_item'
        );
        if (eligibleSections.length === 0) {
          throw new Error('Tài liệu không chứa phân đoạn hợp lệ để xây dựng dữ liệu RAG.');
        }

        let currentHeadingText = '';
        let accumulatedSections: any[] = [];
        let accumulatedWordCount = 0;

        const flushAccumulated = () => {
          if (accumulatedSections.length === 0) return;

          const joinedText = accumulatedSections.map(s => s.text).join('\n\n');
          let chunkText = joinedText;
          if (currentHeadingText) {
            chunkText = `[Heading: ${currentHeadingText}]\n\n${joinedText}`;
          }

          // Safe limit guard on chunk size characters
          if (chunkText.length > 8000) {
            chunkText = chunkText.substring(0, 8000);
          }

          const wordCount = chunkText.split(/\s+/).filter(Boolean).length;
          const isAbstract = accumulatedSections.some(s => s.sectionType === 'abstract');

          // minChunkWords: 40 words (or 10 words if it is abstract)
          if (wordCount >= 40 || (isAbstract && wordCount >= 10)) {
            const pageStart = accumulatedSections.reduce(
              (min, s) => (s.pageStart !== undefined ? Math.min(min, s.pageStart) : min),
              Infinity
            );
            const pageEnd = accumulatedSections.reduce(
              (max, s) => (s.pageEnd !== undefined ? Math.max(max, s.pageEnd) : max),
              -Infinity
            );

            tempChunks.push({
              text: chunkText,
              sectionType: (isAbstract ? 'abstract' : accumulatedSections[0].sectionType) || 'paragraph',
              sectionTitle: currentHeadingText || undefined,
              pageStart: pageStart === Infinity ? undefined : pageStart,
              pageEnd: pageEnd === -Infinity ? undefined : pageEnd,
              academicFullTextSectionId: accumulatedSections[0]._id,
            });
          }

          accumulatedSections = [];
          accumulatedWordCount = 0;
        };

        for (const sec of eligibleSections) {
          if (sec.sectionType === 'heading') {
            // Respect heading boundary by flushing
            flushAccumulated();
            currentHeadingText = sec.text;
          } else {
            const secWords = sec.text.split(/\s+/).filter(Boolean).length;

            if (secWords > 1200) {
              // Large section: Flush accumulated first, then split into smaller sub-chunks
              flushAccumulated();

              const words = sec.text.split(/\s+/).filter(Boolean);
              let startIdx = 0;
              while (startIdx < words.length) {
                let endIdx = startIdx + 1000;
                if (endIdx > words.length) endIdx = words.length;

                const subText = words.slice(startIdx, endIdx).join(' ');
                let chunkText = subText;
                if (currentHeadingText) {
                  chunkText = `[Heading: ${currentHeadingText}]\n\n${subText}`;
                }
                if (chunkText.length > 8000) {
                  chunkText = chunkText.substring(0, 8000);
                }

                const subWordCount = chunkText.split(/\s+/).filter(Boolean).length;
                if (subWordCount >= 80) {
                  tempChunks.push({
                    text: chunkText,
                    sectionType: sec.sectionType || 'paragraph',
                    sectionTitle: currentHeadingText || undefined,
                    pageStart: sec.pageStart,
                    pageEnd: sec.pageEnd,
                    academicFullTextSectionId: sec._id,
                  });
                }

                if (endIdx === words.length) break;
                startIdx += 850; // 150-word overlap
              }
            } else {
              // Normal section
              if (accumulatedWordCount + secWords > 1200) {
                flushAccumulated();
              }
              accumulatedSections.push(sec);
              accumulatedWordCount += secWords;
            }
          }
        }

        // Flush remainder
        flushAccumulated();

        // Fallback: If no chunks were created but there is valid content, create a fallback chunk
        if (tempChunks.length === 0) {
          const allContentText = eligibleSections
            .filter(s => s.sectionType !== 'heading')
            .map(s => s.text)
            .join('\n\n');
          if (allContentText.trim().length > 0) {
            const firstSec = eligibleSections.find(s => s.sectionType !== 'heading') || eligibleSections[0];
            tempChunks.push({
              text: allContentText.substring(0, 8000),
              sectionType: firstSec.sectionType || 'paragraph',
              pageStart: firstSec.pageStart,
              pageEnd: firstSec.pageEnd,
              academicFullTextSectionId: firstSec._id,
            });
          }
        }

        if (tempChunks.length > 300) {
          throw new Error('Tài liệu quá dài để xây dựng dữ liệu RAG trong phiên bản hiện tại.');
        }

        if (tempChunks.length === 0) {
          throw new Error('Không có nội dung văn bản hợp lệ để xây dựng dữ liệu RAG.');
        }

        const embedModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
        const finalChunks: any[] = [];
        const sectionChunkCount = new Map<string, number>();
        const chunkIdsBySection = new Map<string, mongoose.Types.ObjectId[]>();

        for (let i = 0; i < tempChunks.length; i++) {
          const tc = tempChunks[i];
          const embedding = await generateEmbedding(tc.text);
          if (!embedding || !Array.isArray(embedding) || embedding.length !== 768) {
            throw new Error('Định dạng embedding không hợp lệ từ dịch vụ Ollama.');
          }

          const wordCount = tc.text.split(/\s+/).filter(Boolean).length;
          const secIdStr = tc.academicFullTextSectionId.toString();
          const currentSecOrder = sectionChunkCount.get(secIdStr) || 0;
          sectionChunkCount.set(secIdStr, currentSecOrder + 1);

          const chunkId = new mongoose.Types.ObjectId();
          if (!chunkIdsBySection.has(secIdStr)) {
            chunkIdsBySection.set(secIdStr, []);
          }
          chunkIdsBySection.get(secIdStr)!.push(chunkId);

          finalChunks.push({
            _id: chunkId,
            sourceId: source._id,
            documentId: fullText._id,
            sectionId: tc.academicFullTextSectionId,
            sectionOrder: currentSecOrder,
            chunkOrder: i,
            text: tc.text,
            embedding: embedding,
            tokenCount: Math.round(wordCount * 1.3),
            // legacy compatibility fields:
            academicSourceId: source._id,
            academicFullTextId: fullText._id,
            academicFullTextSectionId: tc.academicFullTextSectionId,
            chunkIndex: i,
            chunkText: tc.text,
            sectionType: tc.sectionType,
            sectionTitle: tc.sectionTitle,
            pageStart: tc.pageStart,
            pageEnd: tc.pageEnd,
            embeddingModel: embedModel,
            characterCount: tc.text.length,
            wordCount: wordCount,
            tokenEstimate: Math.round(wordCount * 1.3),
            sourceOrder: i,
          });
        }

        await AcademicChunk.deleteMany({ sourceId: source._id, chunkPurpose: 'rag' });
        await AcademicChunk.insertMany(finalChunks);

        // Update chunkIds in AcademicSection
        for (const [secIdStr, chunkIds] of chunkIdsBySection.entries()) {
          await AcademicSection.updateOne(
            { _id: new mongoose.Types.ObjectId(secIdStr) },
            { $set: { chunkIds: chunkIds } }
          );
        }

        source.chunkBuildStatus = 'completed';
        source.chunkBuiltAt = new Date();
        source.chunkEmbeddingModel = embedModel;
        source.chunkCount = finalChunks.length;
        source.chunkBuildError = undefined;
        await source.save();
      }

      // Run Candidate Extraction
      const result = await extractRuleCandidatesFromSource(id, moderatorUserId);
      const existingCount = existsPending.length + existsApproved.length + (result?.skippedCount || 0);

      let outcome = 'stopped_domain_irrelevant';
      if (result.createdCount > 0) {
        outcome = 'success_with_new_candidates';
      } else {
        const code = result.reasonCode;
        if (code === 'existing_candidates_reused' || code === 'existing_candidates_updated') {
          outcome = 'success_with_existing_candidates';
        } else if (code === 'domain_irrelevant' || code === 'all_candidates_irrelevant') {
          outcome = 'stopped_domain_irrelevant';
        } else if (code === 'no_eligible_chunks') {
          outcome = 'stopped_no_eligible_chunks';
        } else if (code === 'llm_returned_zero_candidates') {
          outcome = 'stopped_llm_returned_zero';
        } else if (code === 'candidate_evidence_mapping_failed') {
          outcome = 'stopped_evidence_mapping_failed';
        } else if (code === 'all_candidates_weak_evidence' || code === 'all_candidates_no_evidence' || code === 'all_candidates_filtered_or_invalid') {
          outcome = 'stopped_all_weak_evidence';
        } else if (code === 'all_candidates_duplicate') {
          outcome = 'stopped_all_duplicate';
        } else {
          outcome = 'stopped_all_duplicate';
        }
      }

      res.status(200).json({
        success: true,
        outcome,
        createdCount: result.createdCount,
        updatedCandidateCount: result.diagnostics?.updatedCandidateCount || 0,
        reusedCandidateCount: result.diagnostics?.reusedCandidateCount || 0,
        reasonCode: result.reasonCode || 'no_new_candidates_created',
        message: result.message || 'Phân tích hoàn tất nhưng không có quy luật mới được lưu.',
        sourceId: id,
        preparedRAG: didPrepareRAG || (source.chunkBuildStatus === 'completed'),
        chunkBuildStatus: source.chunkBuildStatus,
        extractionStatus: 'completed',
        existingCount,
        candidateIds: result.candidateIds || [],
        diagnostics: result.diagnostics,
        data: {
          createdCount: result.createdCount,
          skippedCount: result.skippedCount,
          candidateIds: result.candidateIds || [],
          validationErrors: result.validationErrors || [],
          alreadyExists: false,
          preparedRAG: didPrepareRAG || (source.chunkBuildStatus === 'completed'),
          chunkBuildStatus: source.chunkBuildStatus,
          extractionStatus: 'completed',
          existingCount,
          sourceId: id
        }
      });
    } catch (innerErr: any) {
      console.error('Unified analysis failed inner step:', innerErr);
      if (source && source.chunkBuildStatus === 'building') {
        try {
          source.chunkBuildStatus = 'failed';
          source.chunkBuildError = innerErr.message || String(innerErr);
          await source.save();
        } catch (saveErr) {
          console.error('Failed to update source status on error:', saveErr);
        }
      }
      const sanitized = sanitizeError(innerErr);
      res.status(500).json({
        success: false,
        message: 'Lỗi xảy ra trong quá trình phân tích và trích xuất quy luật.',
        error: sanitized
      });
    } finally {
      activeExtractions.delete(id);
    }
  } catch (outerErr: any) {
    console.error('Fatal unified analyzeRules error:', outerErr);
    const sanitized = sanitizeError(outerErr);
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi bắt đầu quá trình phân tích.',
      error: sanitized
    });
  }
};

/**
 * POST /api/moderation/rules/:ruleId/deactivate
 * Vô hiệu hóa quy luật đã duyệt.
 * Access: Moderator only
 */
export const deactivateRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const ruleId = String(req.params.ruleId);
    const { confirm, reason } = req.body;
    const moderatorUserId = req.user?._id;

    if (confirm !== true) {
      res.status(400).json({ success: false, message: 'Yêu cầu xác nhận từ chối/vô hiệu hóa quy luật.' });
      return;
    }

    const rule = await VerifiedKnowledgeRule.findById(ruleId);
    if (!rule) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật này.' });
      return;
    }

    if (rule.origin !== 'source_generated') {
      res.status(403).json({ success: false, message: 'Chỉ cho phép vô hiệu hóa quy luật được trích xuất từ tài liệu học thuật.' });
      return;
    }

    rule.isActive = false;
    rule.deactivatedAt = new Date();
    rule.deactivatedBy = moderatorUserId;
    rule.deactivationReason = reason || 'Vô hiệu hóa bởi điều phối viên.';
    await rule.save();

    await KnowledgeRuleEvidence.updateMany({ ruleId: rule._id }, { $set: { status: 'inactive' } });

    await PendingKnowledgeRule.updateMany(
      { proposedRuleId: rule._id },
      {
        $set: {
          status: 'rejected',
          reviewerNote: 'Đã vô hiệu hóa sau khi từng được duyệt.'
        }
      }
    );

    res.status(200).json({
      success: true,
      message: 'Vô hiệu hóa quy luật thành công.',
      data: rule
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi vô hiệu hóa quy luật.',
      error: err.message
    });
  }
};

/**
 * POST /api/moderation/sources/:id/deactivate-rules
 * Vô hiệu hóa toàn bộ quy luật liên kết với nguồn học thuật.
 * Access: Moderator only
 */
export const deactivateSourceRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { confirmationText, reason } = req.body;
    const moderatorUserId = req.user?._id;

    if (confirmationText !== 'CONFIRM') {
      res.status(400).json({ success: false, message: 'Yêu cầu xác nhận chính xác bằng cách nhập "CONFIRM".' });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    const activeLinks = await KnowledgeRuleEvidence.find({
      sourceId: new mongoose.Types.ObjectId(id),
      status: 'active'
    });

    if (activeLinks.length === 0) {
      res.status(200).json({
        success: true,
        message: 'Không có quy luật hoạt động nào liên kết với tài liệu này.',
        deactivatedCount: 0
      });
      return;
    }

    const ruleIds = activeLinks.map(link => link.ruleId);

    // Get rules that are source_generated only
    const targetRules = await VerifiedKnowledgeRule.find({
      _id: { $in: ruleIds },
      origin: 'source_generated'
    });

    const sourceGeneratedRuleIds = targetRules.map(r => r._id);

    if (sourceGeneratedRuleIds.length === 0) {
      res.status(200).json({
        success: true,
        message: 'Tài liệu này không liên kết với bất kỳ quy luật tự động (source_generated) đang hoạt động nào.',
        deactivatedCount: 0
      });
      return;
    }

    // Deactivate Rules
    await VerifiedKnowledgeRule.updateMany(
      { _id: { $in: sourceGeneratedRuleIds } },
      {
        $set: {
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedBy: moderatorUserId,
          deactivationReason: reason || 'Vô hiệu hóa hàng loạt theo nguồn tài liệu.'
        }
      }
    );

    // Deactivate links for source_generated rules only
    await KnowledgeRuleEvidence.updateMany(
      { sourceId: new mongoose.Types.ObjectId(id), ruleId: { $in: sourceGeneratedRuleIds } },
      { $set: { status: 'inactive' } }
    );

    // Deactivate candidates for source_generated rules only
    await PendingKnowledgeRule.updateMany(
      { academicSourceId: new mongoose.Types.ObjectId(id), proposedRuleId: { $in: sourceGeneratedRuleIds } },
      {
        $set: {
          status: 'rejected',
          reviewerNote: 'Đã vô hiệu hóa hàng loạt theo nguồn tài liệu.'
        }
      }
    );

    res.status(200).json({
      success: true,
      message: `Vô hiệu hóa thành công ${sourceGeneratedRuleIds.length} quy luật từ tài liệu này.`,
      deactivatedCount: sourceGeneratedRuleIds.length
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi vô hiệu hóa quy luật theo tài liệu.',
      error: err.message
    });
  }
};

/**
 * POST /api/moderation/rule-candidates/:id/restore
 * Khôi phục ứng viên bị từ chối về trạng thái chờ duyệt.
 * Access: Moderator only
 */
export const restoreRejectedCandidate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const moderatorUserId = req.user?._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật ứng viên này.' });
      return;
    }

    const candidate = await PendingKnowledgeRule.findById(id);
    if (!candidate) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật ứng viên này.' });
      return;
    }

    if (candidate.status !== 'rejected') {
      res.status(400).json({ success: false, message: 'Chỉ có thể khôi phục ứng viên đang bị từ chối.' });
      return;
    }

    candidate.status = 'pending';
    candidate.reviewedBy = moderatorUserId;
    candidate.reviewedAt = new Date();
    candidate.reviewerNote = undefined;
    await candidate.save();

    res.status(200).json({
      success: true,
      message: 'Khôi phục quy luật ứng viên về trạng thái chờ duyệt thành công.',
      data: candidate
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi khôi phục quy luật ứng viên.',
      error: err.message
    });
  }
};

/**
 * DELETE /api/moderation/rule-candidates/:id
 * Xóa vĩnh viễn quy luật ứng viên bị từ chối.
 * Access: Moderator only
 */
export const deleteCandidate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { confirm } = req.body;

    if (confirm !== true) {
      res.status(400).json({ success: false, message: 'Yêu cầu xác nhận xóa quy luật ứng viên.' });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật ứng viên này.' });
      return;
    }

    const candidate = await PendingKnowledgeRule.findById(id);
    if (!candidate) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật ứng viên này.' });
      return;
    }

    if (candidate.status !== 'rejected') {
      res.status(400).json({ success: false, message: 'Chỉ có thể xóa quy luật ứng viên ở trạng thái bị từ chối.' });
      return;
    }

    await PendingKnowledgeRule.deleteOne({ _id: candidate._id });

    res.status(200).json({
      success: true,
      message: 'Xóa quy luật ứng viên thành công.'
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi xóa quy luật ứng viên.',
      error: err.message
    });
  }
};

/**
 * DELETE /api/moderation/rule-candidates/rejected
 * Xóa sạch tất cả các ứng viên bị từ chối.
 * Access: Moderator only
 */
export const clearAllRejectedCandidates = async (req: Request, res: Response): Promise<void> => {
  try {
    const { confirmationText } = req.body;

    if (confirmationText !== 'CONFIRM') {
      res.status(400).json({ success: false, message: 'Yêu cầu xác nhận chính xác bằng cách nhập "CONFIRM".' });
      return;
    }

    const result = await PendingKnowledgeRule.deleteMany({ status: 'rejected' });

    res.status(200).json({
      success: true,
      message: `Đã xóa sạch tất cả ${result.deletedCount} quy luật ứng viên bị từ chối.`,
      deletedCount: result.deletedCount
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi xóa sạch quy luật ứng viên bị từ chối.',
      error: err.message
    });
  }
};

/**
 * GET /api/moderation/sources/:id/analyze-progress
 * Lấy tiến trình phân tích tài liệu thực tế theo thời gian thực.
 * Access: Moderator only
 */
export const getAnalyzeProgress = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({
        success: false,
        message: 'Không tìm thấy tài liệu này.',
      });
      return;
    }

    const latestRun = await AcademicRuleExtractionRun.findOne({
      academicSourceId: new mongoose.Types.ObjectId(id)
    }).sort({ createdAt: -1 });

    if (!latestRun) {
      res.status(200).json({
        success: true,
        data: {
          status: 'none',
          currentStage: 'none',
          processedSectionGroups: 0,
          sectionGroupCount: 0,
        }
      });
      return;
    }

    // Map database fields to response
    const status = latestRun.status; // 'pending' | 'success' | 'failed'
    const currentStage = latestRun.currentStage || 'initializing';
    const processedSectionGroups = latestRun.processedSectionGroups || 0;
    const sectionGroupCount = latestRun.totalSectionGroups || latestRun.sectionGroupCount || 0;

    // Map reason and messages
    const reasonCode = latestRun.reasonCode;
    const message = latestRun.sanitizedError || '';

    // Calculate outcome if success
    let outcome = null;
    let candidateIds: string[] = [];
    if (status === 'success') {
      const candidates = await PendingKnowledgeRule.find({
        academicSourceId: latestRun.academicSourceId,
        status: { $in: ['pending', 'needs_edit'] }
      });
      candidateIds = candidates.map(c => c._id.toString());

      if (latestRun.savedCandidateCount > 0) {
        outcome = 'success_with_new_candidates';
      } else {
        if (reasonCode === 'existing_candidates_reused' || reasonCode === 'existing_candidates_updated') {
          outcome = 'success_with_existing_candidates';
        } else if (reasonCode === 'domain_irrelevant' || reasonCode === 'all_candidates_irrelevant') {
          outcome = 'stopped_domain_irrelevant';
        } else if (reasonCode === 'no_eligible_chunks') {
          outcome = 'stopped_no_eligible_chunks';
        } else if (reasonCode === 'llm_returned_zero_candidates') {
          outcome = 'stopped_llm_returned_zero';
        } else if (reasonCode === 'candidate_evidence_mapping_failed') {
          outcome = 'stopped_evidence_mapping_failed';
        } else if (reasonCode === 'all_candidates_weak_evidence' || reasonCode === 'all_candidates_filtered_or_invalid') {
          outcome = 'stopped_all_weak_evidence';
        } else if (reasonCode === 'all_candidates_duplicate') {
          outcome = 'stopped_all_duplicate';
        } else {
          outcome = 'stopped_all_duplicate';
        }
      }
    } else if (status === 'failed') {
      outcome = 'failed_system_error';
    }

    res.status(200).json({
      success: true,
      data: {
        status,
        currentStage,
        processedSectionGroups,
        sectionGroupCount,
        rawCandidateCount: latestRun.rawCandidateCount || 0,
        consolidatedCandidateCount: latestRun.consolidatedCandidateCount || 0,
        savedCandidateCount: latestRun.savedCandidateCount || 0,
        updatedCandidateCount: latestRun.updatedCandidateCount || 0,
        reusedCandidateCount: latestRun.reusedCandidateCount || 0,
        reasonCode,
        message,
        outcome,
        candidateIds
      }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi lấy tiến trình phân tích.',
      error: err.message
    });
  }
};

// ─── Phase 1: Secure Multipart PDF Upload ─────────────────────────────────────

const uploadDir = path.join(__dirname, '../../uploads/tmp');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.pdf');
  }
});

const pdfUpload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25MB limit
  }
});

/**
 * Custom wrapper middleware to intercept Multer errors (specifically LIMIT_FILE_SIZE)
 * and return user-friendly error responses.
 */
export const uploadPdfMiddleware = (req: Request, res: Response, next: any) => {
  pdfUpload.single('pdfFile')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'Kích thước tệp vượt quá giới hạn cho phép (25MB).'
        });
      }
      return res.status(400).json({
        success: false,
        message: `Lỗi upload: ${err.message}`
      });
    } else if (err) {
      return res.status(500).json({
        success: false,
        message: `Lỗi upload không xác định: ${err.message}`
      });
    }
    next();
  });
};

/**
 * POST /api/moderation/sources/upload-pdf
 * Safely processes a multipart PDF upload, uploads to Cloudinary as 'raw' resource type,
 * saves/associates the metadata with a SourceContribution, and runs safety cleanups.
 * Access: Moderator/Admin only
 */
export const uploadPdfFile = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({
      success: false,
      message: 'Không tìm thấy tệp PDF để tải lên.'
    });
    return;
  }

  const filePath = file.path;
  const originalName = file.originalname;

  try {
    const uploadResult = await processPdfUpload(filePath, originalName, file.mimetype);

    // DB Save & Prevention of Orphan Assets
    let savedContribution: any = null;
    const { sourceContributionId } = req.body;

    const originalFileData = {
      storageProvider: 'cloudinary' as const,
      originalFileName: uploadResult.original_filename,
      mimeType: 'application/pdf',
      fileSize: uploadResult.bytes,
      cloudinaryPublicId: uploadResult.public_id,
      cloudinarySecureUrl: uploadResult.secure_url,
      cloudinaryResourceType: uploadResult.resource_type as 'image' | 'raw' | 'video',
      cloudinaryFormat: uploadResult.format,
      uploadedBy: req.user?._id,
      uploadedAt: new Date(),
      fileHash: uploadResult.fileHash
    };

    try {
      if (sourceContributionId) {
        if (!mongoose.Types.ObjectId.isValid(sourceContributionId)) {
          throw new Error('ID đóng góp nguồn (sourceContributionId) không hợp lệ.');
        }

        const contribution = await SourceContribution.findById(sourceContributionId);
        if (!contribution) {
          throw new Error('Không tìm thấy đóng góp nguồn (SourceContribution) tương ứng.');
        }

        contribution.originalFile = originalFileData;
        if (!contribution.title) {
          contribution.title = uploadResult.original_filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
        }
        await contribution.save();
        savedContribution = contribution;
      } else {
        // Create new SourceContribution marked as manual staging/moderator upload
        const contribution = new SourceContribution({
          submittedBy: req.user?._id,
          reviewStatus: 'pending',
          verificationStatus: 'manual',
          allowedUse: 'open_access_fulltext',
          copyrightStatus: 'copyrighted_with_open_access',
          fullTextStatus: 'available',
          title: uploadResult.original_filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' '),
          metadata: {
            title: uploadResult.original_filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ')
          },
          originalFile: originalFileData
        });

        await contribution.save();
        savedContribution = contribution;
      }
    } catch (dbErr: any) {
      // Prevent orphan Cloudinary assets: if DB save fails, clean up the asset
      try {
        await deleteAsset(uploadResult.public_id, uploadResult.resource_type);
      } catch (cleanupErr: any) {
        console.error(`Failed to clean up Cloudinary asset ${uploadResult.public_id}:`, cleanupErr.message);
      }
      throw dbErr;
    }

    res.status(200).json({
      success: true,
      message: 'Tải lên PDF thành công.',
      data: {
        public_id: uploadResult.public_id,
        secure_url: uploadResult.secure_url,
        resource_type: uploadResult.resource_type,
        format: uploadResult.format,
        bytes: uploadResult.bytes,
        original_filename: uploadResult.original_filename,
        sourceContribution: savedContribution
      }
    });

  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || 'Lỗi khi xử lý hoặc tải lên tệp PDF.'
    });
  } finally {
    // Delete temp file after successful upload or failure
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkErr: any) {
        console.error(`Lỗi khi xóa tệp tạm: ${filePath}`, unlinkErr.message);
      }
    }
  }
};

export const deleteSource = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const moderatorId = req.user?._id;

  if (!moderatorId) {
    res.status(401).json({ success: false, message: 'Unauthorized. User session not found.' });
    return;
  }

  const cleanId = id as string;
  if (!cleanId || !mongoose.Types.ObjectId.isValid(cleanId)) {
    res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
    return;
  }

  // 1. Load AcademicSource
  let source = await AcademicSource.findById(cleanId);
  
  if (!source) {
    // Check if it is a pending SourceContribution
    const contribution = await SourceContribution.findById(cleanId);
    if (!contribution) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    const publicId = contribution.originalFile?.cloudinaryPublicId;
    const storageProvider = contribution.originalFile?.storageProvider;
    let isAssetShared = false;
    if (publicId && storageProvider === 'cloudinary') {
      const otherSourceCount = await AcademicSource.countDocuments({
        'originalFile.cloudinaryPublicId': publicId
      });
      const otherContributionCount = await SourceContribution.countDocuments({
        _id: { $ne: contribution._id },
        'originalFile.cloudinaryPublicId': publicId
      });
      if (otherSourceCount > 0 || otherContributionCount > 0) {
        isAssetShared = true;
      }
    }

    const deletedCounts = {
      contribution: 1,
      fullText: 0,
      sections: 0,
      chunks: 0,
      cloudinaryAssets: 0
    };

    const session = await mongoose.startSession();
    let useTransaction = false;
    try {
      const hello = await mongoose.connection.db?.command({ hello: 1 }).catch(() => null);
      if (hello && (hello.setName || hello.msg === 'isdbgrid')) {
        await session.startTransaction();
        useTransaction = true;
      }
    } catch {}

    try {
      const opt = useTransaction ? { session } : {};
      const sess = useTransaction ? session : null;

      const chunkIds = await AcademicChunk.find({ previewContributionId: contribution._id }).session(sess).distinct('_id');

      const doc = await AcademicDocument.findOne({ previewContributionId: contribution._id }).session(sess);
      const docId = doc ? doc._id : null;

      deletedCounts.fullText = doc ? 1 : 0;
      deletedCounts.sections = docId ? await AcademicSection.countDocuments({ documentId: docId }).session(sess) : 0;
      deletedCounts.chunks = chunkIds.length;

      if (docId) {
        await AcademicSection.deleteMany({ documentId: docId }, opt);
      }
      await AcademicDocument.deleteMany({ previewContributionId: contribution._id }, opt);
      await AcademicChunk.deleteMany({ previewContributionId: contribution._id }, opt);
      await AcademicRuleExtractionRun.deleteMany({ academicSourceId: contribution._id }, opt);
      await PendingKnowledgeRule.deleteMany({ evidenceChunkIds: { $in: chunkIds } }, opt);
      await KnowledgeRuleEvidence.deleteMany({ chunkId: { $in: chunkIds } }, opt);

      if (contribution.doi) {
        await SourceContribution.deleteMany({
          $or: [
            { doi: contribution.doi },
            { normalizedDoi: contribution.doi }
          ]
        }, opt);
      } else {
        await SourceContribution.deleteOne({ _id: contribution._id }, opt);
      }

      if (useTransaction) {
        await session.commitTransaction();
      }
    } catch (err: any) {
      if (useTransaction) {
        await session.abortTransaction();
      }
      res.status(500).json({
        success: false,
        message: 'Có lỗi xảy ra khi xóa đóng góp.',
        error: err.message || err
      });
      return;
    } finally {
      await session.endSession();
    }

    if (publicId && storageProvider === 'cloudinary' && !isAssetShared) {
      try {
        await deleteAsset(publicId, contribution.originalFile?.cloudinaryResourceType || 'raw');
        deletedCounts.cloudinaryAssets = 1;
      } catch (cloudinaryErr: any) {
        console.error('Failed to delete Cloudinary asset after DB commit:', cloudinaryErr);
      }
    }

    res.status(200).json({
      success: true,
      deleted: deletedCounts,
      warnings: []
    });
    return;
  }

  // 2. Check Cloudinary asset reuse for AcademicSource
  const publicId = source.originalFile?.cloudinaryPublicId;
  const storageProvider = source.originalFile?.storageProvider;
  let isAssetShared = false;
  if (publicId && storageProvider === 'cloudinary') {
    const otherSourceCount = await AcademicSource.countDocuments({
      _id: { $ne: source._id },
      'originalFile.cloudinaryPublicId': publicId
    });
    if (otherSourceCount > 0) {
      isAssetShared = true;
    }
  }

  // Define counts object to track deleted items
  const deletedCounts = {
    source: 0,
    fullText: 0,
    sections: 0,
    chunks: 0,
    ruleCandidates: 0,
    ruleSources: 0,
    orphanRules: 0,
    cloudinaryAssets: 0
  };

  const warnings: string[] = [];

  // 3. Perform database cascade deletion inside transaction if supported
  const session = await mongoose.startSession();
  let useTransaction = false;
  try {
    const hello = await mongoose.connection.db?.command({ hello: 1 }).catch(() => null);
    if (hello && (hello.setName || hello.msg === 'isdbgrid')) {
      await session.startTransaction();
      useTransaction = true;
    } else {
      console.log('MongoDB standalone detected. Running cascade deletion without transaction.');
    }
  } catch (txErr) {
    console.log('Failed to check replica set status, running cascade deletion without session.');
  }

  try {
    const opt = useTransaction ? { session } : {};
    const sess = useTransaction ? session : null;

    // Counts collections before deletion
    const chunkIds = await AcademicChunk.find({ sourceId: source._id }).session(sess).distinct('_id');

    const doc = await AcademicDocument.findOne({ sourceId: source._id }).session(sess);
    const docId = doc ? doc._id : null;

    deletedCounts.fullText = doc ? 1 : 0;
    deletedCounts.sections = docId ? await AcademicSection.countDocuments({ documentId: docId }).session(sess) : 0;
    deletedCounts.chunks = chunkIds.length;
    deletedCounts.ruleCandidates = await PendingKnowledgeRule.countDocuments({ evidenceChunkIds: { $in: chunkIds } }).session(sess);

    // Delete extraction runs
    await AcademicRuleExtractionRun.deleteMany({ academicSourceId: source._id }, opt);

    // Load KnowledgeRuleEvidence links to find rule candidates & orphans
    const ruleSourcesList = await KnowledgeRuleEvidence.find({ chunkId: { $in: chunkIds } }).session(sess);
    deletedCounts.ruleSources = ruleSourcesList.length;

    const ruleIdsToCheck = ruleSourcesList.map(rs => rs.ruleId).filter(Boolean);

    // Delete the KnowledgeRuleEvidence records
    await KnowledgeRuleEvidence.deleteMany({ chunkId: { $in: chunkIds } }, opt);

    // Check & delete orphaned source-generated rules
    for (const ruleId of ruleIdsToCheck) {
      const remainingLinks = await KnowledgeRuleEvidence.countDocuments({ ruleId }).session(sess);
      if (remainingLinks === 0) {
        const rule = await VerifiedKnowledgeRule.findById(ruleId).session(sess);
        if (rule) {
          if (rule.origin === 'source_generated') {
            await VerifiedKnowledgeRule.deleteOne({ _id: ruleId }, opt);
            deletedCounts.orphanRules++;
          }
        }
      }
    }

    // Cascade delete other collections
    if (docId) {
      await AcademicSection.deleteMany({ documentId: docId }, opt);
    }
    await AcademicDocument.deleteMany({ sourceId: source._id }, opt);
    await AcademicChunk.deleteMany({ sourceId: source._id }, opt);
    await PendingKnowledgeRule.deleteMany({ evidenceChunkIds: { $in: chunkIds } }, opt);

    // Delete SourceContribution & duplicate submissions if they exist
    const orContributionConditions: any[] = [];
    if (source.sourceContributionId) {
      orContributionConditions.push({ _id: source.sourceContributionId });
      orContributionConditions.push({ duplicateOf: source.sourceContributionId });
    }
    if (source.doi) {
      orContributionConditions.push({ doi: source.doi });
      orContributionConditions.push({ normalizedDoi: source.doi });
    }
    if (orContributionConditions.length > 0) {
      await SourceContribution.deleteMany({ $or: orContributionConditions }, opt);
    }

    // Delete the AcademicSource itself
    await AcademicSource.deleteOne({ _id: source._id }, opt);
    deletedCounts.source = 1;

    // 4. Commit database transaction
    if (useTransaction) {
      await session.commitTransaction();
    }
  } catch (err: any) {
    if (useTransaction) {
      await session.abortTransaction();
    }
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi xóa tài liệu.',
      error: err.message || err
    });
    return;
  } finally {
    await session.endSession();
  }

  // 5. Only after successful commit, delete the Cloudinary asset as a best-effort
  if (publicId && storageProvider === 'cloudinary' && !isAssetShared) {
    try {
      const destroyRes = await deleteAsset(publicId, source.originalFile?.cloudinaryResourceType || 'raw');
      console.log(`Cloudinary asset deleted: ${publicId}`, destroyRes);
      deletedCounts.cloudinaryAssets = 1;
    } catch (cloudinaryErr: any) {
      console.error('Failed to delete Cloudinary asset after DB commit:', cloudinaryErr);
      warnings.push(`Xóa tệp Cloudinary thất bại: ${cloudinaryErr.message || cloudinaryErr}`);
    }
  }

  res.status(200).json({
    success: true,
    deleted: deletedCounts,
    warnings
  });
};

export const reimportFullText = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const moderatorId = req.user?._id;

  if (!moderatorId) {
    res.status(401).json({ success: false, message: 'Unauthorized. User session not found.' });
    return;
  }

  const cleanId = id as string;
  if (!cleanId || !mongoose.Types.ObjectId.isValid(cleanId)) {
    res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
    return;
  }

  // 1. Load AcademicSource or SourceContribution
  let source = await AcademicSource.findById(cleanId);
  if (!source) {
    source = await SourceContribution.findById(cleanId);
  }
  if (!source) {
    res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
    return;
  }

  // Preflight candidate check
  let importCandidateUrl = '';
  let usingLegacyField = '';

  const hasCloudinary = source.originalFile?.cloudinaryPublicId && source.originalFile?.storageProvider === 'cloudinary';

  if (!hasCloudinary) {
    const urlCandidates = [
      { val: source.pdfUrl, label: 'pdfUrl' },
      { val: source.htmlUrl, label: 'htmlUrl' },
      { val: source.fullTextUrl, label: 'fullTextUrl' },
      { val: (source as any).sourceUrl, label: 'sourceUrl' },
      { val: source.url, label: 'url' },
      { val: source.metadata?.pdfUrl, label: 'metadata.pdfUrl' },
      { val: source.metadata?.url, label: 'metadata.url' },
      { val: source.metadata?.pdf_url, label: 'metadata.pdf_url' },
      { val: source.metadata?.sourceUrl, label: 'metadata.sourceUrl' },
      { val: source.metadata?.htmlUrl, label: 'metadata.htmlUrl' },
      { val: source.metadata?.landingPageUrl, label: 'metadata.landingPageUrl' },
      { val: source.metadata?.importSourceUrl, label: 'metadata.importSourceUrl' },
      { val: source.metadata?.importedFrom, label: 'metadata.importedFrom' },
      { val: source.metadata?.originalUrl, label: 'metadata.originalUrl' }
    ];

    for (const cand of urlCandidates) {
      if (cand.val && typeof cand.val === 'string' && cand.val.trim().startsWith('http')) {
        importCandidateUrl = cand.val.trim();
        usingLegacyField = cand.label;
        break;
      }
    }

    if (!importCandidateUrl) {
      const oldFt = await AcademicDocument.findOne({ sourceId: source._id });
      if (oldFt) {
        const ftUrlCandidates = [
          { val: oldFt.sourceUrl, label: 'AcademicDocument.sourceUrl' },
          { val: (oldFt as any).url, label: 'AcademicDocument.url' },
          { val: (oldFt as any).metadata?.sourceUrl, label: 'AcademicDocument.metadata.sourceUrl' },
          { val: (oldFt as any).metadata?.pdfUrl, label: 'AcademicDocument.metadata.pdfUrl' }
        ];
        for (const cand of ftUrlCandidates) {
          if (cand.val && typeof cand.val === 'string' && cand.val.trim().startsWith('http')) {
            importCandidateUrl = cand.val.trim();
            usingLegacyField = cand.label;
            break;
          }
        }
      }
    }
  }

  const warnings: string[] = [];
  let wasDoiResolved = false;
  const doiValue = source.doi || source.metadata?.doi;

  if (!hasCloudinary && !importCandidateUrl && doiValue) {
    try {
      console.log(`Preflight: Attempting DOI resolution for legacy source DOI ${doiValue}`);
      const resolveRes = await resolveSourceImport({ doi: doiValue }, moderatorId);
      if (resolveRes && resolveRes.fullTextAvailable) {
        if (resolveRes.pdfUrl) {
          source.pdfUrl = resolveRes.pdfUrl;
          importCandidateUrl = resolveRes.pdfUrl;
          usingLegacyField = 'resolved pdfUrl via DOI';
          wasDoiResolved = true;
        } else if (resolveRes.htmlUrl) {
          source.htmlUrl = resolveRes.htmlUrl;
          importCandidateUrl = resolveRes.htmlUrl;
          usingLegacyField = 'resolved htmlUrl via DOI';
          wasDoiResolved = true;
        } else if (resolveRes.sourceUrl) {
          (source as any).sourceUrl = resolveRes.sourceUrl;
          importCandidateUrl = resolveRes.sourceUrl;
          usingLegacyField = 'resolved sourceUrl via DOI';
          wasDoiResolved = true;
        }
        if (wasDoiResolved) {
          if (resolveRes.openAccessStatus) {
            source.openAccessStatus = resolveRes.openAccessStatus;
          }
          if (resolveRes.allowedUse) {
            source.allowedUse = resolveRes.allowedUse;
          }
          if (resolveRes.license) {
            source.license = resolveRes.license;
          }
          await source.save();
          warnings.push(`Legacy import source recovered via DOI resolution: ${usingLegacyField}`);
        }
      }
    } catch (resolveErr) {
      console.warn(`Preflight DOI resolution failed for ${doiValue}:`, resolveErr);
    }
  }

  if (!hasCloudinary && !importCandidateUrl) {
    res.status(422).json({
      success: false,
      code: "NO_FULLTEXT_IMPORT_SOURCE",
      message: "Tài liệu không có tệp PDF, link PDF, link HTML toàn văn hoặc nguồn Cloudinary khả dụng để nhập lại.",
      suggestion: "Hãy upload PDF thủ công hoặc cập nhật link PDF công khai cho tài liệu này."
    });
    return;
  }

  if (importCandidateUrl && !source.pdfUrl && !source.htmlUrl && !source.fullTextUrl && !(source as any).sourceUrl) {
    if (importCandidateUrl.toLowerCase().endsWith('.pdf') || usingLegacyField.includes('pdf')) {
      source.pdfUrl = importCandidateUrl;
    } else if (usingLegacyField.includes('html')) {
      source.htmlUrl = importCandidateUrl;
    } else {
      (source as any).sourceUrl = importCandidateUrl;
    }
    await source.save();
  }

  if (usingLegacyField && !wasDoiResolved) {
    warnings.push(`Legacy import source recovered from: ${usingLegacyField}`);
  }

  // Define counts object to track cleared items
  const clearedCounts = {
    fullText: 0,
    sections: 0,
    chunks: 0,
    ruleCandidates: 0,
    ruleSources: 0,
    orphanRules: 0
  };

  const isContribution = source.constructor.modelName === 'SourceContribution';

  // Check if we have an existing reader chunks presence
  const existingChunksCount = await AcademicChunk.countDocuments({
    chunkPurpose: 'reader',
    ...(isContribution ? { previewContributionId: source._id } : { sourceId: source._id })
  });
  const hasExistingReader = existingChunksCount > 0;

  // 3. Trigger the import FullText service
  try {
    const importResult = await importFullTextForSource(source, moderatorId, true);

    if (importResult.success) {
      // Clear derived metadata only after new parsed output passes validation
      const docClear = await AcademicDocument.findOne(
        isContribution ? { previewContributionId: source._id } : { sourceId: source._id }
      );
      const docClearId = docClear ? docClear._id : null;

      clearedCounts.fullText = docClear ? 1 : 0;
      clearedCounts.sections = docClearId ? await AcademicSection.countDocuments({ documentId: docClearId }) : 0;
      clearedCounts.chunks = await AcademicChunk.countDocuments(
        isContribution ? { previewContributionId: source._id } : { sourceId: source._id }
      );
      clearedCounts.ruleCandidates = await PendingKnowledgeRule.countDocuments({ academicSourceId: source._id });

      // Delete extraction runs
      await AcademicRuleExtractionRun.deleteMany({ academicSourceId: source._id });

      // Load KnowledgeRuleEvidence links to identify orphans
      const ruleSourcesList = await KnowledgeRuleEvidence.find({ sourceId: source._id });
      clearedCounts.ruleSources = ruleSourcesList.length;

      const ruleIdsToCheck = ruleSourcesList.map(rs => rs.ruleId).filter(Boolean);

      // Delete the KnowledgeRuleEvidence links
      await KnowledgeRuleEvidence.deleteMany({ sourceId: source._id });

      // Check & delete orphaned source-generated rules
      for (const ruleId of ruleIdsToCheck) {
        const remainingLinks = await KnowledgeRuleEvidence.countDocuments({ ruleId });
        if (remainingLinks === 0) {
          const rule = await VerifiedKnowledgeRule.findById(ruleId);
          if (rule && rule.origin === 'source_generated') {
            await VerifiedKnowledgeRule.deleteOne({ _id: ruleId });
            clearedCounts.orphanRules++;
          }
        }
      }

      await PendingKnowledgeRule.deleteMany({ academicSourceId: source._id });

      res.status(200).json({
        success: true,
        reimported: true,
        cleared: clearedCounts,
        importResult,
        warnings
      });
    } else {
      // Reimport failed
      if (hasExistingReader) {
        // Restore/preserve old reader status
        source.fullTextStatus = 'imported';
        source.readableInApp = true;
        source.chunkBuildStatus = 'completed';
        await source.save();

        res.status(422).json({
          success: false,
          error: importResult.error || 'candidate_fetch_failed',
          message: importResult.message || 'Phân tích văn bản thất bại. Giữ lại bản đọc cũ.',
          resolverReport: importResult.resolverReport,
          preservedExistingReader: true,
          warnings
        });
      } else {
        source.fullTextStatus = 'failed';
        source.readableInApp = false;
        source.chunkBuildStatus = 'failed';
        await source.save();

        res.status(422).json({
          success: false,
          error: importResult.error || 'candidate_fetch_failed',
          message: importResult.message || 'Phân tích văn bản thất bại.',
          resolverReport: importResult.resolverReport,
          preservedExistingReader: false,
          warnings
        });
      }
    }
  } catch (importErr: any) {
    if (hasExistingReader) {
      source.fullTextStatus = 'imported';
      source.readableInApp = true;
      source.chunkBuildStatus = 'completed';
      await source.save();
    }
    res.status(422).json({
      success: false,
      error: 'candidate_fetch_failed',
      message: importErr.message || importErr,
      preservedExistingReader: hasExistingReader,
      warnings: [...warnings, `Quá trình nạp bản đọc gặp lỗi: ${importErr.message || importErr}`]
    });
  }
};

export const getSourcePreview = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    const contribution = await SourceContribution.findById(id);
    if (!contribution) {
      res.status(404).json({ success: false, message: 'Không tìm thấy đóng góp này.' });
      return;
    }

    const escapeHtml = (text: string): string => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    // Query chunk counts dynamically
    const readerChunkCount = await AcademicChunk.countDocuments({
      previewContributionId: contribution._id,
      chunkPurpose: 'reader',
    });
    const ragChunkCount = await AcademicChunk.countDocuments({
      previewContributionId: contribution._id,
      chunkPurpose: 'rag',
    });
    const totalChunkCount = readerChunkCount + ragChunkCount;

    // Build the preview source payload compatible with LibrarySourceDetailView FE
    const sourceData: any = {
      _id: contribution._id,
      title: contribution.title,
      authors: contribution.authors,
      year: contribution.year,
      journal: contribution.journal || contribution.publisher || '',
      publisher: contribution.publisher || '',
      doi: contribution.doi,
      url: contribution.url,
      pdfUrl: contribution.pdfUrl || contribution.originalFile?.cloudinarySecureUrl || '',
      htmlUrl: contribution.htmlUrl || '',
      allowedUse: contribution.allowedUse,
      license: contribution.license,
      reviewStatus: contribution.reviewStatus,
      submittedNote: contribution.submittedNote,
      originalFile: contribution.originalFile,
      fullTextStatus: contribution.fullTextStatus || 'none',
      previewStatus: readerChunkCount > 0 ? 'imported' : 'none',
      chunkBuildStatus: ragChunkCount > 0 ? 'completed' : 'none',
      // Factual quality metrics
      metadataResolved: !!(contribution.title && contribution.authors && contribution.authors.length > 0),
      fullTextAvailable: contribution.allowedUse === 'open_access_fulltext',
      originalPdfAvailable: !!(contribution.originalFile && (contribution.originalFile.originalFileName || contribution.originalFile.cloudinarySecureUrl)) || !!contribution.pdfUrl,
      smartReaderAvailable: contribution.fullTextStatus === 'imported',
      hasPdf: !!(contribution.pdfUrl || (contribution.originalFile && (contribution.originalFile.originalFileName || contribution.originalFile.cloudinarySecureUrl))),
      canInlinePreview: !!(contribution.pdfUrl || (contribution.originalFile && (contribution.originalFile.originalFileName || contribution.originalFile.cloudinarySecureUrl))),
      inlineProxyUrl: !!(contribution.pdfUrl || (contribution.originalFile && (contribution.originalFile.originalFileName || contribution.originalFile.cloudinarySecureUrl))) ? `/moderation/sources/${contribution._id}/pdf-inline` : '',
      externalOpenUrl: contribution.pdfUrl || contribution.url || '',
      failureReason: contribution.fullTextStatus === 'failed' ? 'Lỗi khi nhập bản đọc.' : '',
      readerChunkCount,
      ragChunkCount,
      totalChunkCount,
      parserWarnings: [],
      ocrNeeded: false,
      sourceType: contribution.doi ? 'doi' : ((contribution.originalFile && (contribution.originalFile.originalFileName || contribution.originalFile.cloudinarySecureUrl)) ? 'uploaded_pdf' : 'web_url')
    };

    // Query preview AcademicDocument
    const doc = await AcademicDocument.findOne({ previewContributionId: contribution._id });
    
    let sectionsPayload: any[] = [];
    let fullTextPayload: any = null;

    if (doc) {
      // Reconstruct sections and reader chunks on-the-fly using the same logic as the approved reader response
      const sections = await AcademicSection.find({ documentId: doc._id }).sort({ sectionOrder: 1 });
      const sectionMap = new Map<string, typeof sections[0]>();
      for (const sec of sections) {
        sectionMap.set(sec._id.toString(), sec);
      }

      // Query reader chunks
      const chunks = await AcademicChunk.find({
        documentId: doc._id,
        chunkPurpose: 'reader',
      }).sort({ chunkOrder: 1 });

      sectionsPayload = chunks.map((chunk, idx) => {
        const parentSec = chunk.sectionId ? sectionMap.get(chunk.sectionId.toString()) : undefined;
        const sectionType = chunk.blockType || (parentSec ? parentSec.sectionType : 'paragraph');

        return {
          sectionIndex: idx,
          sectionType: sectionType,
          text: chunk.text,
          html: chunk.html || null,
          marker: chunk.marker || null,
          pageStart: 1,
          pageEnd: 1
        };
      });

      fullTextPayload = {
        wordCount: chunks.reduce((acc, c) => acc + (c.text.split(/\s+/).filter(Boolean).length), 0),
        characterCount: chunks.reduce((acc, c) => acc + c.text.length, 0),
        sectionCount: chunks.length,
        importedAt: doc.createdAt,
        extractionEngine: doc.parserEngine || 'pymupdf',
        extractionQuality: 'high',
        structureVersion: 'smart-reader-v2'
      };
    } else if (readerChunkCount > 0) {
      // Query reader chunks directly by previewContributionId
      const chunks = await AcademicChunk.find({
        previewContributionId: contribution._id,
        chunkPurpose: 'reader'
      }).sort({ chunkOrder: 1 });

      sectionsPayload = chunks.map((chunk, idx) => {
        return {
          sectionIndex: idx,
          sectionType: chunk.blockType || 'paragraph',
          text: chunk.text,
          html: chunk.html || null,
          marker: chunk.marker || null,
          pageStart: 1,
          pageEnd: 1
        };
      });

      fullTextPayload = {
        wordCount: chunks.reduce((acc, c) => acc + (c.text.split(/\s+/).filter(Boolean).length), 0),
        characterCount: chunks.reduce((acc, c) => acc + c.text.length, 0),
        sectionCount: chunks.length,
        importedAt: contribution.updatedAt,
        extractionEngine: 'GenericHtmlParser',
        extractionQuality: 'high',
        structureVersion: 'smart-reader-v2'
      };
    }

    res.status(200).json({
      success: true,
      data: {
        source: sourceData,
        fullText: fullTextPayload,
        sections: sectionsPayload
      }
    });

  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi tải dữ liệu xem trước.',
      error: err.message || err
    });
  }
};

const isUrlPdfLike = (urlString: string): boolean => {
  try {
    const parsed = new URL(urlString.trim());
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.endsWith('.pdf')) return true;
    if (pathname.endsWith('/pdf') || pathname.endsWith('/pdf/')) return true;
    if (parsed.hostname.includes('frontiersin.org') && pathname.includes('/pdf')) return true;
    if (parsed.hostname.includes('plos.org') && parsed.searchParams.get('type') === 'printable') return true;
    return false;
  } catch (e) {
    return false;
  }
};

export const getContributionPdfInline = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    const contribution = await SourceContribution.findById(id);
    if (!contribution) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    let pdfUrl = '';
    let isCloudinary = false;
    let cloudinaryPublicId = '';

    // Check Cloudinary RAW
    if (contribution.originalFile?.storageProvider === 'cloudinary' && contribution.originalFile?.cloudinarySecureUrl) {
      const mime = contribution.originalFile.mimeType || '';
      const name = contribution.originalFile.originalFileName || '';
      const format = contribution.originalFile.cloudinaryFormat || '';
      if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf') || format === 'pdf') {
        pdfUrl = contribution.originalFile.cloudinarySecureUrl;
        isCloudinary = true;
        cloudinaryPublicId = contribution.originalFile.cloudinaryPublicId || '';
      }
    }

    // Check pdfUrl
    if (!pdfUrl && contribution.pdfUrl && contribution.pdfUrl.trim().startsWith('http')) {
      pdfUrl = contribution.pdfUrl.trim();
    }

    // Fallback to url only if PDF-like
    if (!pdfUrl) {
      const fallbackUrl = contribution.url;
      if (fallbackUrl && fallbackUrl.trim().startsWith('http') && isUrlPdfLike(fallbackUrl.trim())) {
        pdfUrl = fallbackUrl.trim();
      }
    }

    if (!pdfUrl) {
      res.status(404).json({ success: false, message: 'Tài liệu này không có tệp PDF.' });
      return;
    }

    // Secure fetch and redirect checks
    let buffer: Buffer;
    if (isCloudinary && cloudinaryPublicId) {
      const signedDownloadUrl = cloudinary.utils.private_download_url(cloudinaryPublicId, '', {
        resource_type: 'raw',
        type: 'upload'
      });
      const response = await fetch(signedDownloadUrl);
      if (!response.ok) {
        throw new Error(`Fetch Cloudinary PDF error: ${response.status}`);
      }
      buffer = Buffer.from(await response.arrayBuffer());
    } else {
      const result = await fetchUrlWithSafeRedirects(pdfUrl.trim(), true);
      buffer = result.buffer;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
    res.status(200).send(buffer);

  } catch (err: any) {
    console.error('Error streaming preview PDF inline:', err);
    if (err instanceof SsrfError) {
      res.status(400).json({
        success: false,
        code: 'SSRF_BLOCKED',
        message: 'URL bị chặn bởi kiểm tra an toàn SSRF.'
      });
      return;
    }
    res.status(500).json({
      success: false,
      message: 'Lỗi hệ thống khi tải tệp PDF.',
      error: err.message || err
    });
  }
};


