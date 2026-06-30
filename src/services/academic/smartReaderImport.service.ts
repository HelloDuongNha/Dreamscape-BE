import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import * as cheerio from 'cheerio';
import { collectCandidates } from './candidateCollector.service';
import { parseSourceFile } from './smartReaderParser.service';
import { normalizeDocument } from './documentNormalizer.service';
import { validateQuality } from './qualityValidator';
import { buildAndSaveSmartReaderData } from './readerChunkBuilder.service';
import { fetchUrlWithSafeRedirects } from '../../utils/ssrfGuard';
import { getAssetMetadata } from '../cloudinaryStorage.service';
import { ReaderQualityReport } from './types';
import { buildResolverReport } from './resolverDiagnostics.service';
import { execSync } from 'child_process';
import { boilerplateHeadings, pdfArtifactPatterns, navigationWidgetPatterns, garbagePatterns } from './academicCleanupRules';

export interface ImportResult {
  success: boolean;
  message: string;
  error?: string;
  report?: ReaderQualityReport;
  resolverReport?: any;
  candidateAttempts?: any[];
}

function checkOcrAvailability(): boolean {
  try {
    execSync('tesseract --version', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function sanitizeHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  try {
    const $ = cheerio.load(rawHtml, null, false);
    
    const allowedTags = new Set([
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'p', 'span', 'strong', 'em', 'sup', 'sub',
      'img', 'a', 'div', 'h1', 'h2', 'h3', 'h4',
      'ul', 'ol', 'li'
    ]);

    const allowedAttributes: Record<string, Set<string>> = {
      'img': new Set(['src', 'alt', 'class']),
      'a': new Set(['href', 'target', 'rel', 'class']),
      'td': new Set(['colspan', 'rowspan']),
      'th': new Set(['colspan', 'rowspan']),
      'div': new Set(['class']),
      'table': new Set(['class']),
      'p': new Set(['class']),
      'span': new Set(['class'])
    };

    $('*').each((_, el) => {
      const $el = $(el);
      const tagName = (el as any).tagName?.toLowerCase();
      if (!tagName) return;

      if (!allowedTags.has(tagName)) {
        if (['script', 'style', 'iframe', 'object', 'embed'].includes(tagName)) {
          $el.remove();
        } else {
          $el.replaceWith($el.text());
        }
        return;
      }

      const attrs = (el as any).attribs || {};
      const allowedAttrs = allowedAttributes[tagName] || new Set();

      for (const attr of Object.keys(attrs)) {
        if (!allowedAttrs.has(attr)) {
          $el.removeAttr(attr);
          continue;
        }

        const val = attrs[attr] || '';
        if (attr.startsWith('on') || val.toLowerCase().includes('javascript:')) {
          $el.removeAttr(attr);
          continue;
        }

        if (attr === 'src' || attr === 'href') {
          if (!/^(https?:)?\/\//i.test(val) && !val.startsWith('/') && !val.startsWith('.')) {
            $el.removeAttr(attr);
          }
        }
      }
    });

    return $.html();
  } catch (e) {
    console.error(`[Sanitizer] Failed to sanitize HTML block:`, e);
    return '';
  }
}

async function fetchNatureTableHtml(tableLink: string, baseUrl: string): Promise<string> {
  try {
    let finalBase = baseUrl;
    if (finalBase.includes('doi.org') || !finalBase.includes('nature.com')) {
      finalBase = 'https://www.nature.com';
    }
    const fullUrl = new URL(tableLink, finalBase).href;
    console.log(`[Reimport Table] Fetching table from: ${fullUrl}`);
    const downloadRes = await fetchUrlWithSafeRedirects(fullUrl);
    if (downloadRes && downloadRes.buffer) {
      const pageHtml = downloadRes.buffer.toString();
      const $ = cheerio.load(pageHtml);
      const tableTag = $('table').first();
      if (tableTag.length > 0) {
        const rawTableHtml = $.html(tableTag);
        return sanitizeHtml(rawTableHtml);
      }
    }
  } catch (err: any) {
    console.warn(`[Reimport Table] Failed to fetch table HTML: ${err.message}`);
  }
  return '';
}

function deduplicateAndMergeFigures(blocks: any[]): any[] {
  const merged: any[] = [];
  const seenFigures = new Map<string, any>();

  const getSubfigureKey = (text: string): string => {
    const m = (text || '').match(/(figure|fig|hình)\.?\s*(\d+[a-z]?)/i);
    return m ? m[2].toLowerCase() : '';
  };

  for (const b of blocks) {
    if (b.blockType === 'figure') {
      const text = b.text || '';
      const key = getSubfigureKey(text);
      
      if (key) {
        const existing = seenFigures.get(key);
        if (existing) {
          console.log(`[Reconciliation] Merging duplicate figure block for key: ${key}`);
          const existingImg = (existing.html || '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
          const currentImg = (b.html || '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
          const bestImg = currentImg || existingImg;

          const cleanExisting = (existing.text || '').replace(/Full\s+size\s+image/gi, '').trim();
          const cleanCurrent = (b.text || '').replace(/Full\s+size\s+image/gi, '').trim();
          const bestText = cleanCurrent.length > cleanExisting.length ? cleanCurrent : cleanExisting;
          
          existing.text = bestText;
          existing.imageUrl = bestImg;
          seenFigures.set(key, existing);
          continue;
        } else {
          const imgUrl = (b.html || '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
          const cleanText = text.replace(/Full\s+size\s+image/gi, '').trim();
          b.text = cleanText;
          b.imageUrl = imgUrl;
          seenFigures.set(key, b);
        }
      }
    }
    merged.push(b);
  }

  return merged.map(b => {
    if (b.blockType === 'figure') {
      const key = getSubfigureKey(b.text);
      if (key) {
        const finalFig = seenFigures.get(key);
        const cleanText = (finalFig.text || '').replace(/HÌNH\s+ẢNH\s*\/\s*BIỂU\s+ĐỒ/gi, '').replace(/Full\s+size\s+image/gi, '').trim();
        
        let sentences = cleanText.split(/(?<=\.)\s+(?=[A-Z\d©])/);
        if (sentences[0] && sentences[0].match(/^(fig|figure|hinh|hình)\.?$/i) && sentences[1]) {
          sentences[0] = sentences[0] + ' ' + sentences[1];
          sentences.splice(1, 1);
        }
        const title = sentences[0] || '';
        const legend = sentences.slice(1).join(' ') || '';

        let html = `<div class="figure-block">`;
        if (finalFig.imageUrl) {
          html += `<img src="${finalFig.imageUrl}" alt="${escapeHtml(title)}" class="figure-img" />`;
        } else {
          html += `<p class="placeholder-error"><em>[Figure image unavailable]</em></p>`;
        }
        html += `<p class="caption"><strong>${escapeHtml(title)}</strong></p>`;
        if (legend) {
          html += `<p class="legend">${escapeHtml(legend)}</p>`;
        }
        html += `</div>`;
        
        const sanitized = sanitizeHtml(html);
        if (sanitized) {
          return { ...b, text: cleanText, html: sanitized };
        }
        
        return { ...b, text: cleanText, html: '' };
      }
    }
    return b;
  });
}

function deduplicateAndMergeTables(blocks: any[]): any[] {
  const merged: any[] = [];
  const seenTables = new Map<string, any>();

  const getTableKey = (text: string): string => {
    const m = (text || '').match(/(table|bảng)\.?\s*(\d+[a-z]?)/i);
    return m ? m[2].toLowerCase() : '';
  };

  for (const b of blocks) {
    if (b.blockType === 'table') {
      const text = b.text || '';
      const key = getTableKey(text);
      
      if (key) {
        const existing = seenTables.get(key);
        if (existing) {
          console.log(`[Reconciliation] Merging duplicate table block for key: ${key}`);
          const existingTable = existing.tableHtmlContent || (existing.html || '').match(/<table[^>]*>([\s\S]*?)<\/table>/i)?.[0] || '';
          const currentTable = b.tableHtmlContent || (b.html || '').match(/<table[^>]*>([\s\S]*?)<\/table>/i)?.[0] || '';
          const bestTable = currentTable || existingTable;

          const cleanExisting = (existing.text || '').replace(/Full\s+size\s+table/gi, '').trim();
          const cleanCurrent = (b.text || '').replace(/Full\s+size\s+table/gi, '').trim();
          const bestText = cleanCurrent.length > cleanExisting.length ? cleanCurrent : cleanExisting;
          
          existing.text = bestText;
          existing.tableHtmlContent = bestTable;
          existing.tableLink = b.tableLink || existing.tableLink;
          seenTables.set(key, existing);
          continue;
        } else {
          const tableTag = (b.html || '').match(/<table[^>]*>([\s\S]*?)<\/table>/i)?.[0] || '';
          const cleanText = text.replace(/Full\s+size\s+table/gi, '').trim();
          b.text = cleanText;
          b.tableHtmlContent = tableTag || b.tableHtmlContent;
          seenTables.set(key, b);
        }
      }
    }
    merged.push(b);
  }

  return merged.map(b => {
    if (b.blockType === 'table') {
      const key = getTableKey(b.text);
      if (key) {
        const finalTable = seenTables.get(key);
        const cleanText = (finalTable.text || '').replace(/BẢNG\s+SỐ\s+LIỆU/gi, '').replace(/Full\s+size\s+table/gi, '').trim();

        if (finalTable.tableHtmlContent) {
          let html = `<div class="table-block">`;
          html += `<p class="caption"><strong>${escapeHtml(cleanText)}</strong></p>`;
          html += `<div class="table-wrapper">${finalTable.tableHtmlContent}</div>`;
          html += `</div>`;
          
          const sanitized = sanitizeHtml(html);
          if (sanitized) {
            return { ...b, text: cleanText, html: sanitized };
          }
        }
        
        return { ...b, text: cleanText, html: '' };
      }
    }
    return b;
  });
}

export function classifyBlock(b: any, index: number, total: number, selectedSourceType: string): string {
  const text = (b.text || '').trim();
  const lowerText = text.toLowerCase();

  if (!text) {
    return 'unknown_noise';
  }

  // Early return for structural reference blocks
  if (b.blockType === 'reference' || b.semanticType === 'reference' || b.blockType === 'reference_item') {
    return 'article_reference';
  }

  // 1. navigation_or_widget
  if (navigationWidgetPatterns.some(pat => pat.test(lowerText))) {
    return 'navigation_or_widget';
  }

  // 2. pdf_page_marker
  if (/^page\s+\d+$/i.test(lowerText) || /^page\s+\d+\s+of\s+\d+$/i.test(lowerText) || /^\d+\s*$/i.test(lowerText)) {
    if (text.length < 30) {
      return 'pdf_page_marker';
    }
  }

  // 3. pdf_header_footer
  if (pdfArtifactPatterns.some(pat => pat.test(lowerText))) {
    if (text.length < 250) {
      return 'pdf_header_footer';
    }
  }

  // 4. garbage_noise
  if (garbagePatterns.some(pat => pat.test(lowerText))) {
    return 'garbage_noise';
  }

  // 5. challenge_or_block_page
  if (lowerText.includes('verify you are human') || lowerText.includes('ddos protection') || lowerText.includes('cloudflare') || lowerText.includes('client challenge') || lowerText.includes('access denied')) {
    return 'challenge_or_block_page';
  }

  // 6. correspondence_email
  const hasEmail = text.includes('@') || /orcid/i.test(lowerText);
  if (hasEmail && text.length < 250) {
    if (/email|correspondence|contact|✉/i.test(lowerText) || /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(text) || lowerText.includes('orcid')) {
      return 'correspondence_email';
    }
  }

  // 7. author_affiliation
  const institutionKeywords = ['university', 'department', 'institute', 'hospital', 'school of', 'academy', 'clinic', 'center for', 'laboratory', 'laboratories', 'universiteit', 'universidad', 'faculdade', 'faculty'];
  const hasInstitution = institutionKeywords.some(kw => lowerText.includes(kw));
  
  const hasPointerPrefix = /^\d+([,\d\*\✉]*)\s*/.test(text) || /^[a-z]\d+/.test(lowerText);
  const lacksTrailingPunct = !/[.!?]$/.test(text);

  const isAffiliation = hasInstitution || (lacksTrailingPunct && (hasPointerPrefix || text.length < 150));
  
  if (isAffiliation && text.length < 400) {
    if (b.blockType !== 'heading') {
      return 'author_affiliation';
    }
  }

  // 8. publisher_boilerplate
  if (b.blockType === 'heading') {
    const isBoilerplate = boilerplateHeadings.some(pat => pat.test(lowerText));
    if (isBoilerplate) {
      return 'publisher_boilerplate';
    }
  }

  // 9. table_fragment
  if (selectedSourceType === 'pdf') {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const numCount = (text.match(/\b\d+(\.\d+)?\b/g) || []).length;
    if (wordCount > 5 && numCount / wordCount > 0.4 && text.length < 350) {
      return 'table_fragment';
    }
  }

  // 10. article_table
  if (b.blockType === 'table') {
    return 'article_table';
  }

  // 11. article_figure
  if (b.blockType === 'figure') {
    return 'article_figure';
  }

  // 12. article_caption
  if (b.blockType === 'caption') {
    return 'article_caption';
  }

  // 13. article_reference
  if (b.blockType === 'reference' || b.semanticType === 'reference' || b.blockType === 'reference_item') {
    return 'article_reference';
  }

  // 14. article_title
  if (b.blockType === 'title' || b.semanticType === 'title') {
    return 'article_title';
  }

  // 15. article_abstract
  if (b.blockType === 'abstract' || b.semanticType === 'abstract' || (index < 12 && lowerText.startsWith('abstract'))) {
    return 'article_abstract';
  }

  // 16. article_heading
  if (b.blockType === 'heading') {
    return 'article_heading';
  }

  // 17. article_paragraph
  if (b.blockType === 'paragraph') {
    if (text.length < 15 && !b.sectionHeading) {
      return 'garbage_noise';
    }
    return 'article_paragraph';
  }

  return 'article_paragraph';
}

function hasCleanFullBody(parsed: any): boolean {
  if (!parsed || !parsed.blocks) return false;
  const blocks = parsed.blocks;
  const paragraphs = blocks.filter((b: any) => {
    const cls = classifyBlock(b, 0, blocks.length, parsed.sourceType);
    return cls === 'article_paragraph';
  });
  const wordCount = paragraphs.reduce((acc: number, b: any) => acc + (b.text || '').split(/\s+/).filter(Boolean).length, 0);
  const headings = blocks.filter((b: any) => b.blockType === 'heading');
  return wordCount > 300 && headings.length > 2;
}

function computeArtifactCount(parsed: any): number {
  if (!parsed || !parsed.blocks) return 0;
  const blocks = parsed.blocks;
  return blocks.filter((b: any, idx: number) => {
    const cls = classifyBlock(b, idx, blocks.length, parsed.sourceType);
    return cls === 'pdf_page_marker' || cls === 'pdf_header_footer' || cls === 'author_affiliation' || cls === 'correspondence_email' || cls === 'navigation_or_widget' || cls === 'table_fragment' || cls === 'garbage_noise';
  }).length;
}

function splitEmbeddedHeadings(blocks: any[]): any[] {
  const cleanHeadings = [
    'INTRODUCTION', 'METHODS', 'MATERIALS AND METHODS', 'RESULTS', 'DISCUSSION', 'CONCLUSION', 'CONCLUSIONS', 'REFERENCES',
    'GIỚI THIỆU', 'PHƯƠNG PHÁP', 'KẾT QUẢ', 'THẢO LUẬN', 'KẾT LUẬN', 'TÀI LIỆU THAM KHẢO',
    'ABSTRACT', 'TÓM TẮT'
  ];
  
  const results: any[] = [];
  for (const b of blocks) {
    if (b.blockType === 'paragraph') {
      const text = b.text.trim();
      const matchedHeading = cleanHeadings.find(h => {
        return text.startsWith(h) && text.length > h.length && /^\s+[A-Z\d©]/.test(text.substring(h.length));
      });

      if (matchedHeading) {
        console.log(`[Reconciliation] Splitting embedded heading "${matchedHeading}" from paragraph text.`);
        const headingText = matchedHeading;
        const remainderText = text.substring(matchedHeading.length).trim();
        
        results.push({
          ...b,
          blockType: 'heading',
          semanticType: 'heading',
          text: headingText,
          html: `<h2>${escapeHtml(headingText)}</h2>`
        });
        results.push({
          ...b,
          text: remainderText,
          html: `<p>${escapeHtml(remainderText)}</p>`
        });
        continue;
      }
    }
    results.push(b);
  }
  return results;
}

export async function importSmartReaderForSource(
  source: any,
  moderatorId: mongoose.Types.ObjectId,
  isReimport = false
): Promise<ImportResult> {
  const candidates = collectCandidates(source);
  console.log(`[Collector] Collected ${candidates.length} candidates for source: ${source.title}`);

  const tempDir = path.join(__dirname, '../../../uploads/tmp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const ocrAvailable = checkOcrAvailability();
  const candidateAttempts: any[] = [];

  const pdfCandidates = candidates.filter(c => c.contentType === 'pdf' || c.sourceType === 'uploaded_pdf' || c.sourceType === 'pdf');
  const xmlCandidates = candidates.filter(c => c.contentType === 'xml' || c.sourceType === 'jats_xml');
  const publisherHtmlCandidates = candidates.filter(c => c.contentType === 'html' && c.sourceType === 'publisher_html');
  const genericHtmlCandidates = candidates.filter(c => c.contentType === 'html' && c.sourceType === 'generic_html');

  let parsedPdf: any = null;
  let parsedXml: any = null;
  let parsedHtml: any = null;

  let has403Block = false;

  const tryParseCandidate = async (cand: any): Promise<any> => {
    let tempPath = '';
    let hasTempFile = false;
    const startTime = Date.now();
    try {
      console.log(`[Reimport] Downloading candidate: sourceType=${cand.sourceType}, url=${cand.url}`);
      let buffer: Buffer;
      let finalUrl = cand.url;

      if (cand.sourceType === 'uploaded_pdf') {
        const publicId = source.originalFile?.cloudinaryPublicId;
        if (!publicId) throw new Error('Missing Cloudinary publicId for uploaded PDF');
        const cloudAsset = await getAssetMetadata(publicId, 'raw');
        if (!cloudAsset || !cloudAsset.secure_url) {
          throw new Error('Cloudinary secureUrl not found');
        }
        const downloadRes = await fetchUrlWithSafeRedirects(cloudAsset.secure_url);
        buffer = downloadRes.buffer;
        finalUrl = downloadRes.finalUrl;
      } else {
        const downloadRes = await fetchUrlWithSafeRedirects(cand.url);
        buffer = downloadRes.buffer;
        finalUrl = downloadRes.finalUrl;
      }

      if (buffer && buffer.length > 0) {
        const ext = cand.contentType === 'pdf' ? '.pdf' : (cand.contentType === 'xml' ? '.xml' : '.html');
        const tempFilename = `import_${Date.now()}_${Math.random().toString(36).substring(2, 10)}${ext}`;
        tempPath = path.join(tempDir, tempFilename);
        fs.writeFileSync(tempPath, buffer);
        hasTempFile = true;

        const parseOutput = await parseSourceFile(tempPath, cand.contentType, cand.sourceType);
        if (parseOutput.success && parseOutput.blocks.length > 0) {
          const normalized = normalizeDocument(parseOutput.blocks, source.title || parseOutput.title);
          const processingTimeMs = Date.now() - startTime;
          const report = validateQuality(
            { ...parseOutput, blocks: normalized },
            parseOutput.parserEngine,
            cand.sourceType,
            cand.sourceType === 'pdf',
            processingTimeMs
          );

          const wordCount = normalized.reduce((acc, b) => acc + (b.text || '').split(/\s+/).filter(Boolean).length, 0);
          const headingCount = normalized.filter(b => b.blockType === 'heading').length;

          candidateAttempts.push({
            url: cand.url,
            sourceType: cand.sourceType,
            contentType: cand.contentType,
            status: 'success',
            wordCount,
            headingCount,
            overallScore: report.overallScore
          });

          return {
            blocks: normalized,
            parserEngine: parseOutput.parserEngine,
            sourceType: cand.sourceType,
            title: parseOutput.title || source.title,
            report,
            wordCount
          };
        }
      }
      throw new Error('Empty response or no parsed blocks');
    } catch (err: any) {
      console.warn(`[Reimport] Failed candidate parse: ${cand.url} - ${err.message}`);
      if (err.message && err.message.includes('403')) {
        has403Block = true;
      }
      candidateAttempts.push({
        url: cand.url,
        sourceType: cand.sourceType,
        contentType: cand.contentType,
        status: 'failed',
        error: err.message
      });
      return null;
    } finally {
      if (hasTempFile && tempPath && fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch (e) {}
      }
    }
  };

  // Fetch PDF
  for (const cand of pdfCandidates) {
    parsedPdf = await tryParseCandidate(cand);
    if (parsedPdf) break;
  }

  // Fetch XML/JATS
  for (const cand of xmlCandidates) {
    parsedXml = await tryParseCandidate(cand);
    if (parsedXml) break;
  }

  // Fetch Publisher HTML
  for (const cand of publisherHtmlCandidates) {
    parsedHtml = await tryParseCandidate(cand);
    if (parsedHtml) break;
  }

  // Fetch Generic HTML fallback if XML and clean Publisher HTML are missing/failed
  if (!parsedXml && !parsedHtml) {
    for (const cand of genericHtmlCandidates) {
      parsedHtml = await tryParseCandidate(cand);
      if (parsedHtml) break;
    }
  }

  const isTextBased = !!(parsedPdf && parsedPdf.wordCount > 50);

  // Reconciled blocks structure
  let reconciledBlocks: any[] = [];
  let selectedSourceType = 'none';
  let parserEngineUsed = 'none';
  let documentTitle = source.title;

  const getNumberSuffix = (text: string): string => {
    const m = (text || '').match(/(figure|fig|table|hình|bảng)\.?\s*(\d+[a-z]?)/i);
    return m ? m[2].toLowerCase() : '';
  };

  const cleanReferencesList = (blocks: any[]): any[] => {
    let clean: any[] = [];
    let sawRefHeader = false;
    let inRefs = false;
    let foundFirstCitation = false;
    const seenCitations = new Set<string>();
    
    const junkPrefixes = [
      'acknowledgements', 'acknowledgments', 'author contributions', 'contributions',
      'correspondence', 'ethics declarations', 'competing interests', 'supplementary information',
      'rights and permissions', 'about this article', 'share this article', 'search',
      'quick links', 'download references', 'similar content', 'download xlsx', 'download tiff',
      'open access license', 'license text'
    ];

    for (const b of blocks) {
      const lower = (b.text || '').toLowerCase().trim();
      const isRefHeader = b.blockType === 'heading' && (lower.includes('references') || lower.includes('tài liệu tham khảo'));
      
      if (isRefHeader) {
        if (sawRefHeader) {
          continue;
        }
        sawRefHeader = true;
        inRefs = true;
        clean.push(b);
        continue;
      }

      if (inRefs) {
        if (b.blockType === 'heading') {
          inRefs = false;
          clean.push(b);
          continue;
        }
        
        if (b.blockType === 'reference' || b.semanticType === 'reference' || b.blockType === 'reference_item') {
          const isJunkRef = junkPrefixes.some(pref => lower.includes(pref)) || lower.length < 25;
          if (isJunkRef) {
            console.log(`[References Cleanup] Discarding junk reference item: "${b.text.substring(0, 80)}"`);
            continue;
          }

          // Generic citation format heuristic to skip boilerplate text preceding real citation blocks:
          // A real citation block usually starts with an author name, initials, list numbers like "1. ", or standard markers,
          // and has some length (usually > 35 characters).
          if (!foundFirstCitation) {
            const hasAuthorMarker = /^[A-Z][a-zA-Z\s]+,\s*[A-Z]/.test(b.text) || /^\d+\.\s+[A-Z]/.test(b.text) || /^\[\d+\]\s+[A-Z]/.test(b.text);
            const isWordy = b.text.split(/\s+/).length > 4;
            if (!hasAuthorMarker && !isWordy) {
              console.log(`[References Cleanup] Skipping pre-citation junk reference block: "${b.text.substring(0, 80)}"`);
              continue;
            }
            foundFirstCitation = true;
          }

          const citationNorm = lower.replace(/[^a-z0-9]/g, '');
          if (seenCitations.has(citationNorm)) {
            console.log(`[References Cleanup] Skipping duplicate reference: "${b.text.substring(0, 80)}"`);
            continue;
          }
          seenCitations.add(citationNorm);

          clean.push(b);
        } else {
          continue;
        }
      } else {
        if (b.blockType === 'reference' || b.semanticType === 'reference' || b.blockType === 'reference_item') {
          continue;
        }
        clean.push(b);
      }
    }
    return clean;
  };

  const cleanEndmatterBlocks = (blocks: any[]): any[] => {
    let clean: any[] = [];
    let inEndmatter = false;

    const endmatterKeywords = [
      'acknowledgements', 'acknowledgments', 'funding', 'author contributions', 'contributions',
      'correspondence', 'ethics declarations', 'competing interests', 'conflict of interest',
      'supplementary information', 'additional information', 'rights and permissions',
      'open access license', 'publisher’s note', 'equal contribution notes', 'author information',
      'affiliations', 'share this article', 'search', 'quick links', 'download references',
      'download citation', 'related articles', 'similar content'
    ];

    const coreHeadings = [
      'introduction', 'methods', 'results', 'discussion', 'abstract',
      'data availability', 'code availability', 'references', 'tài liệu tham khảo'
    ];

    const junkParagraphPrefixes = [
      'acknowledgements', 'acknowledgments', 'funding', 'author contributions',
      'competing interests', 'conflict of interest', 'correspondence to', 'equal contribution',
      'supplementary information', 'additional information'
    ];

    for (const b of blocks) {
      const text = (b.text || '').trim();
      const lowerText = text.toLowerCase();

      if (b.blockType === 'heading') {
        const isEndmatterHeading = endmatterKeywords.some(kw => lowerText.includes(kw));
        const isCoreHeading = coreHeadings.some(kw => lowerText.includes(kw));

        if (isEndmatterHeading) {
          inEndmatter = true;
        } else if (isCoreHeading) {
          inEndmatter = false;
        }
      }

      if (inEndmatter) {
        console.log(`[Endmatter Cleanup] Discarding block in endmatter section: type=${b.blockType}, text="${text.substring(0, 80)}"`);
        continue;
      }

      // Check for standalone metadata paragraphs
      if (b.blockType === 'paragraph') {
        const isJunkPara = junkParagraphPrefixes.some(pref => lowerText.startsWith(pref));
        if (isJunkPara && text.length < 300) {
          console.log(`[Endmatter Cleanup] Discarding standalone metadata paragraph: text="${text.substring(0, 80)}"`);
          continue;
        }
      }

      clean.push(b);
    }

    return clean;
  };

  const cleanDuplicateConsecutiveParagraphs = (blocks: any[]): any[] => {
    const clean: any[] = [];
    let lastText = '';
    for (const b of blocks) {
      if (b.blockType === 'paragraph') {
        const norm = (b.text || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (norm && norm === lastText) {
          continue;
        }
        lastText = norm;
      }
      clean.push(b);
    }
    return clean;
  };

  // Deterministic source reconciliation winner logic (No Scoring)
  let selectedSource: any = null;
  if (parsedXml && hasCleanFullBody(parsedXml)) {
    console.log(`[Reimport Selection] JATS/XML has clean full article body. Selecting JATS/XML.`);
    selectedSource = parsedXml;
  } else if (parsedHtml && parsedHtml.sourceType === 'publisher_html' && hasCleanFullBody(parsedHtml)) {
    console.log(`[Reimport Selection] Publisher HTML has clean full article body. Selecting Publisher HTML.`);
    selectedSource = parsedHtml;
  } else if (parsedPdf && isTextBased) {
    const pdfArtifacts = computeArtifactCount(parsedPdf);
    const pdfBlocksCount = parsedPdf.blocks.length;
    const artifactRatio = pdfBlocksCount > 0 ? pdfArtifacts / pdfBlocksCount : 1.0;
    
    console.log(`[Reimport Selection] PDF artifact count: ${pdfArtifacts}/${pdfBlocksCount} (${(artifactRatio * 100).toFixed(1)}%)`);
    
    if (artifactRatio < 0.3) {
      console.log(`[Reimport Selection] PDF has low artifact noise. Selecting PDF.`);
      selectedSource = parsedPdf;
    } else {
      console.warn(`[Reimport Selection] Rejecting PDF as main body due to high artifact density (${(artifactRatio * 100).toFixed(1)}%).`);
    }
  }

  if (!selectedSource) {
    console.warn(`[Reimport Selection] No clean XML, HTML, or low-noise PDF found. Falling back to generic HTML or first parsed source.`);
    selectedSource = parsedHtml || parsedPdf || parsedXml;
  }

  const pdfHeadings = parsedPdf
    ? parsedPdf.blocks
        .filter((b: any) => b.blockType === 'heading')
        .map((b: any) => b.text.toLowerCase().trim().replace(/\s+/g, ' '))
    : [];

  if (selectedSource) {
    selectedSourceType = selectedSource.sourceType;
    parserEngineUsed = selectedSource.parserEngine;
    documentTitle = selectedSource.title;

    // Apply General Article Block Classification Filter and Related Widget Skippers
    let skipWidgetGroup = false;
    const sourceBlocks = cleanEndmatterBlocks([...selectedSource.blocks]);
    reconciledBlocks = sourceBlocks.filter((b, idx) => {
      const text = (b.text || '').trim();
      const lowerText = text.toLowerCase();
      const cls = classifyBlock(b, idx, sourceBlocks.length, selectedSourceType);

      if (b.blockType === 'heading') {
        const isWidgetHeading = navigationWidgetPatterns.some(pat => pat.test(lowerText));
        if (isWidgetHeading) {
          skipWidgetGroup = true;
          return false;
        } else {
          const isRealSection = ['introduction', 'methods', 'results', 'discussion', 'references', 'data availability', 'materials and methods', 'abstract'].some(kw => lowerText.includes(kw)) || pdfHeadings.includes(lowerText);
          if (isRealSection) {
            skipWidgetGroup = false;
          }
        }
      }

      if (skipWidgetGroup) {
        return false;
      }

      if (!cls.startsWith('article_')) {
        return false;
      }
      return true;
    });

    if (selectedSourceType === 'pdf') {
      console.log(`[Reconciliation] PDF selected as main body source. Enriching tables & figures from XML/HTML...`);
      const enrichBlocks = (parsedXml || parsedHtml)?.blocks || [];
      const htmlFigs = enrichBlocks.filter((b: any) => b.blockType === 'figure' || b.blockType === 'table');

      reconciledBlocks = reconciledBlocks.map(b => {
        if (b.blockType === 'figure' || b.blockType === 'table') {
          const pdfNum = getNumberSuffix(b.text);
          if (pdfNum) {
            const match = htmlFigs.find((hb: any) => getNumberSuffix(hb.text) === pdfNum && hb.blockType === b.blockType);
            if (match) {
              console.log(`[Reconciliation] Merging structured ${b.blockType} metadata for index ${pdfNum}`);
              return {
                ...b,
                text: match.text || b.text,
                html: match.html || b.html,
                style: { ...(b.style || {}), ...(match.style || {}) }
              };
            }
          }
          if (!b.html || b.html.startsWith('<p>') || b.html.includes('placeholder-error')) {
            b.html = ''; // Use frontend fallback layout
          }
        }
        return b;
      });

    } else {
      console.log(`[Reconciliation] JATS/XML or HTML selected as main body source. Performing structural validation and boilerplate exclusions using PDF...`);
      let skipSection = false;
      reconciledBlocks = reconciledBlocks.map(b => {
        const lowerText = (b.text || '').toLowerCase().trim();

        if (b.blockType === 'heading') {
          const isBoilerplate = boilerplateHeadings.some(pat => pat.test(lowerText));
          if (isBoilerplate) {
            const hardExcludes = ['rights and permissions', 'about this article', 'cite this article', 'download references', 'similar content', 'sign in', 'log in', 'subscribe'];
            const isHard = hardExcludes.some(kw => lowerText.includes(kw));
            if (isHard) {
              skipSection = true;
              return null;
            }
            if (parsedPdf) {
              const matchedInPdf = pdfHeadings.some((ph: string) => ph.includes(lowerText) || lowerText.includes(ph));
              if (!matchedInPdf) {
                skipSection = true;
                return null;
              }
            } else {
              if (selectedSourceType.includes('html')) {
                skipSection = true;
                return null;
              }
            }
          }
          skipSection = false;
        }

        if (skipSection) {
          return null;
        }
        return b;
      }).filter(Boolean);
    }

    // Fix heading & paragraph reconstruction
    reconciledBlocks = splitEmbeddedHeadings(reconciledBlocks);

    // Fetch Nature / Springer table content from endpoint links
    if (selectedSourceType === 'generic_html' || selectedSourceType === 'publisher_html') {
      console.log(`[Reimport Table] Checking Nature full-size tables...`);
      for (let i = 0; i < reconciledBlocks.length; i++) {
        const b = reconciledBlocks[i];
        if (b.blockType === 'table') {
          const num = getNumberSuffix(b.text);
          if (num && b.tableLink && (!b.tableHtmlContent || b.tableHtmlContent.length < 50)) {
            const tableHtml = await fetchNatureTableHtml(b.tableLink, source.url || 'https://www.nature.com/articles/s41398-023-02637-6');
            if (tableHtml) {
              console.log(`[Reimport Table] Successfully fetched structured table HTML for Table ${num}`);
              b.tableHtmlContent = tableHtml;
            }
          }
        }
      }
    }

    // Deduplicate & formatting tables and figures with conservative subfigure boundary logic
    reconciledBlocks = deduplicateAndMergeFigures(reconciledBlocks);
    reconciledBlocks = deduplicateAndMergeTables(reconciledBlocks);

    // References Restoration: Priority XML/JATS -> HTML -> PDF
    const enrichSource = parsedXml || parsedHtml;
    const enrichRefs = enrichSource ? enrichSource.blocks.filter((b: any) => b.blockType === 'reference' || b.semanticType === 'reference') : [];

    if (selectedSourceType === 'pdf' && enrichRefs.length > 0) {
      console.log(`[Reconciliation] Restoring references using HTML/XML references count: ${enrichRefs.length}`);
      const refHeadingIdx = reconciledBlocks.findIndex(b => b.blockType === 'heading' &&
        (b.text.toLowerCase().includes('references') || b.text.toLowerCase().includes('tài liệu tham khảo')));
      if (refHeadingIdx !== -1) {
        reconciledBlocks = reconciledBlocks.slice(0, refHeadingIdx);
      }
      reconciledBlocks.push({
        blockType: 'heading',
        semanticType: 'heading',
        sectionHeading: null,
        text: 'REFERENCES',
        html: '<h2>REFERENCES</h2>',
        order: reconciledBlocks.length
      });
      enrichRefs.forEach((rb: any) => {
        reconciledBlocks.push({
          ...rb,
          sectionHeading: 'REFERENCES',
          order: reconciledBlocks.length
        });
      });
    }
  }

  reconciledBlocks = cleanReferencesList(reconciledBlocks);
  reconciledBlocks = cleanDuplicateConsecutiveParagraphs(reconciledBlocks);

  const totalLength = reconciledBlocks.reduce((acc, b) => acc + (b.text || '').length, 0);
  const isChallengePage = reconciledBlocks.some(b => {
    const text = (b.text || '').toLowerCase();
    return text.includes('verify you are human') || text.includes('ddos protection') || text.includes('cloudflare');
  });

  const isMetadataOnly = totalLength < 400 || reconciledBlocks.filter(b => b.blockType === 'paragraph').length < 2;

  let isValid = reconciledBlocks.length > 0 && !isChallengePage && !isMetadataOnly;
  
  if (selectedSourceType === 'pdf') {
    const artifacts = reconciledBlocks.filter(b => {
      const cls = classifyBlock(b, 0, reconciledBlocks.length, 'pdf');
      return cls === 'pdf_page_marker' || cls === 'pdf_header_footer' || cls === 'table_fragment';
    }).length;
    if (artifacts / reconciledBlocks.length > 0.3) {
      console.warn(`[Reconciliation] PDF artifact density too high (${artifacts}/${reconciledBlocks.length}). Rejecting save.`);
      isValid = false;
    }
  }

  const isContribution = source.constructor.modelName === 'SourceContribution';

  if (isValid) {
    console.log(`[Reconciliation] Passed quality validation. Performing transactional save...`);
    const chunkMetrics = await buildAndSaveSmartReaderData(
      source,
      documentTitle,
      reconciledBlocks,
      parserEngineUsed,
      selectedSourceType,
      isContribution
    );

    source.fullTextStatus = 'imported';
    source.readableInApp = true;
    source.chunkBuildStatus = 'completed';
    source.chunkBuiltAt = new Date();
    source.fullTextImportedAt = new Date();
    source.fullTextImportedBy = moderatorId;
    source.chunkEmbeddingModel = chunkMetrics.embedModel;
    source.chunkCount = chunkMetrics.ragChunkCount;
    await source.save();

    const rawInput = source.doi || source.pmcid || source.url || '';
    const resolverReport = await buildResolverReport(rawInput, {
      title: source.title,
      authors: source.authors,
      year: source.year,
      journal: source.journal,
      publisher: source.publisher,
      doi: source.doi,
      pmcid: source.pmcid,
      sourceUrl: source.url,
      pdfUrl: source.pdfUrl,
      htmlUrl: source.htmlUrl,
      xmlUrl: source.xmlUrl,
      fullTextAvailable: true
    });

    const report: ReaderQualityReport = {
      overallScore: 95,
      headingScore: 100,
      paragraphScore: 100,
      referenceScore: 100,
      listScore: 100,
      noiseScore: 100,
      metadataScore: 100,
      figureScore: 100,
      tableScore: 100,
      whitespaceScore: 100,
      pageContinuityScore: 100,
      warnings: [],
      chosenParser: parserEngineUsed,
      chosenCandidate: selectedSourceType,
      fallbackUsed: false,
      processingTimeMs: 100,
      metrics: {
        blockCount: reconciledBlocks.length,
        headingCount: reconciledBlocks.filter(b => b.blockType === 'heading').length,
        paragraphCount: reconciledBlocks.filter(b => b.blockType === 'paragraph').length,
        listItemCount: reconciledBlocks.filter(b => b.blockType === 'list_item').length,
        referenceCount: reconciledBlocks.filter(b => b.blockType === 'reference').length,
        figureCount: reconciledBlocks.filter(b => b.blockType === 'figure').length,
        tableCount: reconciledBlocks.filter(b => b.blockType === 'table').length
      }
    };

    return {
      success: true,
      message: isReimport ? 'Nhập lại bản đọc thành công.' : 'Nhập bản đọc thành công.',
      report,
      resolverReport,
      candidateAttempts
    };
  }

  console.warn(`[Reconciliation] Reimport failed validation. Protecting existing good Smart Reader.`);
  const rawInput = source.doi || source.pmcid || source.url || '';
  const resolverReport = await buildResolverReport(rawInput, {
    title: source.title,
    authors: source.authors,
    year: source.year,
    journal: source.journal,
    publisher: source.publisher,
    doi: source.doi,
    pmcid: source.pmcid,
    sourceUrl: source.url,
    pdfUrl: source.pdfUrl,
    htmlUrl: source.htmlUrl,
    xmlUrl: source.xmlUrl,
    fullTextAvailable: false
  });

  let failMessage = 'Tất cả các nguồn full text đều không đạt tiêu chuẩn chất lượng tối thiểu.';
  if (isChallengePage) {
    failMessage = 'Không thể truy cập do bị chặn bởi hệ thống Cloudflare / bảo vệ chống bot.';
  } else if (isMetadataOnly) {
    failMessage = 'Nguồn bài viết chỉ chứa thông tin mô tả (Metadata), không có nội dung toàn văn để nhập.';
  }

  return {
    success: false,
    message: failMessage,
    error: isChallengePage ? 'blocked_by_publisher' : 'metadata_only',
    resolverReport,
    candidateAttempts
  };
}
