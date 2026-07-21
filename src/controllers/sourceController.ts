import { Request, Response } from 'express';
import mongoose from 'mongoose';
import SourceContribution from '../models/SourceContribution';
import AcademicSource from '../models/AcademicSource';
import AcademicDocument from '../models/AcademicDocument';
import AcademicSection from '../models/AcademicSection';
import AcademicChunk from '../models/AcademicChunk';
import { buildReaderResponse } from '../services/academic/reader/readerResponseBuilder.service';
import { calculateSourceContentHash, normalizeLanguageCode } from '../services/academic/reader/canonicalReaderIdentity.service';
import { normalizeDoi, fetchUnpaywallMetadata } from '../services/source/openAccess.service';
import { incrementSubmitted } from '../services/contribution/contributionStats.service';
import { resolveSourceImport } from '../services/source/sourceImportResolver.service';
import { buildResolverReport } from '../services/academic/ingestion/structured/resolverDiagnostics.service';
import { fetchUrlWithSafeRedirects, SsrfError } from '../services/infrastructure/security/ssrfGuard';
import fs from 'fs';
import { processPdfUpload, computeFileHash, toOriginalFileRecord, deleteProcessedPdfUpload } from '../services/storage/pdfUpload.service';
import { deleteOriginalPdfAsset } from '../services/storage/originalPdfStorage.service';
import { deleteAsset } from '../services/storage/cloudinaryStorage.service';
import { cacheOriginalPdfForSource } from '../services/storage/originalPdfAsset.service';
import { PDFParse } from 'pdf-parse';
import cloudinary from '../config/cloudinary';
import { pipeline } from 'stream/promises';
import { createOriginalPdfReadStream, hasStoredOriginalPdf } from '../services/storage/originalPdfStorage.service';

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

export function mapSourceOriginAndUrls(doc: any) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  
  // Project isbn if available in metadata
  obj.isbn = obj.isbn || obj.metadata?.isbn || '';

  const hasOriginalFile = hasStoredOriginalPdf(obj.originalFile);
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

interface FetchCrossrefResult {
  success: boolean;
  metadata?: any;
  errorType?: 'not_found' | 'timeout' | 'network_error';
}

/**
 * Helper to fetch DOI metadata from Crossref REST API.
 */
async function fetchCrossrefMetadata(doi: string): Promise<FetchCrossrefResult> {
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

interface UnpaywallResult {
  success: boolean;
  isEmailMissing?: boolean;
  data?: {
    is_oa: boolean;
    license?: string;
    oa_status?: string;
    url_for_pdf?: string;
    url?: string;
    host_type?: string;
    pdfUrl?: string;
    landingPageUrl?: string;
    htmlUrl?: string;
    xmlUrl?: string;
  };
}



function isValidHttpUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
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
 * GET /api/sources/approved
 * Retrieves approved academic sources with pagination and safe regex search.
 * Public to authenticated users.
 */
export const getApprovedSources = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    let page = parseInt(req.query.page as string, 10);
    if (isNaN(page) || page < 1) page = 1;

    let limit = parseInt(req.query.limit as string, 10);
    if (isNaN(limit) || limit < 1) limit = 12;
    if (limit > 50) limit = 50;

    const skip = (page - 1) * limit;

    let filter: any = {};
    const trimmedQ = q.trim().slice(0, 100);

    if (trimmedQ) {
      // Escape regex special characters to prevent regex injection or crashing
      const escapedQ = trimmedQ.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const searchRegex = new RegExp(escapedQ, 'i');
      filter.$or = [
        { title: searchRegex },
        { journal: searchRegex },
        { doi: searchRegex },
        { url: searchRegex },
        { authors: searchRegex }
      ];
    }

    const total = await AcademicSource.countDocuments(filter);
    
    // Project only public safe catalog fields, completely ignoring contribution note, contributor details, and raw files
    const items = await AcademicSource.find(filter)
      .select('_id title authors year journal publisher doi url sourceProvider verificationStatus allowedUse copyrightStatus createdAt fullTextStatus fullTextUrl license oaStatus readableInApp fullTextSourceType originalFile pdfUrl sourceOrigin metadata smartReaderStats readerBuildSnapshots')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Normalize authors to always be a string[] to prevent type issues on client
    const normalizedItems = items.map((item) => {
      const doc = mapSourceOriginAndUrls(item);
      if (!doc.authors) {
        doc.authors = [];
      } else if (!Array.isArray(doc.authors)) {
        doc.authors = [String(doc.authors)];
      } else {
        doc.authors = doc.authors.map(String).filter(Boolean);
      }
      return doc;
    });

    res.status(200).json({
      success: true,
      data: {
        items: normalizedItems,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        }
      }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching approved academic sources.',
      error: err.message || err,
    });
  }
};


/**
 * GET /api/sources/approved/:id
 * Retrieves a single approved academic source by ID.
 * Access: Authenticated users only.
 */
export const getApprovedSourceById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({
        success: false,
        message: 'Không tìm thấy tài liệu này.',
      });
      return;
    }

    const source = await AcademicSource.findById(id)
      .select('_id title authors year journal publisher doi url sourceProvider verificationStatus allowedUse copyrightStatus createdAt fullTextStatus fullTextUrl license oaStatus readableInApp fullTextSourceType fullTextImportError fullTextImportedAt fullTextImportedBy landingPageUrl pdfUrl xmlUrl htmlUrl chunkBuildStatus chunkBuiltAt chunkEmbeddingModel chunkCount chunkBuildError originalFile sourceOrigin metadata pmcid normalizedPmcid smartReaderStats readerBuildSnapshots');

    if (!source) {
      res.status(404).json({
        success: false,
        message: 'Không tìm thấy tài liệu này.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: mapSourceOriginAndUrls(source),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi lấy thông tin chi tiết tài liệu.',
      error: err.message || err,
    });
  }
};


/**
 * GET /api/sources/approved/:id/read
 * Returns the paginated full text sections for an approved academic source.
 * Access: Authenticated users only.
 */
export const getApprovedSourceRead = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({
        success: false,
        message: 'Không tìm thấy tài liệu này.',
      });
      return;
    }

    const source = await AcademicSource.findById(id);
    if (!source) {
      res.status(404).json({
        success: false,
        message: 'Không tìm thấy tài liệu này.',
      });
      return;
    }

    // Access control validation
    // Access control validation
    const srcAny = source as any;
    const isEligible = srcAny.readableInApp === true &&
                       srcAny.fullTextStatus === 'imported' &&
                       srcAny.allowedUse === 'open_access_fulltext';

    if (!isEligible) {
      res.status(403).json({
        success: false,
        message: 'Tài liệu này không có bản đọc đầy đủ trong ứng dụng hoặc chưa được nhập.',
      });
      return;
    }

    // Query full text metadata
    const fullText = await AcademicDocument.findOne({ sourceId: source._id });
    if (!fullText) {
      res.status(404).json({
        success: false,
        message: 'Không tìm thấy dữ liệu văn bản cho tài liệu này.',
      });
      return;
    }

    // Handle pagination offsets
    let page = parseInt(req.query.page as string || '1', 10);
    if (isNaN(page) || page < 1) page = 1;

    let limit = parseInt(req.query.limit as string || '20', 10);
    if (isNaN(limit) || limit < 1) limit = 20;
    if (limit > 50) limit = 50;

    const skip = (page - 1) * limit;

    const { sections: apiSections, total } = await buildReaderResponse(fullText, skip, limit);
    const pages = Math.ceil(total / limit);

    if (total === 0) {
      res.status(409).json({
        success: false,
        message: 'Tài liệu này không chứa dữ liệu văn bản.',
      });
      return;
    }

    // Query all chunks to calculate the global sourceContentHash
    const allChunks = await AcademicChunk.find(
      { documentId: fullText._id, chunkPurpose: 'reader' },
      { _id: 1, text: 1, chunkOrder: 1 }
    ).sort({ chunkOrder: 1 }).lean();

    const sourceContentHash = calculateSourceContentHash(allChunks);

    const readerIdentity = {
      documentId: fullText._id.toString(),
      sourceLanguage: normalizeLanguageCode(source.detectedLanguage),
      sourceContentHash,
      parserEngine: fullText.parserEngine || null,
      parserVersion: fullText.parserVersion != null ? String(fullText.parserVersion) : null,
      updatedAt: fullText.updatedAt ? fullText.updatedAt.toISOString() : null
    };

    const ftAny = fullText as any;
    res.status(200).json({
      success: true,
      data: {
        source: {
          id: source._id,
          title: source.title,
          authors: source.authors,
          year: source.year,
          journal: source.journal,
          doi: source.doi,
          license: source.license
        },
        fullText: {
          wordCount: ftAny.wordCount || 0,
          characterCount: ftAny.characterCount || 0,
          sectionCount: total,
          importedAt: ftAny.importedAt || ftAny.createdAt,
          extractionEngine: ftAny.extractionEngine || ftAny.parserEngine,
          extractionQuality: ftAny.extractionQuality || 'high',
          structureVersion: ftAny.structureVersion || 'smart-reader-v2',
          hasStructuredReferences: ftAny.hasStructuredReferences,
          hasDetectedSections: ftAny.hasDetectedSections,
          sourceUsedUrl: ftAny.sourceUsedUrl,
          sourceUsedType: ftAny.sourceUsedType,
          smartReaderSourceType: ftAny.smartReaderSourceType,
          sourceUrlUsed: ftAny.sourceUrlUsed,
          parserQuality: ftAny.parserQuality,
          layoutQuality: ftAny.layoutQuality,
          warnings: ftAny.warnings
        },
        readerIdentity,
        sections: apiSections,
        pagination: {
          page,
          limit,
          total,
          pages
        }
      }
    });

  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi tải nội dung bản đọc.',
      error: err.message || err,
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
  } catch {
    const lower = urlString.trim().toLowerCase();
    return lower.endsWith('.pdf') || lower.includes('/pdf/') || lower.includes('pdfurl');
  }
};

/**
 * GET /api/sources/approved/:id/original-document
 * Resolves the original document view status, secure URL, and embeddability.
 * Access: Authenticated users only.
 */
export const getApprovedSourceOriginalDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({
        success: false,
        canEmbed: false,
        hasPdf: false,
        sourceKind: 'external_link',
        message: 'Không tìm thấy tài liệu này.'
      });
      return;
    }

    const source = await AcademicSource.findById(id);
    if (!source) {
      res.status(404).json({
        success: false,
        canEmbed: false,
        hasPdf: false,
        sourceKind: 'external_link',
        message: 'Không tìm thấy tài liệu này.'
      });
      return;
    }

    let confirmedPdf = false;
    let pdfUrlToUse = '';
    let isCloudinary = false;

    if (hasStoredOriginalPdf(source.originalFile)) {
      res.status(200).json({
        success: true,
        viewUrl: `/sources/approved/${source._id}/pdf-inline`,
        canEmbed: true,
        hasPdf: true,
        sourceKind: source.originalFile?.storageProvider === 'firebase' ? 'firebase' : 'cloudinary',
        message: 'PDF gốc đã sẵn sàng.'
      });
      return;
    }

    // 1. Cloudinary RAW file upload check
    if (source.originalFile?.storageProvider === 'cloudinary' && source.originalFile?.cloudinarySecureUrl) {
      const mime = source.originalFile.mimeType || '';
      const name = source.originalFile.originalFileName || '';
      const format = source.originalFile.cloudinaryFormat || '';
      if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf') || format === 'pdf') {
        confirmedPdf = true;
        pdfUrlToUse = source.originalFile.cloudinarySecureUrl;
        isCloudinary = true;
      }
    }

    // 2. Verified/discovered pdfUrl check — trust pdfUrl field from resolver/Unpaywall
    if (!confirmedPdf && source.pdfUrl && source.pdfUrl.trim().startsWith('http')) {
      confirmedPdf = true;
      pdfUrlToUse = source.pdfUrl.trim();
    }

    // 3. Fallback check for url/fullTextUrl — only if URL clearly looks like PDF
    const srcAny2 = source as any;
    if (!confirmedPdf) {
      const fallbackUrl = srcAny2.fullTextUrl || srcAny2.url;
      if (fallbackUrl && fallbackUrl.trim().startsWith('http')) {
        const trimmed = fallbackUrl.trim();
        if (isUrlPdfLike(trimmed)) {
          confirmedPdf = true;
          pdfUrlToUse = trimmed;
        }
      }
    }

    // 4. Check metadata for stored Unpaywall PDF URLs
    if (!confirmedPdf && srcAny2.metadata) {
      const metaPdfCandidates = [
        srcAny2.metadata.pdfUrl,
        srcAny2.metadata.best_oa_location?.url_for_pdf,
        srcAny2.metadata.bestOaLocation?.url_for_pdf,
      ].filter((u: any) => u && typeof u === 'string' && u.trim().startsWith('http'));

      if (metaPdfCandidates.length > 0) {
        confirmedPdf = true;
        pdfUrlToUse = metaPdfCandidates[0].trim();
      }
    }

    // Return result based on confirmation status
    if (confirmedPdf && pdfUrlToUse) {
      res.status(200).json({
        success: true,
        viewUrl: pdfUrlToUse,
        canEmbed: true,
        hasPdf: true,
        sourceKind: isCloudinary ? 'cloudinary' : 'verified_oa_pdf',
        message: 'PDF gốc đã sẵn sàng.'
      });
      return;
    }

    // Not a PDF, resolve article_only or metadata_only fallback
    const articleUrl = srcAny2.fullTextUrl || srcAny2.url || srcAny2.landingPageUrl || (srcAny2.doi ? `https://doi.org/${srcAny2.doi.replace(/^(doi|DOI):\s*/, '').trim()}` : '');
    if (articleUrl && articleUrl.trim().startsWith('http')) {
      res.status(200).json({
        success: true,
        canEmbed: false,
        hasPdf: false,
        sourceKind: 'article_only',
        viewUrl: articleUrl.trim(),
        message: 'Tài liệu là trang bài viết HTML, không có PDF để hiển thị trong hệ thống.'
      });
    } else {
      res.status(200).json({
        success: true,
        canEmbed: false,
        hasPdf: false,
        sourceKind: 'metadata_only',
        message: 'Không có file gốc để hiển thị. Hãy upload PDF hoặc dùng nguồn công khai khác.'
      });
    }

  } catch (err: any) {
    res.status(500).json({
      success: false,
      canEmbed: false,
      hasPdf: false,
      sourceKind: 'failed',
      message: 'Có lỗi xảy ra khi xác định tài liệu gốc.',
      error: err.message || err
    });
  }
};

/**
 * Streams/fetches the verified safe PDF candidate as inline response.
 * Access: Authenticated users only.
 */
export const getApprovedSourcePdfInline = async (req: Request, res: Response): Promise<void> => {
  let source: any = null;
  try {
    const id = req.params.id as string;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    source = await AcademicSource.findById(id);
    if (!source) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    if (hasStoredOriginalPdf(source.originalFile)) {
      const filename = source.originalFile?.originalFileName || 'document.pdf';
      const stream = await createOriginalPdfReadStream(source.originalFile!);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.status(200);
      await pipeline(stream, res);
      return;
    }

    let pdfUrl = '';
    let isCloudinary = false;
    let cloudinaryPublicId = '';

    // Check Cloudinary RAW
    if (source.originalFile?.storageProvider === 'cloudinary' && source.originalFile?.cloudinarySecureUrl) {
      const mime = source.originalFile.mimeType || '';
      const name = source.originalFile.originalFileName || '';
      const format = source.originalFile.cloudinaryFormat || '';
      if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf') || format === 'pdf') {
        pdfUrl = source.originalFile.cloudinarySecureUrl;
        isCloudinary = true;
        cloudinaryPublicId = source.originalFile.cloudinaryPublicId || '';
      }
    }

    // Check pdfUrl
    if (!pdfUrl && source.pdfUrl && source.pdfUrl.trim().startsWith('http')) {
      pdfUrl = source.pdfUrl.trim();
    }

    // Fallback to url/fullTextUrl only if PDF-like
    const srcAny3 = source as any;
    if (!pdfUrl) {
      const fallbackUrl = srcAny3.fullTextUrl || srcAny3.url;
      if (fallbackUrl && fallbackUrl.trim().startsWith('http') && isUrlPdfLike(fallbackUrl.trim())) {
        pdfUrl = fallbackUrl.trim();
      }
    }

    // Check metadata for stored Unpaywall PDF URLs
    if (!pdfUrl && srcAny3.metadata) {
      const metaPdfCandidates = [
        srcAny3.metadata.pdfUrl,
        srcAny3.metadata.best_oa_location?.url_for_pdf,
        srcAny3.metadata.bestOaLocation?.url_for_pdf,
      ].filter((u: any) => u && typeof u === 'string' && u.trim().startsWith('http'));
      if (metaPdfCandidates.length > 0) {
        pdfUrl = metaPdfCandidates[0].trim();
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
    console.error('Error streaming PDF inline:', err);
    if (err instanceof SsrfError) {
      res.status(400).json({
        success: false,
        code: 'SSRF_BLOCKED',
        message: 'URL bị chặn bởi kiểm tra an toàn SSRF.'
      });
      return;
    }
    const isPmc = !!(source as any).pmcid;
    const isInvalidPdf = err.message?.includes('không phải PDF') || err.message?.includes('PDF');
    res.status(isPmc || isInvalidPdf ? 400 : 500).json({
      success: false,
      code: isPmc || isInvalidPdf ? 'PDF_INVALID' : 'PDF_FETCH_FAILED',
      message: err.message || 'Lỗi khi tải tài liệu PDF.'
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

import { runUploadedPdfImport } from '../services/academic/ingestion/pdf/uploadedPdfImport.service';

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
