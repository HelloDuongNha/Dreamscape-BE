import { Request, Response } from 'express';
import mongoose from 'mongoose';
import SourceContribution from '../models/SourceContribution';
import AcademicSource from '../models/AcademicSource';
import { normalizeDoi } from '../services/source/openAccess.service';
import { incrementSubmitted } from '../services/contribution/contributionStats.service';
import { resolveSourceImport } from '../services/source/sourceImportResolver.service';
import { buildResolverReport } from '../services/ingestion/structured/resolverDiagnostics.service';
import fs from 'fs';
import { processPdfUpload, computeFileHash, toOriginalFileRecord, deleteProcessedPdfUpload } from '../services/storage/pdfUpload.service';
import { deleteOriginalPdfAsset } from '../services/storage/originalPdfStorage.service';
import { cacheOriginalPdfForSource } from '../services/storage/originalPdfAsset.service';
import { PDFParse } from 'pdf-parse';
import { hasStoredOriginalPdf } from '../services/storage/originalPdfStorage.service';
import { mapSourceOriginAndUrls } from '../services/source/academicSourceResponse.service';

export function extractDoiFromText(text: string): string | null {
  const doiRegex = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi;
  const match = doiRegex.exec(text);
  if (!match) return null;
  let doi = match[0];
  while (doi && /[.,;:)\]!?'"\s/]$/.test(doi)) {
    doi = doi.slice(0, -1);
  }
  return doi || null;
}

export function isFilenameLike(title: string, filename: string): boolean {
  if (!title) return true;
  const cleanTitle = title.trim().toLowerCase();
  const cleanFilename = filename.trim().toLowerCase();
  if (cleanTitle.endsWith('.pdf')) return true;
  if (cleanTitle === cleanFilename || cleanTitle === cleanFilename.replace(/\.[^/.]+$/, '')) {
    return true;
  }
  if (/^[a-zA-Z0-9_\-]+$/.test(cleanTitle) && cleanTitle.length > 5) {
    return true;
  }
  return false;
}

export function normalizeUrl(url: string): string {
  let clean = url.trim().toLowerCase();
  clean = clean.replace(/^(https?:\/\/)?(www\.)?/, '');
  return clean.replace(/\/$/, '');
}

function isValidOriginalFile(file: any): boolean {
  if (!file) return false;
  if (file.storageProvider === 'firebase') {
    return !!(file.firebaseStorageBucket && file.firebaseStoragePath);
  }
  if (file.storageProvider === 'cloudinary') {
    return !!(file.cloudinaryPublicId && file.cloudinarySecureUrl);
  }
  return !!(file.storageProvider && file.originalFileName);
}

async function reactivateSourceContribution(
  contribution: any,
  result: any,
  submittedBy: any,
  cleanNote: string | undefined
): Promise<any> {
  contribution.submittedBy = submittedBy;
  contribution.doi = result.doi || contribution.doi;
  contribution.normalizedDoi = result.doi || contribution.normalizedDoi;
  contribution.pmcid = result.pmcid || contribution.pmcid;
  contribution.normalizedPmcid = result.pmcid || contribution.normalizedPmcid;
  contribution.url = result.sourceUrl || contribution.url;
  contribution.normalizedUrl = result.sourceUrl ? normalizeUrl(result.sourceUrl) : contribution.normalizedUrl;
  contribution.submittedNote = cleanNote || undefined;
  contribution.reviewStatus = 'pending';
  contribution.reviewedBy = undefined;
  contribution.reviewedAt = undefined;
  contribution.reviewNote = undefined;
  contribution.title = result.title || contribution.title;
  contribution.authors = result.authors || contribution.authors;
  contribution.year = result.year || contribution.year;
  contribution.license = result.license || contribution.license || 'all-rights-reserved';
  contribution.allowedUse = result.allowedUse || contribution.allowedUse || 'metadata_only';
  contribution.copyrightStatus = result.allowedUse === 'open_access_fulltext' ? 'copyrighted_with_open_access' : (contribution.copyrightStatus || 'paywalled');
  
  // Clear stale reader/processing state and statistics
  contribution.fullTextStatus = result.fullTextAvailable ? 'available' : 'none';
  contribution.readableInApp = false;
  contribution.smartReaderStats = undefined;
  contribution.extractionStatus = undefined;
  contribution.extractionMethod = undefined;
  contribution.extractionQuality = undefined;
  contribution.pdfPageCount = undefined;
  contribution.detectedLanguage = undefined;
  contribution.detectedIdentifiers = undefined;
  
  // Retain newly resolved valid Original Document; otherwise do not retain a stale or partial stored-file block
  if (isValidOriginalFile(result.originalFile)) {
    contribution.originalFile = result.originalFile;
  } else {
    contribution.originalFile = undefined;
  }

  contribution.pdfUrl = result.pdfUrl || undefined;
  contribution.htmlUrl = result.htmlUrl || undefined;
  contribution.metadata = {
    title: result.title,
    authors: result.authors,
    year: result.year,
    journal: result.journal,
    publisher: result.publisher,
    doi: result.doi,
    isbn: result.isbn,
    url: result.sourceUrl,
    pdfUrl: result.pdfUrl,
    htmlUrl: result.htmlUrl,
    allowedUse: result.allowedUse,
    openAccessStatus: result.openAccessStatus,
    oaStatus: result.openAccessStatus,
    fullTextAvailable: result.fullTextAvailable,
    warnings: result.warnings,
    metadataProvider: result.metadataProvider
  };

  await contribution.save();
  return contribution;
}

/**
 * POST /api/sources/preview
 * Fetches preview metadata for a DOI or URL without saving.
 */
export const previewSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await resolveSourceImport(req.body, req.user?._id);
    const rawInput = req.body.doi || req.body.pmcid || req.body.url || '';
    const resolverReport = await buildResolverReport(rawInput, result);
    
    res.status(200).json({
      success: true,
      message: 'Thông tin tài liệu resolved thành công.',
      data: {
        title: result.title,
        authors: result.authors,
        year: result.year,
        journal: result.journal,
        publisher: result.publisher,
        doi: result.doi,
        pmcid: result.pmcid,
        isbn: result.isbn,
        url: result.sourceUrl,
        pdfUrl: result.pdfUrl,
        htmlUrl: result.htmlUrl,
        allowedUse: result.allowedUse,
        openAccessStatus: result.openAccessStatus,
        oaStatus: result.openAccessStatus,
        fullTextAvailable: result.fullTextAvailable,
        originalFile: result.originalFile,
        warnings: result.warnings,
        metadataProvider: result.metadataProvider,
        // Match expected legacy properties
        sourceProvider: result.sourceType === 'doi' ? 'crossref' : 'manual_url',
        verificationStatus: result.sourceType === 'doi' ? 'verified_doi' : 'unverified',
        copyrightStatus: result.allowedUse === 'open_access_fulltext' ? 'copyrighted_with_open_access' : 'paywalled',
        fullTextStatus: result.fullTextAvailable ? 'available' : 'none',
        fullTextUrl: result.pdfUrl || result.htmlUrl || result.sourceUrl || '',
        readableInApp: false,
        fullTextSourceType: result.sourceType === 'pdf_upload' ? 'pdf' : 'unknown',
        resolverReport
      }
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || 'Lỗi khi lấy thông tin tài liệu.',
      error: err.message || err
    });
  }
};

/**
 * POST /api/sources/contribute
 * Submits a new DOI or URL as an academic source contribution.
 * Guards duplicate DOI/URL submissions and enforces input limits.
 */
export const contributeSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const submittedBy = req.user?._id;
    if (!submittedBy) {
      res.status(401).json({ success: false, message: 'Unauthorized. User session not found.' });
      return;
    }

    const { submittedNote } = req.body as { submittedNote?: string };

    const cleanNote = (submittedNote || '').trim();
    if (cleanNote.length > 1000) {
      res.status(400).json({
        success: false,
        message: 'Submission note must not exceed 1000 characters.',
      });
      return;
    }

    // Resolve source metadata using the Unified Resolver
    const result = await resolveSourceImport(req.body, submittedBy);

    // Duplication Check
    const orConditions: any[] = [];
    if (result.doi) {
      orConditions.push({ normalizedDoi: result.doi });
      orConditions.push({ doi: result.doi });
    }
    if (result.pmcid) {
      orConditions.push({ normalizedPmcid: result.pmcid });
      orConditions.push({ pmcid: result.pmcid });
    }
    if (result.isbn) {
      orConditions.push({ isbn: result.isbn });
      orConditions.push({ 'metadata.isbn': result.isbn });
    }
    if (result.sourceUrl) {
      const normSourceUrl = normalizeUrl(result.sourceUrl);
      orConditions.push({ normalizedUrl: normSourceUrl });
      orConditions.push({ url: result.sourceUrl });
    }
    if (result.pdfUrl) {
      const normPdfUrl = normalizeUrl(result.pdfUrl);
      orConditions.push({ pdfUrl: result.pdfUrl });
      orConditions.push({ normalizedUrl: normPdfUrl });
    }
    if (result.originalFile?.cloudinaryPublicId) {
      orConditions.push({ 'originalFile.cloudinaryPublicId': result.originalFile.cloudinaryPublicId });
    }

    if (orConditions.length > 0) {
      const existingCont = await SourceContribution.findOne({ reviewStatus: { $ne: 'rejected' }, $or: orConditions });
      const existingSrc = await AcademicSource.findOne({ $or: orConditions });
      if (existingSrc) {
        res.status(409).json({
          success: false,
          code: 'DUPLICATE_SOURCE',
          message: 'Nguồn này đã tồn tại trong thư viện.',
        });
        return;
      }
      if (existingCont) {
        res.status(409).json({
          success: false,
          code: 'DUPLICATE_CONTRIBUTION',
          message: 'Nguồn này đã được gửi hoặc đang chờ duyệt.',
        });
        return;
      }

      // Reuse rejected contribution if same pmcid/doi to avoid unique index conflict
      const rejectedCont = await SourceContribution.findOne({ reviewStatus: 'rejected', $or: orConditions });
      if (rejectedCont) {
        await reactivateSourceContribution(rejectedCont, result, submittedBy, cleanNote);
        try { await incrementSubmitted(submittedBy.toString()); } catch {}
        const rawInput = req.body.doi || req.body.pmcid || req.body.url || '';
        const resolverReport = await buildResolverReport(rawInput, result);
        res.status(201).json({
          success: true,
          code: 'REACTIVATED',
          message: 'Đóng góp trước bị từ chối đã được kích hoạt lại.',
          data: rejectedCont,
          resolverReport
        });
        return;
      }

    }

    // Create Mongoose Document for SourceContribution
    const contribution = new SourceContribution({
      submittedBy,
      doi: result.doi || undefined,
      normalizedDoi: result.doi || undefined,
      pmcid: result.pmcid || undefined,
      normalizedPmcid: result.pmcid || undefined,
      url: result.sourceUrl || undefined,
      normalizedUrl: result.sourceUrl ? normalizeUrl(result.sourceUrl) : undefined,
      submittedNote: cleanNote || undefined,
      reviewStatus: 'pending',
      metadata: {
        title: result.title,
        authors: result.authors,
        year: result.year,
        journal: result.journal,
        publisher: result.publisher,
        doi: result.doi,
        isbn: result.isbn,
        url: result.sourceUrl,
        pdfUrl: result.pdfUrl,
        htmlUrl: result.htmlUrl,
        allowedUse: result.allowedUse,
        openAccessStatus: result.openAccessStatus,
        oaStatus: result.openAccessStatus,
        fullTextAvailable: result.fullTextAvailable,
        warnings: result.warnings,
        metadataProvider: result.metadataProvider
      },
      license: result.license || 'all-rights-reserved',
      allowedUse: result.allowedUse || 'metadata_only',
      verificationStatus: result.sourceType === 'doi' ? 'verified_doi' : 'unverified',
      sourceQuality: result.sourceType === 'doi' ? 'peer_reviewed' : 'informal',
      copyrightStatus: result.allowedUse === 'open_access_fulltext' ? 'copyrighted_with_open_access' : 'paywalled',
      fullTextStatus: result.fullTextAvailable ? 'available' : 'none',
      fullTextUrl: result.pdfUrl || result.htmlUrl || result.sourceUrl || undefined,
      oaStatus: result.openAccessStatus || 'closed',
      openAccessStatus: result.openAccessStatus || 'unknown',
      readableInApp: false,
      title: result.title,
      authors: result.authors,
      year: result.year,
      journal: result.journal,
      publisher: result.publisher,
      originalFile: result.originalFile,
      pdfUrl: result.pdfUrl || undefined,
      htmlUrl: result.htmlUrl || undefined
    });

    try {
      await contribution.save();
    } catch (saveErr: any) {
      // E11000 safety net: recheck and reuse existing contribution
      if (saveErr.code === 11000) {
        const recovered = await SourceContribution.findOne({ $or: orConditions.length > 0 ? orConditions : [{ _id: null }] });
        if (recovered && recovered.reviewStatus === 'rejected') {
          await reactivateSourceContribution(recovered, result, submittedBy, cleanNote);
          res.status(201).json({ success: true, code: 'REACTIVATED', message: 'Đóng góp đã được kích hoạt lại.', data: recovered });
        } else if (recovered) {
          res.status(409).json({ success: false, code: 'DUPLICATE_CONTRIBUTION', message: 'Nguồn này đang chờ duyệt hoặc đã tồn tại.' });
        } else {
          res.status(409).json({ success: false, message: 'Không thể gửi đóng góp do trùng lặp dữ liệu.' });
        }
        return;
      }
      throw saveErr;
    }

    try {
      await incrementSubmitted(submittedBy.toString());
    } catch (statsErr) {
      console.error('Failed to increment contribution stats:', statsErr);
    }

    const rawInput = req.body.doi || req.body.pmcid || req.body.url || '';
    const resolverReport = await buildResolverReport(rawInput, result);

    res.status(201).json({
      success: true,
      message: 'Source contribution submitted successfully.',
      data: contribution,
      resolverReport
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || 'An error occurred while submitting source contribution.',
      error: err.message || err,
    });
  }
};

/**
 * POST /api/sources/contribute-pdf
 * User-level route to upload a PDF file and submit it as a pending SourceContribution.
 * Performs validation, computes SHA-256 hash, runs duplicate checking, uploads to Cloudinary,
 * registers in Mongoose, and triggers safe cleanup.
 */
export const contributePdfSource = async (req: Request, res: Response): Promise<void> => {
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
  const mimeType = file.mimetype;

  try {
    // 1. Compute hash before upload to check for duplicate and avoid Cloudinary waste
    let fileHash: string;
    try {
      fileHash = await computeFileHash(filePath);
    } catch (hashErr: any) {
      throw new Error(`Lỗi khi tính toán mã băm tệp: ${hashErr.message}`);
    }

    // Parse first 2 pages for DOI and title metadata
    let detectedDoi: string | null = null;
    let metadataTitle: string | null = null;
    try {
      const pdfBuffer = fs.readFileSync(filePath);
      const parser = new PDFParse({ data: pdfBuffer });
      const pdfParseResult = await parser.getText({ first: 2 });
      const text = pdfParseResult.text || '';
      detectedDoi = extractDoiFromText(text);
      const info = await parser.getInfo().catch(() => null) as any;
      if (info && (info.Title || info.title)) {
        metadataTitle = (info.Title || info.title || '').trim();
      }
    } catch (parseErr: any) {
      console.warn('Lightweight PDF parsing failed:', parseErr.message || parseErr);
    }

    // 2. Perform duplicate check using fileHash and optionally DOI/URL
    const orConditions: any[] = [];
    orConditions.push({ 'originalFile.fileHash': fileHash });

    const bodyDoi = (req.body.doi || '').trim();
    const finalDoi = (bodyDoi || detectedDoi || '').trim();
    let resolvedMeta: any = null;

    if (finalDoi) {
      const cleanDoi = normalizeDoi(finalDoi);
      orConditions.push({ normalizedDoi: cleanDoi });
      orConditions.push({ doi: cleanDoi });

      // Duplicate check specifically by DOI to return the duplicate source link/details
      const doiDuplicateSrc = await AcademicSource.findOne({ $or: [{ normalizedDoi: cleanDoi }, { doi: cleanDoi }] });
      if (doiDuplicateSrc) {
        res.status(409).json({
          success: false,
          code: 'DUPLICATE_SOURCE',
          message: `Nguồn này đã tồn tại trong hệ thống với tiêu đề: "${doiDuplicateSrc.title}".`,
          existingSourceId: doiDuplicateSrc._id
        });
        return;
      }
      
      const doiDuplicateCont = await SourceContribution.findOne({ reviewStatus: { $ne: 'rejected' }, $or: [{ normalizedDoi: cleanDoi }, { doi: cleanDoi }] });
      if (doiDuplicateCont) {
        res.status(409).json({
          success: false,
          code: 'DUPLICATE_CONTRIBUTION',
          message: 'Nguồn này đã được gửi đóng góp trước đó và đang chờ duyệt.'
        });
        return;
      }

      // Query metadata
      try {
        const resolveRes = await resolveSourceImport({ doi: cleanDoi }, req.user?._id);
        if (resolveRes && resolveRes.title) {
          resolvedMeta = resolveRes;
        }
      } catch (resolveErr) {
        console.warn('Failed to resolve DOI metadata:', resolveErr);
      }
    }

    const bodyUrl = (req.body.url || '').trim();
    const finalUrl = (bodyUrl || resolvedMeta?.sourceUrl || '').trim();
    if (finalUrl) {
      const normUrl = normalizeUrl(finalUrl);
      orConditions.push({ normalizedUrl: normUrl });
      orConditions.push({ url: finalUrl });
    }

    const existingCont = await SourceContribution.findOne({ reviewStatus: { $ne: 'rejected' }, $or: orConditions });
    const existingSrc = await AcademicSource.findOne({ $or: orConditions });

    if (existingSrc) {
      res.status(409).json({
        success: false,
        code: 'DUPLICATE_SOURCE',
        message: `Nguồn này đã tồn tại trong thư viện với tiêu đề: "${existingSrc.title}".`,
        existingSourceId: existingSrc._id
      });
      return;
    }

    if (existingCont) {
      res.status(409).json({
        success: false,
        code: 'DUPLICATE_CONTRIBUTION',
        message: 'Nguồn này đã được gửi đóng góp trước đó và đang chờ duyệt.'
      });
      return;
    }

    const uploadResult = await processPdfUpload(filePath, originalName, mimeType, fileHash);


    // 4. Extract form fields
    const { title, authors, year, journal, publisher, submittedNote } = req.body;
    const cleanNote = (submittedNote || '').trim();
    if (cleanNote.length > 1000) {
      throw new Error('Ghi chú đóng góp không được vượt quá 1000 ký tự.');
    }

    // Choose title with fallback logic
    let finalTitle = (title || '').trim();
    if (!finalTitle && resolvedMeta?.title) {
      finalTitle = resolvedMeta.title;
    }
    if (!finalTitle && metadataTitle && !isFilenameLike(metadataTitle, originalName)) {
      finalTitle = metadataTitle;
    }
    
    let parsedAuthors: string[] = [];
    if (authors) {
      if (Array.isArray(authors)) {
        parsedAuthors = authors.map((a: any) => String(a).trim()).filter(Boolean);
      } else if (typeof authors === 'string') {
        try {
          const parsed = JSON.parse(authors);
          if (Array.isArray(parsed)) {
            parsedAuthors = parsed.map((a: any) => String(a).trim()).filter(Boolean);
          } else {
            parsedAuthors = [authors.trim()];
          }
        } catch {
          parsedAuthors = authors.split(',').map((a: string) => a.trim()).filter(Boolean);
        }
      }
    } else if (resolvedMeta?.authors) {
      parsedAuthors = resolvedMeta.authors;
    }

    let parsedYear: number | undefined;
    if (year) {
      const numYear = parseInt(year, 10);
      if (!isNaN(numYear)) {
        parsedYear = numYear;
      }
    } else if (resolvedMeta?.year) {
      parsedYear = resolvedMeta.year;
    }

    let finalJournal = (journal || '').trim();
    if (!finalJournal && resolvedMeta?.journal) {
      finalJournal = resolvedMeta.journal;
    }

    let finalPublisher = (publisher || '').trim();
    if (!finalPublisher && resolvedMeta?.publisher) {
      finalPublisher = resolvedMeta.publisher;
    }

    // 5. Construct originalFile block
    const originalFileData = toOriginalFileRecord(uploadResult, req.user?._id);

    // 6. Create SourceContribution
    const contribution = new SourceContribution({
      submittedBy: req.user?._id,
      doi: finalDoi || undefined,
      normalizedDoi: finalDoi ? normalizeDoi(finalDoi) : undefined,
      url: (bodyUrl || resolvedMeta?.sourceUrl) || undefined,
      normalizedUrl: (bodyUrl || resolvedMeta?.sourceUrl) ? normalizeUrl(bodyUrl || resolvedMeta.sourceUrl) : undefined,
      submittedNote: cleanNote || undefined,
      reviewStatus: 'pending',
      title: finalTitle || undefined,
      authors: parsedAuthors.length > 0 ? parsedAuthors : undefined,
      year: parsedYear,
      originalFile: originalFileData,
      sourceOrigin: 'uploaded_pdf',
      extractionStatus: 'uploaded',
      metadata: {
        title: finalTitle || undefined,
        authors: parsedAuthors,
        year: parsedYear,
        journal: finalJournal || undefined,
        publisher: finalPublisher || undefined,
        doi: finalDoi || undefined,
        url: (bodyUrl || resolvedMeta?.sourceUrl) || undefined
      }
    });

    // 7. Save contribution, delete from Cloudinary if save fails
    try {
      await contribution.save();
    } catch (dbErr: any) {
      console.error('Failed to save source contribution to database:', dbErr);
      if (dbErr.code === 11000) {
        // E11000 safety net: find rejected with same doi/hash/url and reactivate
        const existingRejected = orConditions.length > 0
          ? await SourceContribution.findOne({ reviewStatus: 'rejected', $or: orConditions })
          : null;
        if (existingRejected) {
          const oldOriginalFile = hasStoredOriginalPdf(existingRejected.originalFile)
            ? { ...(existingRejected.originalFile as any).toObject?.(), ...existingRejected.originalFile }
            : undefined;

          existingRejected.reviewStatus = 'pending';
          existingRejected.reviewedBy = undefined;
          existingRejected.reviewedAt = undefined;
          existingRejected.reviewNote = undefined;

          // Clear previous reader/processing/error states
          existingRejected.readableInApp = false;
          existingRejected.fullTextStatus = 'none';
          existingRejected.smartReaderStats = undefined;
          existingRejected.extractionStatus = 'uploaded';
          existingRejected.extractionMethod = undefined;
          existingRejected.extractionQuality = undefined;
          existingRejected.pdfPageCount = undefined;
          existingRejected.detectedLanguage = undefined;
          existingRejected.detectedIdentifiers = undefined;

          // Assign new uploaded file
          existingRejected.originalFile = contribution.originalFile;

          // Retain new/refreshed metadata
          existingRejected.title = contribution.title || existingRejected.title;
          existingRejected.authors = contribution.authors || existingRejected.authors;
          existingRejected.year = contribution.year || existingRejected.year;
          existingRejected.doi = contribution.doi || existingRejected.doi;
          existingRejected.normalizedDoi = contribution.normalizedDoi || existingRejected.normalizedDoi;
          existingRejected.url = contribution.url || existingRejected.url;
          existingRejected.normalizedUrl = contribution.normalizedUrl || existingRejected.normalizedUrl;
          existingRejected.metadata = contribution.metadata || existingRejected.metadata;

          try {
            await existingRejected.save();
            
            // Delete the older asset only after the new state is saved successfully
            // Never delete the older public ID when it is identical to the newly uploaded public ID
            let warning: string | undefined;
            if (oldOriginalFile) {
              try {
                await deleteOriginalPdfAsset(oldOriginalFile);
              } catch (delErr: any) {
                console.warn('Failed to clean up old PDF asset on reactivation:', delErr.message || delErr);
                warning = `Cảnh báo: Không thể xóa tệp PDF cũ: ${delErr.message || delErr}`;
              }
            }

            res.status(201).json({
              success: true,
              code: 'REACTIVATED',
              message: warning 
                ? `Đóng góp trước bị từ chối đã được kích hoạt lại với PDF mới. ${warning}` 
                : 'Đóng góp trước bị từ chối đã được kích hoạt lại với PDF mới.',
              data: existingRejected
            });
          } catch (reactivateSaveErr: any) {
            // A failed save must clean up the newly uploaded asset
            try {
              await deleteProcessedPdfUpload(uploadResult);
            } catch (cleanupErr: any) {
              console.error('Failed to clean up newly uploaded PDF asset on reactivate save failure:', cleanupErr.message || cleanupErr);
            }
            // Raise the error so it does not save
            throw reactivateSaveErr;
          }
        } else {
          // Non-recoverable duplicate — clean up the newly uploaded asset
          try {
            await deleteProcessedPdfUpload(uploadResult);
          } catch (cleanupErr: any) {
            console.error('Failed to clean up uploaded PDF asset:', cleanupErr.message || cleanupErr);
          }
          res.status(409).json({ success: false, message: 'Không thể gửi đóng góp do trùng lặp dữ liệu.' });
        }
        return;
      }
      try {
        await deleteProcessedPdfUpload(uploadResult);
      } catch (cleanupErr: any) {
        console.error('Failed to clean up uploaded PDF asset:', cleanupErr.message);
      }
      throw dbErr;
    }

    // 8. Increment user contribution stats
    if (req.user?._id) {
      try {
        await incrementSubmitted(req.user._id.toString());
      } catch (statsErr) {
        console.error('Failed to increment contribution stats:', statsErr);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Đóng góp tài liệu PDF của bạn đã được gửi thành công và đang chờ duyệt.',
      data: mapSourceOriginAndUrls(contribution)
    });

  } catch (err: any) {
    res.status(err.status || 400).json({
      success: false,
      message: err.message || 'Lỗi khi đóng góp tài liệu PDF.'
    });
  } finally {
    // Ensure temporary file is always unlinked
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkErr: any) {
        console.error(`Lỗi khi xóa tệp tạm: ${filePath}`, unlinkErr.message);
      }
    }
  }
};

export const cacheOriginalPdf = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).user?._id;
    const force = req.body?.force === true || req.body?.force === 'true';
    
    const result = await cacheOriginalPdfForSource(id, userId, force);
    
    res.status(200).json({
      success: true,
      status: result.status,
      message: result.message,
      attemptedCandidates: result.attemptedCandidates,
      source: result.source,
      data: result.source
    });
  } catch (err: any) {
    console.error('Error caching original PDF:', err);
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi lưu trữ PDF gốc.',
      error: err.message || err
    });
  }
};

export const uploadOriginalPdf = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({
      success: false,
      message: 'Không tìm thấy tệp PDF để tải lên.'
    });
    return;
  }

  const id = req.params.id as string;
  const filePath = file.path;
  const originalName = file.originalname;

  try {
    // 1. Retrieve the academic source
    const source = await AcademicSource.findById(id);
    if (!source) {
      res.status(404).json({
        success: false,
        message: 'Không tìm thấy tài liệu học thuật.'
      });
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    }

    // 2. Validate PDF file magic bytes
    const fileFd = fs.openSync(filePath, 'r');
    const magicBuffer = Buffer.alloc(4);
    fs.readSync(fileFd, magicBuffer, 0, 4, 0);
    fs.closeSync(fileFd);

    const isPdfMagic = magicBuffer.toString('ascii') === '%PDF';
    const isPdfMime = file.mimetype === 'application/pdf';
    const isPdfExt = originalName.toLowerCase().endsWith('.pdf');

    if (!isPdfMagic || !isPdfMime || !isPdfExt) {
      res.status(400).json({
        success: false,
        message: 'Tệp tải lên không phải là định dạng PDF hợp lệ.'
      });
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    }

    // 3. Process/store the new PDF.
    const uploadResult = await processPdfUpload(filePath, originalName, file.mimetype);

    const oldOriginalFile = hasStoredOriginalPdf(source.originalFile)
      ? { ...(source.originalFile as any).toObject?.(), ...source.originalFile }
      : undefined;
    const isReplace = !!oldOriginalFile;

    // 4. Update the DB document
    source.originalFile = toOriginalFileRecord(uploadResult, (req as any).user?._id);

    await source.save();

    // 5. Delete the old asset only AFTER the new reference is saved.
    let deleteWarning: string | undefined;
    if (oldOriginalFile) {
      try {
        await deleteOriginalPdfAsset(oldOriginalFile);
      } catch (delErr: any) {
        console.warn('Failed to delete old PDF asset on replace:', delErr.message);
        deleteWarning = `Lưu tệp mới thành công nhưng gặp lỗi khi dọn dẹp tệp cũ: ${delErr.message}`;
      }
    }

    res.status(200).json({
      success: true,
      status: isReplace ? 'replaced' : 'uploaded',
      source,
      originalFile: source.originalFile,
      message: isReplace 
        ? 'Thay thế tài liệu PDF gốc thành công.' 
        : 'Tải lên tài liệu PDF gốc thành công.',
      warning: deleteWarning
    });

  } catch (err: any) {
    console.error('Error uploading original PDF:', err);
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Lỗi máy chủ khi tải lên tài liệu PDF gốc.',
      error: err.message || err
    });
  } finally {
    // Safety cleanup of temp file
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupErr: any) {
        console.error(`Lỗi khi dọn dẹp file tạm multer: ${filePath}`, cleanupErr.message);
      }
    }
  }
};

/**
 * DELETE /api/sources/approved/:id/original-pdf
 * Deletes only the stored Cloudinary Original PDF asset from an approved source.
 * Does NOT delete the source, Smart Reader content, pdfUrl, htmlUrl, url, figures, tables, or references.
 * Access: Moderator/Admin only.
 */
export const deleteOriginalPdf = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({
        success: false,
        message: 'Không tìm thấy tài liệu học thuật.'
      });
      return;
    }

    const source = await AcademicSource.findById(id);
    if (!source) {
      res.status(404).json({
        success: false,
        message: 'Không tìm thấy tài liệu học thuật.'
      });
      return;
    }

    const orig = source.originalFile as any;
    if (!orig || !hasStoredOriginalPdf(orig)) {
      res.status(200).json({
        success: true,
        status: 'no_asset',
        message: 'Không có PDF gốc đã lưu.',
        source: mapSourceOriginAndUrls(source)
      });
      return;
    }

    try {
      await deleteOriginalPdfAsset(orig);
    } catch (delErr: any) {
      res.status(500).json({ success: false, message: 'Không thể xóa PDF khỏi kho lưu trữ.' });
      return;
    }

    source.originalFile = undefined;
    await source.save();

    res.status(200).json({
      success: true,
      status: 'deleted',
      message: 'Đã xóa PDF gốc thành công.',
      source: mapSourceOriginAndUrls(source)
    });

  } catch (err: any) {
    console.error('Error deleting original PDF:', err);
    res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ khi xóa PDF gốc.',
      error: err.message || err
    });
  }
};

import { cancelUploadedPdfImport, runUploadedPdfImport } from '../services/ingestion/pdf/uploadedPdfImport.service';
import { getPdfImportProgress } from '../services/ingestion/pdf/pdfImportProgress.service';

export const getUploadedPdfImportProgressForApprovedSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await getPdfImportProgress('approved_source', req.params.id as string);
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(404).json({ success: false, message: err.message || 'Không tìm thấy trạng thái xử lý PDF.' });
  }
};

export const cancelUploadedPdfImportForApprovedSource = async (req: Request, res: Response): Promise<void> => {
  const cancelled = await cancelUploadedPdfImport('approved_source', req.params.id as string);
  if (!cancelled) {
    res.status(409).json({ success: false, message: 'Tác vụ nhập PDF không còn chạy.' });
    return;
  }
  res.status(200).json({ success: true, message: 'Đã hủy nhập PDF.' });
};

export const processUploadedPdfForApprovedSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const forceReplace = req.body.forceReplace === true;
    const structuredFirst = req.body.structuredFirst === true;

    const result = await runUploadedPdfImport({
      targetType: 'approved_source',
      targetId: id,
      forceReplace,
      structuredFirst,
      userId: (req as any).user?._id
    });

    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message || 'Lỗi xử lý tệp PDF nguồn.'
    });
  }
};
