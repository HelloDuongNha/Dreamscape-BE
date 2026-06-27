import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { PDFParse } from 'pdf-parse';
import { getAssetMetadata } from './cloudinaryStorage.service';
import cloudinary from '../config/cloudinary';
import {
  isUrlSafe,
  isValidHttpUrl,
  fetchUrlWithSafeRedirects,
  SsrfError
} from '../utils/ssrfGuard';
import { parseHtmlArticle, parseJatsXml } from '../utils/htmlArticleParser';
import AcademicSource from '../models/AcademicSource';
import AcademicFullText from '../models/AcademicFullText';
import AcademicFullTextSection from '../models/AcademicFullTextSection';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

export interface ImportResult {
  success: boolean;
  warning?: boolean;
  code?: string;
  message?: string;
  data?: any;
  error?: string;
  details?: any;
}

interface ImportCandidate {
  type: 'jats_xml' | 'publisher_html' | 'sanitized_html' | 'pdf_text' | 'uploaded_pdf_text';
  url: string;
  fetchType: 'xml' | 'html' | 'pdf';
}

/**
 * High-level service method to import/extract full text for a single AcademicSource.
 * Implements Phase 4B.6 priority routing, redirect security checks, and transactional database commits.
 */
export async function importFullTextForSource(
  source: any,
  moderatorId: mongoose.Types.ObjectId,
  isReimportOverride?: boolean
): Promise<ImportResult> {
  const isReimport = isReimportOverride !== undefined 
    ? isReimportOverride 
    : (source.readableInApp || source.fullTextStatus === 'imported');

  const isClosedAccess = source.oaStatus === 'closed' || source.openAccessStatus === 'closed';

  const isApprovedManualPdf = source.constructor.modelName === 'AcademicSource' &&
                              (!!source.originalFile?.cloudinarySecureUrl || !!source.pdfUrl) &&
                              source.sourceOrigin === 'uploaded_pdf' &&
                              source.verificationStatus === 'manual';

  // Check if source has legal full-text URLs from DOI/Unpaywall resolution
  const hasLegalFullTextUrl =
    !!(source.pdfUrl && isValidHttpUrl(source.pdfUrl)) ||
    !!(source.fullTextUrl && isValidHttpUrl(source.fullTextUrl)) ||
    !!(source.htmlUrl && isValidHttpUrl(source.htmlUrl)) ||
    !!(source.xmlUrl && isValidHttpUrl(source.xmlUrl));

  // DOI sources with OA metadata or valid full-text URLs should never be metadata-only
  const isDoiOpenAccessSource =
    !!source.doi &&
    (
      source.allowedUse === 'open_access_fulltext' ||
      ['gold', 'hybrid', 'green', 'bronze', 'open'].includes(source.oaStatus) ||
      ['gold', 'hybrid', 'green', 'bronze', 'open'].includes(source.openAccessStatus) ||
      hasLegalFullTextUrl
    );

  const isMetadataOnly = !isApprovedManualPdf && !isDoiOpenAccessSource && (
    source.allowedUse === 'metadata_only' || 
    source.allowedUse === 'abstract_only' ||
    source.copyrightStatus === 'paywalled' ||
    isClosedAccess ||
    (source.license && source.license.toLowerCase() === 'all-rights-reserved' && !['gold', 'hybrid', 'green', 'bronze', 'open'].includes(source.openAccessStatus))
  );

  if (isMetadataOnly) {
    // Do NOT delete existing reader data — it may have been imported before status changed

    source.fullTextStatus = 'failed';
    source.readableInApp = false;
    source.fullTextImportError = 'Tài liệu chỉ hỗ trợ thông tin thư mục (Metadata only) do giới hạn truy cập đóng hoặc bản quyền.';
    await source.save();

    return {
      success: true,
      warning: true,
      code: 'METADATA_ONLY_ACCESS',
      message: 'Tài liệu chỉ hỗ trợ thông tin thư mục (Metadata only) do giới hạn bản quyền hoặc bản đóng.'
    };
  }

  // 2. Resolve candidates in priority order (JATS XML -> Publisher HTML -> Web HTML -> PDF URL -> Uploaded PDF)
  const candidates: ImportCandidate[] = [];

  // Priority A: Discovered JATS XML (from xmlUrl)
  if (source.xmlUrl && isValidHttpUrl(source.xmlUrl)) {
    candidates.push({ type: 'jats_xml', url: source.xmlUrl, fetchType: 'xml' });
  }

  // Priority B: Publisher HTML/web links
  if (source.htmlUrl && isValidHttpUrl(source.htmlUrl)) {
    candidates.push({ type: 'publisher_html', url: source.htmlUrl, fetchType: 'html' });
  }
  if (source.sourceUrl && isValidHttpUrl(source.sourceUrl)) {
    candidates.push({ type: 'publisher_html', url: source.sourceUrl, fetchType: 'html' });
  }
  if (source.url && isValidHttpUrl(source.url)) {
    candidates.push({ type: 'publisher_html', url: source.url, fetchType: 'html' });
  }

  // Priority C: Verified Open Access PDF (from pdfUrl)
  if (source.pdfUrl && isValidHttpUrl(source.pdfUrl)) {
    candidates.push({ type: 'pdf_text', url: source.pdfUrl, fetchType: 'pdf' });
  }

  // Priority D: Uploaded PDF (Cloudinary Raw File)
  const originalFile = source.originalFile;
  if (originalFile && originalFile.storageProvider === 'cloudinary' && originalFile.cloudinarySecureUrl) {
    candidates.push({ type: 'uploaded_pdf_text', url: originalFile.cloudinarySecureUrl, fetchType: 'pdf' });
  }

  if (candidates.length === 0) {
    return { success: false, message: 'Tài liệu không có tệp hoặc đường dẫn toàn văn khả dụng để nhập.' };
  }

  // Temporary local workspace parameters for PDF processing
  const tempDir = path.join(__dirname, '../../uploads/tmp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const tempFilename = `import_${Date.now()}_${Math.random().toString(36).substring(2, 10)}.pdf`;
  const tempPdfPath = path.join(tempDir, tempFilename);

  let successParsed = false;
  let hasTempFile = false;
  let parsedSections: any[] = [];
  let parsedWordCount = 0;
  let parsedCharCount = 0;
  let usedEngine: 'grobid' | 'pymupdf' | 'pdf_parse' | 'html' | 'xml' | 'unknown' | 'jats_xml' | 'publisher_html' | 'sanitized_html' | 'pymupdf_text' | 'pdf_parse_fallback' = 'unknown';
  let usedQuality: 'high' | 'medium' | 'low' = 'low';
  let structVersion = '';
  let hasRefs = false;
  let hasSecs = false;
  let sourceUsedUrl = '';
  let smartReaderSourceType: 'jats_xml' | 'publisher_html' | 'sanitized_html' | 'pdf_text' | 'uploaded_pdf_text' | 'metadata_only' = 'metadata_only';
  let importNote = '';
  let ocrNeeded = false;
  let warnings: string[] = [];

  // 3. Sequential Candidate Fetch & Parse Fallback Loop
  for (const candidate of candidates) {
    try {
      console.log(`[IMPORT CANDIDATE] Attempting priority source: type=${candidate.type}, url=${candidate.url}`);

      let downloadResult: { buffer: Buffer, finalUrl: string, contentType: string } | null = null;

      if (candidate.type === 'uploaded_pdf_text') {
        const publicId = originalFile.cloudinaryPublicId;
        if (!publicId) throw new Error('Missing Cloudinary publicId');
        
        const cloudAsset = await getAssetMetadata(publicId, 'raw');
        if (!cloudAsset || !cloudAsset.secure_url) {
          throw new Error('Cloudinary secure URL lookup failed.');
        }

                const signedDownloadUrl = cloudinary.utils.private_download_url(publicId, '', {
          resource_type: 'raw',
          type: 'upload'
        });
        const downloadResponse = await fetch(signedDownloadUrl);
        if (!downloadResponse.ok) {
          throw new Error(`Fetch Cloudinary Raw PDF error: ${downloadResponse.status}`);
        }
        const buffer = Buffer.from(await downloadResponse.arrayBuffer());

        if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== '%PDF') {
          throw new Error('Not a valid PDF signature.');
        }

        fs.writeFileSync(tempPdfPath, buffer);
        hasTempFile = true;
        sourceUsedUrl = cloudAsset.secure_url;
      } else {
        // Safe redirect verification guard (Correction 6)
        downloadResult = await fetchUrlWithSafeRedirects(
          candidate.url,
          candidate.fetchType === 'pdf'
        );

        if (candidate.fetchType === 'pdf') {
          fs.writeFileSync(tempPdfPath, downloadResult.buffer);
          hasTempFile = true;
        }
        sourceUsedUrl = downloadResult.finalUrl;
      }

      // Execute parsers
      if (candidate.fetchType === 'xml') {
        const xmlText = downloadResult ? downloadResult.buffer.toString('utf-8') : '';
        const parseResult = parseJatsXml(xmlText, sourceUsedUrl);

        if (!parseResult.success || parseResult.sections.length === 0) {
          throw new Error('JATS XML extracted 0 document blocks.');
        }

        parsedSections = parseResult.sections;
        parsedWordCount = parseResult.wordCount;
        parsedCharCount = parseResult.characterCount;
        usedEngine = 'jats_xml';
        usedQuality = parseResult.quality;
        structVersion = parseResult.structureVersion;
        hasRefs = parseResult.hasStructuredReferences;
        hasSecs = parseResult.hasDetectedSections;
        smartReaderSourceType = 'jats_xml';
        successParsed = true;
        break;
      }
      else if (candidate.fetchType === 'html') {
        const htmlText = downloadResult ? downloadResult.buffer.toString('utf-8') : '';
        const parseResult = parseHtmlArticle(htmlText, sourceUsedUrl);

        if (!parseResult.success || parseResult.sections.length === 0) {
          throw new Error('HTML Parser extracted 0 document blocks.');
        }

        parsedSections = parseResult.sections;
        parsedWordCount = parseResult.wordCount;
        parsedCharCount = parseResult.characterCount;
        usedEngine = parseResult.engine === 'publisher_html' ? 'publisher_html' : 'sanitized_html';
        usedQuality = parseResult.quality;
        structVersion = parseResult.structureVersion;
        hasRefs = parseResult.hasStructuredReferences;
        hasSecs = parseResult.hasDetectedSections;
        smartReaderSourceType = parseResult.engine === 'publisher_html' ? 'publisher_html' : 'sanitized_html';
        successParsed = true;
        break;
      }
      else if (candidate.fetchType === 'pdf' && hasTempFile) {
        let parserResult: any = null;
        try {
          parserResult = await new Promise((resolve, reject) => {
            const pythonBin = process.env.PYTHON_BIN || 'python3';
            const parserScriptPath = path.join(__dirname, '../utils/academic_pdf_parser.py');
            const pyProcess = spawn(pythonBin, [parserScriptPath, tempPdfPath]);

            let stdoutData = '';
            let stderrData = '';

            const timeout = setTimeout(() => {
              pyProcess.kill();
              reject(new Error('PDF extraction exceeded time limit (30s).'));
            }, 30000);

            pyProcess.stdout.on('data', (chunk) => {
              stdoutData += chunk.toString();
            });

            pyProcess.stderr.on('data', (chunk) => {
              stderrData += chunk.toString();
            });

            pyProcess.on('close', (code) => {
              clearTimeout(timeout);
              if (code !== 0) {
                reject(new Error(stderrData.trim() || `Python exited with code ${code}`));
                return;
              }
              try {
                resolve(JSON.parse(stdoutData.trim()));
              } catch (err) {
                reject(new Error('Parser did not return valid JSON.'));
              }
            });
          });

          if (parserResult && parserResult.success) {
            usedEngine = 'pymupdf_text';
            usedQuality = parserResult.quality || 'medium';
            structVersion = parserResult.structureVersion || 'pymupdf-v1';
            hasRefs = parserResult.hasStructuredReferences || false;
            hasSecs = parserResult.hasDetectedSections || false;
            parsedSections = parserResult.sections || [];
            parsedWordCount = parserResult.wordCount || 0;
            parsedCharCount = parserResult.characterCount || 0;
            ocrNeeded = parserResult.ocrNeeded || false;
            warnings = parserResult.warnings || [];
            smartReaderSourceType = candidate.type === 'uploaded_pdf_text' ? 'uploaded_pdf_text' : 'pdf_text';
            successParsed = true;
            break;
          } else {
            throw new Error(parserResult?.errorCode || 'PyMuPDF success=false');
          }
        } catch (pymupdfErr: any) {
          console.error('PyMuPDF layout extraction failed, executing pdf-parse fallback:', pymupdfErr);

          // Fallback to pdf-parse honestly
          const pdfBuffer = fs.readFileSync(tempPdfPath);
          const parser = new PDFParse({ data: pdfBuffer });
          const pdfParseResult = await parser.getText({ pageJoiner: '\f' });
          const text = pdfParseResult.text || '';

          parsedCharCount = text.length;
          parsedWordCount = text.split(/\s+/).filter(Boolean).length;

          if (parsedWordCount < 50) {
            throw new Error('PDF scan content text-less.');
          }

          const sectionsText = splitTextIntoSections(text);
          parsedSections = sectionsText.map((secText, index) => ({
            sectionIndex: index,
            sectionType: 'paragraph',
            text: secText,
            pageStart: 1,
            pageEnd: 1
          }));

          usedEngine = 'pdf_parse_fallback';
          usedQuality = 'low';
          structVersion = 'pdf-parse-v1';
          hasRefs = false;
          hasSecs = false;
          importNote = 'Chú ý: Trích xuất bằng bộ phân tích dự phòng (pdf-parse).';
          smartReaderSourceType = candidate.type === 'uploaded_pdf_text' ? 'uploaded_pdf_text' : 'pdf_text';
          successParsed = true;
          break;
        }
      }
    } catch (candErr: any) {
      console.warn(`[IMPORT CANDIDATE FAILED] Candidate type=${candidate.type} URL=${candidate.url} failed: ${candErr.message || candErr}`);
      // Skip this candidate and failover to the next safe option
    } finally {
      if (hasTempFile && fs.existsSync(tempPdfPath)) {
        try {
          fs.unlinkSync(tempPdfPath);
          hasTempFile = false;
        } catch {}
      }
    }
  }

  // 4. Handle Complete Failure
  if (!successParsed) {
    // Do NOT delete old reader data — preserve existing Smart Reader if reimport fails

    source.fullTextStatus = 'failed';
    source.readableInApp = false;
    source.fullTextImportError = 'Không thể trích xuất toàn văn từ bất kỳ nguồn dữ liệu khả dụng nào.';
    await source.save();

    return {
      success: false,
      message: 'Không thể trích xuất toàn văn từ bất kỳ nguồn dữ liệu nào khả dụng.'
    };
  }

  try {
    // 5. Construct Display readingBlocks & readingHtml
    let order = 0;
    const readingBlocks: any[] = [];
    let lastPage = 0;

    for (const sec of parsedSections) {
      const currentPage = sec.pageStart || 1;
      const isPdfEngine = usedEngine === 'pymupdf_text' || usedEngine === 'pdf_parse_fallback';
      
      // Page break dividers only allowed for PDF source content (Requirement 5)
      if (currentPage !== lastPage && isPdfEngine) {
        readingBlocks.push({
          type: 'page_break',
          text: `Page ${currentPage}`,
          html: `<div class="page-break">Page ${currentPage}</div>`,
          page: currentPage,
          order: order++
        });
        lastPage = currentPage;
      }

      let blockType: 'title' | 'heading' | 'paragraph' | 'list_item' | 'table' | 'figure' | 'caption' | 'blockquote' | 'page_break' | 'reference' | 'metadata' = 'paragraph';
      let htmlTag = 'p';

      if (sec.sectionType === 'title') {
        blockType = 'title';
        htmlTag = 'h1';
      } else if (sec.sectionType === 'heading') {
        blockType = 'heading';
        htmlTag = 'h2';
      } else if (sec.sectionType === 'list_item') {
        blockType = 'list_item';
        htmlTag = 'li';
      } else if (sec.sectionType === 'reference_item' || sec.sectionType === 'reference') {
        blockType = 'reference';
        htmlTag = 'div class="reference-item"';
      } else if (sec.sectionType === 'caption') {
        blockType = 'caption';
        htmlTag = 'div class="caption"';
      } else if (sec.sectionType === 'abstract') {
        blockType = 'paragraph';
        htmlTag = 'p class="abstract"';
      } else if (sec.sectionType === 'figure') {
        blockType = 'figure';
        htmlTag = 'div class="figure-placeholder"';
      } else if (sec.sectionType === 'table') {
        blockType = 'table';
        htmlTag = 'div class="table-placeholder"';
      } else if (sec.sectionType === 'page_break') {
        blockType = 'page_break';
        htmlTag = 'div class="page-break"';
      } else if (sec.sectionType === 'metadata') {
        blockType = 'metadata';
        htmlTag = 'p class="metadata-item"';
      }

      const closeTag = htmlTag.split(' ')[0];
      // Use clean whitelisted JATS/HTML DOM markup (Correction 2) or escape text for PDF text fallbacks
      const html = sec.html || `<${htmlTag}>${escapeHtml(sec.text)}</${closeTag}>`;

      const blockObj: any = {
        type: blockType,
        text: sec.text,
        html,
        page: currentPage,
        order: order++
      };
      if (sec.style) {
        blockObj.style = sec.style;
      }
      readingBlocks.push(blockObj);
    }

    const readingHtml = readingBlocks.map(b => b.html).filter(Boolean).join('\n');

    // Ensure a title block always exists at order 0
    const hasTitleBlock = readingBlocks.some(b => b.type === 'title');
    if (!hasTitleBlock) {
      const displayTitle = source.title || source.metadata?.title || 'Tài liệu học thuật';
      readingBlocks.unshift({
        type: 'title',
        text: displayTitle,
        html: `<h1>${escapeHtml(displayTitle)}</h1>`,
        page: 1,
        order: 0
      });
      readingBlocks.forEach((b, idx) => {
        b.order = idx;
      });
    }

    // 6. DB Short Transactional Write (Correction 5)
    const fullTextDoc = new AcademicFullText({
      academicSourceId: source._id,
      sourceType: (smartReaderSourceType === 'jats_xml') ? 'xml' : ((smartReaderSourceType === 'publisher_html' || smartReaderSourceType === 'sanitized_html') ? 'html' : 'pdf'),
      extractionStatus: 'success',
      wordCount: parsedWordCount,
      characterCount: parsedCharCount,
      sectionCount: parsedSections.length,
      license: source.license || 'unknown',
      sourceUrl: sourceUsedUrl || source.url,
      importedBy: moderatorId,
      importedAt: new Date(),
      extractionEngine: usedEngine,
      extractionQuality: usedQuality,
      structureVersion: structVersion,
      hasStructuredReferences: hasRefs,
      hasDetectedSections: hasSecs,
      sourceUsedUrl,
      sourceUsedType: (smartReaderSourceType === 'jats_xml') ? 'xml' : ((smartReaderSourceType === 'publisher_html' || smartReaderSourceType === 'sanitized_html') ? 'html' : 'pdf'),
      readingBlocks,
      readingHtml,
      ocrNeeded,
      warnings,
      errorReason: importNote || undefined,
      smartReaderSourceType,
      sourceUrlUsed: sourceUsedUrl,
      parserQuality: usedQuality,
      layoutQuality: usedQuality
    });

    const sectionDocs = parsedSections.map((sec, index) => {
      return new AcademicFullTextSection({
        academicFullTextId: fullTextDoc._id,
        academicSourceId: source._id,
        sectionIndex: index,
        title: sec.title || undefined,
        text: sec.text,
        characterCount: sec.text.length,
        wordCount: sec.text.split(/\s+/).filter(Boolean).length,
        pageStart: sec.pageStart || 1,
        pageEnd: sec.pageEnd || 1,
        sectionType: sec.sectionType || 'unknown',
        style: sec.style || undefined,
        html: sec.html || undefined
      });
    });

    const session = await mongoose.startSession();
    let useTransaction = false;
    try {
      const hello = await mongoose.connection.db?.command({ hello: 1 }).catch(() => null);
      if (hello && (hello.setName || hello.msg === 'isdbgrid')) {
        session.startTransaction();
        useTransaction = true;
      }
    } catch (txErr) {
      console.log('Failed to check replica set status, running imports without transaction.');
    }

    try {
      const opt = useTransaction ? { session } : {};

      // Delete old database records
      await AcademicFullText.deleteMany({ academicSourceId: source._id }, opt);
      await AcademicFullTextSection.deleteMany({ academicSourceId: source._id }, opt);

      // Save new database records
      await fullTextDoc.save(opt);
      await AcademicFullTextSection.insertMany(sectionDocs, opt);

      // Update AcademicSource attributes
      source.fullTextStatus = 'imported';
      source.readableInApp = true;
      source.fullTextImportError = importNote || undefined;
      source.fullTextImportedAt = new Date();
      source.fullTextImportedBy = moderatorId;
      await source.save(opt);

      if (useTransaction) {
        await session.commitTransaction();
      }
    } catch (dbErr) {
      if (useTransaction) {
        await session.abortTransaction();
      }
      throw dbErr;
    } finally {
      await session.endSession();
    }

    return {
      success: true,
      message: isReimport ? 'Nhập lại bản đọc thành công.' : 'Nhập bản đọc thành công.',
      data: { source, fullText: fullTextDoc }
    };

  } catch (processErr: any) {
    console.error('Error during full text import transactional commit:', processErr);

    let safeErrorMessage = processErr.message || 'Lỗi khi nhập bản đọc.';
    if (safeErrorMessage.includes('403')) {
      safeErrorMessage = 'Máy chủ tài liệu trả về 403 nên DreamScape không thể tự nhập bản đọc. Hãy upload PDF thủ công hoặc dùng link PDF công khai khác.';
    } else if (processErr instanceof SsrfError || safeErrorMessage.includes('SSRF')) {
      safeErrorMessage = 'URL bị chặn bởi kiểm tra an toàn SSRF. Không tắt bảo vệ này. Hãy upload PDF thủ công hoặc dùng nguồn công khai khác.';
    }

    source.fullTextStatus = 'failed';
    source.fullTextImportError = safeErrorMessage;
    if (!isReimport) {
      source.readableInApp = false;
    }
    await source.save();

    if (processErr instanceof SsrfError) {
      return {
        success: isReimport ? false : true,
        warning: true,
        code: "FULLTEXT_IMPORT_SSRF_BLOCKED",
        message: safeErrorMessage,
        error: safeErrorMessage,
        details: {
          attemptedUrl: processErr.attemptedUrl || source.url,
          finalUrl: processErr.finalUrl || source.url,
          reason: safeErrorMessage
        }
      };
    }

    return {
      success: false,
      message: isReimport
        ? 'Nhập lại bản đọc thất bại. Bản đọc cũ được giữ nguyên.'
        : 'Nhập bản đọc thất bại.',
      error: safeErrorMessage
    };
  }
}
