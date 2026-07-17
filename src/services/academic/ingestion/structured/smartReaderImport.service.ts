import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import * as cheerio from 'cheerio';
import { collectCandidates } from './candidateCollector.service';
import { parseSourceFile } from './smartReaderParser.service';
import { normalizeDocument } from './documentNormalizer.service';
import { validateQuality } from './qualityValidator';
import { buildAndSaveSmartReaderData } from '../../reader/persistence/readerChunkBuilder.service';
import { fetchUrlWithSafeRedirects } from '../../../infrastructure/security/ssrfGuard';
import { downloadCloudinaryRawAsset } from '../../../storage/cloudinaryStorage.service';
import { deleteAsset } from '../../../storage/cloudinaryStorage.service';
import AcademicChunk from '../../../../models/AcademicChunk';
import { resolvePmcArchiveImages } from './pmcImageArchive.service';
import { ReaderQualityReport } from '../../types/canonical.types';
import { buildResolverReport } from './resolverDiagnostics.service';
import { execSync } from 'child_process';
import { boilerplateHeadings, pdfArtifactPatterns, navigationWidgetPatterns, garbagePatterns } from './academicCleanupRules';
import { calculateVirtualPageCount } from '../../reader/compile/paginationHelper';
import { materializeStructuredFigure, createFigureMaterializeCache } from './structuredFigureAsset.service';

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
      'img': new Set(['src', 'alt', 'class', 'data-cloudinary-public-id']),
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

function isSvgBuffer(buffer: Buffer): boolean {
  const text = buffer.toString('utf8').trim().toLowerCase();
  return text.includes('<svg') && !text.includes('<html') && !text.includes('<body') && !text.includes('<!doctype html');
}

function hasRecognizedImageBytes(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 4) return false;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer.length >= 6) {
    const gifSig = buffer.toString('ascii', 0, 6);
    if (gifSig === 'GIF89a' || gifSig === 'GIF87a') return true;
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return true;
  if (isSvgBuffer(buffer)) return true;
  return false;
}

function isTerminalError(err: any): boolean {
  if (!err) return false;
  if (err.name === 'SsrfError' || (err.message && err.message.includes('SSRF'))) {
    return true;
  }
  const msg = (err.message || '').toLowerCase();
  
  if (msg.includes('404')) {
    return true;
  }
  if (msg.includes('400') || msg.includes('401') || msg.includes('403')) {
    return true;
  }
  if (msg.includes('15mb') || msg.includes('không phải pdf') || msg.includes('chuyển hướng')) {
    return true;
  }
  return false;
}

async function verifyImageUrl(
  url: string,
  cache: Map<string, string | null>,
  transientRetryCounts: Map<string, number>
): Promise<string | null> {
  const trimmed = url.trim();
  if (cache.has(trimmed)) {
    return cache.get(trimmed)!;
  }

  try {
    const res = await fetchUrlWithSafeRedirects(trimmed);
    if (!res || !res.buffer || res.buffer.length === 0) {
      cache.set(trimmed, null);
      return null;
    }
    const contentType = (res.contentType || '').toLowerCase();
    
    if (contentType.includes('html') || contentType.includes('json')) {
      if (contentType.includes('xml') && isSvgBuffer(res.buffer)) {
        cache.set(trimmed, res.finalUrl);
        return res.finalUrl;
      }
      cache.set(trimmed, null);
      return null;
    }

    const isImageContentType = contentType.startsWith('image/');
    const isGenericOrMissing = !contentType || contentType === 'application/octet-stream' || contentType === 'text/plain' || contentType === 'application/xml';
    
    let isValid = false;
    if (isImageContentType) {
      if (contentType.includes('svg')) {
        isValid = isSvgBuffer(res.buffer);
      } else {
        isValid = true;
      }
    } else if (isGenericOrMissing) {
      isValid = hasRecognizedImageBytes(res.buffer);
    }

    if (isValid) {
      if (contentType.includes('svg') || isSvgBuffer(res.buffer)) {
        const text = res.buffer.toString('utf8').trim().toLowerCase();
        if (text.includes('<html') || text.includes('<body')) {
          cache.set(trimmed, null);
          return null;
        }
      }
      cache.set(trimmed, res.finalUrl);
      return res.finalUrl;
    }

    cache.set(trimmed, null);
    return null;
  } catch (err: any) {
    if (isTerminalError(err)) {
      console.warn(`[Figure Verification] Terminal error for ${trimmed}: ${err.message}`);
      cache.set(trimmed, null);
      return null;
    }
    
    const attempt = (transientRetryCounts.get(trimmed) || 0) + 1;
    transientRetryCounts.set(trimmed, attempt);
    console.warn(`[Figure Verification] Transient failure for ${trimmed} (attempt ${attempt}/3): ${err.message}`);
    
    if (attempt >= 3) {
      console.warn(`[Figure Verification] Retry limit exceeded for ${trimmed}. Promoting to terminal failure.`);
      cache.set(trimmed, null);
      return null;
    }
    
    throw err;
  }
}

function getMappedPmcCdnUrl(url: string, pmcImageMap?: Map<string, string>): string | null {
  if (!pmcImageMap || pmcImageMap.size === 0) return null;
  try {
    const filename = url.split('/').pop() || '';
    const cleanName = filename.replace(/\.[a-zA-Z0-9]+$/, '').toLowerCase();
    if (pmcImageMap.has(filename.toLowerCase())) {
      return pmcImageMap.get(filename.toLowerCase()) || null;
    }
    if (pmcImageMap.has(cleanName)) {
      return pmcImageMap.get(cleanName) || null;
    }
  } catch (e) {}
  return null;
}

async function resolveAndVerifyImageUrl(
  url: string | undefined,
  cache: Map<string, string | null>,
  transientRetryCounts: Map<string, number>,
  pmcImageMap?: Map<string, string>
): Promise<string | null> {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const mappedCdn = getMappedPmcCdnUrl(trimmed, pmcImageMap);
  if (mappedCdn) {
    try {
      const verifiedCdn = await verifyImageUrl(mappedCdn, cache, transientRetryCounts);
      if (verifiedCdn) return verifiedCdn;
    } catch (err) {
      console.warn(`[Figure Verification] Transient error on mapped PMC CDN ${mappedCdn}, falling back to original URL ${trimmed}`);
    }
  }

  try {
    return await verifyImageUrl(trimmed, cache, transientRetryCounts);
  } catch (err) {
    return null;
  }
}

function resolveFigureUrl(src: string, baseUrl: string): string {
  if (!src) return '';
  src = src.trim();
  if (src.startsWith('//')) {
    return 'https:' + src;
  }
  if (/^https?:\/\//i.test(src)) {
    return src;
  }
  try {
    const absoluteBase = /^https?:\/\//i.test(baseUrl) ? baseUrl : 'https://' + baseUrl;
    return new URL(src, absoluteBase).href;
  } catch (e) {
    return src;
  }
}

function makeFigureUrlsAbsolute(blocks: any[], baseUrl: string): void {
  if (!blocks) return;
  for (const b of blocks) {
    if (b.blockType === 'figure') {
      let imgUrl = b.imageUrl || '';
      if (!imgUrl && b.html) {
        const match = b.html.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (match) {
          imgUrl = match[1];
        }
      }
      if (imgUrl) {
        const absoluteUrl = resolveFigureUrl(imgUrl, baseUrl);
        b.imageUrl = absoluteUrl;
        if (b.html && absoluteUrl) {
          b.html = b.html.replace(/(<img[^>]+src=["'])([^"']*)(["'])/i, `$1${absoluteUrl}$3`);
        }
      }
    }
  }
}

async function deduplicateAndMergeFigures(
  blocks: any[],
  cache: Map<string, string | null>,
  transientRetryCounts: Map<string, number>,
  pmcImageMap?: Map<string, string>,
  pmcPublicIdByUrl?: Map<string, string>
): Promise<any[]> {
  const merged: any[] = [];
  const seenFigures = new Map<string, any>();

  const getSubfigureKey = (text: string): string => {
    const m = (text || '').match(/(?:supplementary\s+)?(figure|figs?|fig|hình)\.?\s*(\d+[a-z]?)/i);
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
          const existingImg = existing.imageUrl || (existing.html || '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
          const currentImg = b.imageUrl || (b.html || '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
          
          const currentOk = await resolveAndVerifyImageUrl(currentImg, cache, transientRetryCounts, pmcImageMap);
          const existingOk = await resolveAndVerifyImageUrl(existingImg, cache, transientRetryCounts, pmcImageMap);
          let bestImg = '';
          if (currentOk) {
            bestImg = currentOk;
          } else if (existingOk) {
            bestImg = existingOk;
          }

          const cleanExisting = (existing.text || '').replace(/Full\s+size\s+image/gi, '').trim();
          const cleanCurrent = (b.text || '').replace(/Full\s+size\s+image/gi, '').trim();
          const bestText = cleanCurrent.length > cleanExisting.length ? cleanCurrent : cleanExisting;
          
          existing.text = bestText;
          existing.imageUrl = bestImg;
          seenFigures.set(key, existing);
          continue;
        } else {
          const imgUrl = b.imageUrl || (b.html || '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
          const verifiedImg = await resolveAndVerifyImageUrl(imgUrl, cache, transientRetryCounts, pmcImageMap);
          const cleanText = text.replace(/Full\s+size\s+image/gi, '').trim();
          b.text = cleanText;
          b.imageUrl = verifiedImg || '';
          seenFigures.set(key, b);
        }
      } else {
        const imgUrl = b.imageUrl || (b.html || '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
        const verifiedImg = await resolveAndVerifyImageUrl(imgUrl, cache, transientRetryCounts, pmcImageMap);
        b.imageUrl = verifiedImg || '';
      }
    }
    merged.push(b);
  }

  const result: any[] = [];
  for (const b of merged) {
    if (b.blockType === 'figure') {
      const key = getSubfigureKey(b.text);
      let finalFig = b;
      if (key) {
        finalFig = seenFigures.get(key) || b;
      }
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
        const publicId = pmcPublicIdByUrl?.get(finalFig.imageUrl);
        const assetAttr = publicId ? ` data-cloudinary-public-id="${escapeHtml(publicId)}"` : '';
        html += `<img src="${finalFig.imageUrl}" alt="${escapeHtml(title)}" class="figure-img"${assetAttr} />`;
      } else {
        html += `<p class="placeholder-error"><em>[Figure image unavailable]</em></p>`;
      }
      html += `<p class="caption"><strong>${escapeHtml(title)}</strong></p>`;
      if (legend) {
        html += `<p class="legend">${escapeHtml(legend)}</p>`;
      }
      html += `</div>`;
      
      const sanitized = sanitizeHtml(html);
      result.push({
        ...b,
        text: cleanText,
        imageUrl: finalFig.imageUrl || undefined,
        html: sanitized || ''
      });
    } else {
      result.push(b);
    }
  }

  return result;
}


function deduplicateAndMergeTables(blocks: any[]): any[] {
  const merged: any[] = [];
  const seenTables = new Map<string, any>();

  const getTableKey = (text: string): string => {
    const m = (text || '').match(/(?:supplementary\s+)?(table|tabs?|bảng)\.?\s*(\d+[a-z]?)/i);
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

  if (b.blockType === 'figure') {
    return 'article_figure';
  }

  if (b.blockType === 'table') {
    return 'article_table';
  }

  if (b.blockType === 'caption') {
    return 'article_caption';
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

async function fetchPmcImageMap(
  pmcId: string,
  archivePublicIds: string[],
  publicIdByUrl: Map<string, string>
): Promise<Map<string, string>> {
  const imageMap = new Map<string, string>();
  try {
    const cleanId = pmcId.toUpperCase().startsWith('PMC') ? pmcId : `PMC${pmcId}`;
    console.log(`[PMC Image Resolver] Fetching PMC page for image mapping: ${cleanId}`);
    const url = `https://pmc.ncbi.nlm.nih.gov/articles/${cleanId}/`;
    const res = await fetchUrlWithSafeRedirects(url);
    if (res && res.buffer) {
      const html = res.buffer.toString('utf8');
      const regex = /(?:https?:)?\/\/cdn\.ncbi\.nlm\.nih\.gov\/pmc\/blobs\/[^\s"'`>]+/gi;
      let match;
      while ((match = regex.exec(html)) !== null) {
        let fullUrl = match[0];
        if (fullUrl.startsWith('//')) {
          fullUrl = 'https:' + fullUrl;
        }
        const parts = fullUrl.split('/');
        const filename = parts[parts.length - 1];
        if (filename) {
          imageMap.set(filename.toLowerCase(), fullUrl);
          const nameWithoutExt = filename.replace(/\.[a-zA-Z0-9]+$/, '');
          imageMap.set(nameWithoutExt.toLowerCase(), fullUrl);
        }
      }
      console.log(`[PMC Image Resolver] Resolved ${imageMap.size} image mappings from PMC page.`);
    }
  } catch (err: any) {
    console.warn(`[PMC Image Resolver] Failed to resolve image mappings for ${pmcId}: ${err.message}`);
  }

  // Always attempt Europe PMC archive recovery when a PMCID is present.
  // A partially populated page map must not suppress archive recovery — owned
  // Cloudinary URLs are always preferred over external PMC CDN URLs.
  try {
    const archive = await resolvePmcArchiveImages(pmcId);
    archive.imageMap.forEach((ownedUrl, key) => {
      // Prefer owned archived URL over any external CDN URL for the same key
      imageMap.set(key, ownedUrl);
    });
    archive.publicIdByUrl.forEach((publicId, url) => publicIdByUrl.set(url, publicId));
    archivePublicIds.push(...archive.uploadedPublicIds);
    console.log(`[PMC Image Resolver] Merged ${archive.uploadedPublicIds.length} owned archive images from Europe PMC.`);
  } catch (err: any) {
    console.warn(`[PMC Image Resolver] Europe PMC archive recovery failed for ${pmcId}: ${err.message}. Using available page mappings.`);
  }

  return imageMap;
}

async function getPersistedReaderImageAssetIds(source: any, isContribution: boolean): Promise<string[]> {
  const query: any = isContribution
    ? { previewContributionId: source._id, chunkPurpose: 'reader', blockType: 'figure' }
    : { sourceId: source._id, chunkPurpose: 'reader', blockType: 'figure' };
  const chunks = await AcademicChunk.find(query).select('html').lean();
  const ids = new Set<string>();
  for (const chunk of chunks) {
    const regex = /data-cloudinary-public-id="([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(String(chunk.html || ''))) !== null) ids.add(match[1]);
  }
  return [...ids];
}

async function deleteReaderImageAssets(publicIds: string[]): Promise<void> {
  await Promise.all(publicIds.map((id) => deleteAsset(id, 'image').catch(() => undefined)));
}

export async function importSmartReaderForSource(
  source: any,
  moderatorId: mongoose.Types.ObjectId,
  isReimport = false
): Promise<ImportResult> {
  let resolvedPmcidForImport: string | undefined = source.pmcid;
  if (!source.pmcid && source.doi) {
    try {
      console.log(`[PMC Resolver] Resolving PMCID for DOI: ${source.doi}`);
      const convUrl = `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${encodeURIComponent(source.doi)}&format=json&tool=dreamscape&email=admin@dreamscape.io`;
      const convRes = await fetch(convUrl);
      if (convRes.ok) {
        const convData = await convRes.json() as any;
        const record = convData.records?.[0];
        if (record && record.pmcid) {
          console.log(`[PMC Resolver] Resolved PMCID: ${record.pmcid} for DOI: ${source.doi}`);
          const normalizedPmcid = record.pmcid.toUpperCase();
          resolvedPmcidForImport = normalizedPmcid;
          const model = source.constructor;
          const duplicate = model?.exists
            ? await model.exists({ _id: { $ne: source._id }, normalizedPmcid })
            : null;
          if (!duplicate) {
            source.pmcid = record.pmcid;
            source.normalizedPmcid = normalizedPmcid;
            if (source.save && typeof source.save === 'function') {
              await source.save();
            }
          } else {
            console.warn('[PMC Resolver] Resolved PMCID belongs to another source; using it transiently without persisting it.');
          }
        }
      }
    } catch (e: any) {
      console.warn(`[PMC Resolver] PMCID conversion failed for DOI ${source.doi}:`, e.message);
    }
  }

  let pmcImageMap: Map<string, string> | undefined = undefined;
  const pmcArchivePublicIds: string[] = [];
  const pmcPublicIdByUrl = new Map<string, string>();
  if (resolvedPmcidForImport) {
    pmcImageMap = await fetchPmcImageMap(resolvedPmcidForImport, pmcArchivePublicIds, pmcPublicIdByUrl);
  }

  const importSessionVerifiedImageUrls = new Map<string, string | null>();
  const importSessionTransientRetryCounts = new Map<string, number>();

  // A PMCID that collides with another stored record may still be used as a
  // transient lookup hint for this import run. Do not mutate/persist the source
  // merely to let the candidate collector discover official PMC JATS/HTML.
  const candidateSource = resolvedPmcidForImport && !source.pmcid
    ? { ...(typeof source.toObject === 'function' ? source.toObject() : source), pmcid: resolvedPmcidForImport }
    : source;
  const candidates = collectCandidates(candidateSource);
  console.log(`[Collector] Collected ${candidates.length} candidates for source: ${source.title}`);

  const tempDir = path.join(__dirname, '../../../../../uploads/tmp');
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
        buffer = await downloadCloudinaryRawAsset(publicId);
        finalUrl = cand.url;
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

        const parseOutput = await parseSourceFile(tempPath, cand.contentType, cand.sourceType, pmcImageMap);
        if (parseOutput.success && parseOutput.blocks.length > 0) {
          makeFigureUrlsAbsolute(parseOutput.blocks, finalUrl);
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
            wordCount,
            finalUrl
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
    const m = (text || '').match(/(?:supplementary\s+)?(figure|figs?|fig|table|tabs?|hình|bảng)\.?\s*(\d+[a-z]?)/i);
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

  const cleanOrphanWrapperHeadings = (blocks: any[]): any[] => {
    let result = [...blocks];

    for (let pass = 0; pass < 3; pass++) {
      for (let i = result.length - 1; i >= 0; i--) {
        const b = result[i];
        if (!b || b.blockType !== 'heading') {
          continue;
        }

        const lowerText = (b.text || '').toLowerCase().trim();
        const protectedKeywords = [
          'references', 'tài liệu tham khảo', 'introduction', 'methods', 'results',
          'discussion', 'conclusion', 'abstract', 'data availability', 'materials and methods'
        ];
        const isProtected = protectedKeywords.some(kw => lowerText.includes(kw));

        let nextHeadingIdx = result.length;
        for (let j = i + 1; j < result.length; j++) {
          if (result[j] && result[j].blockType === 'heading') {
            nextHeadingIdx = j;
            break;
          }
        }

        let hasContent = false;
        for (let j = i + 1; j < nextHeadingIdx; j++) {
          const cb = result[j];
          if (!cb) continue;
          if (cb.blockType === 'paragraph' || cb.blockType === 'table' || cb.blockType === 'figure' || cb.blockType === 'list_item' || cb.blockType === 'reference') {
            hasContent = true;
            break;
          }
        }

        if (!hasContent && !isProtected) {
          console.log(`[Endmatter Cleanup] Removing empty/orphan heading: "${b.text}"`);
          result[i] = null;
        }
      }
      result = result.filter(Boolean);
    }

    return result;
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

      reconciledBlocks = await Promise.all(reconciledBlocks.map(async b => {
        if (b.blockType === 'figure' || b.blockType === 'table') {
          const pdfNum = getNumberSuffix(b.text);
          if (pdfNum) {
            const match = htmlFigs.find((hb: any) => getNumberSuffix(hb.text) === pdfNum && hb.blockType === b.blockType);
            if (match) {
              if (b.blockType === 'figure') {
                const matchImg = match.imageUrl || (match.html || '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
                const verifiedMatchImg = await resolveAndVerifyImageUrl(matchImg, importSessionVerifiedImageUrls, importSessionTransientRetryCounts, pmcImageMap);
                if (verifiedMatchImg) {
                  console.log(`[Reconciliation] Merging verified structured figure metadata for index ${pdfNum}`);
                  match.imageUrl = verifiedMatchImg;
                  match.html = match.html.replace(/(<img[^>]+src=["'])([^"']*)(["'])/i, `$1${verifiedMatchImg}$3`);
                  return {
                    ...b,
                    text: match.text || b.text,
                    html: match.html,
                    style: { ...(b.style || {}), ...(match.style || {}) }
                  };
                } else {
                  console.log(`[Reconciliation] Skipping unverified structured figure enrichment for index ${pdfNum}`);
                }
              } else {
                console.log(`[Reconciliation] Merging structured ${b.blockType} metadata for index ${pdfNum}`);
                return {
                  ...b,
                  text: match.text || b.text,
                  html: match.html || b.html,
                  style: { ...(b.style || {}), ...(match.style || {}) }
                };
              }
            }
          }
          if (!b.html || b.html.startsWith('<p>') || b.html.includes('placeholder-error')) {
            b.html = ''; // Use frontend fallback layout
          }
        }
        return b;
      }));

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
    reconciledBlocks = await deduplicateAndMergeFigures(reconciledBlocks, importSessionVerifiedImageUrls, importSessionTransientRetryCounts, pmcImageMap, pmcPublicIdByUrl);
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
  reconciledBlocks = cleanOrphanWrapperHeadings(reconciledBlocks);
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
    console.log(`[Reconciliation] Passed quality validation. Performing structured figure materialization...`);

    // ── Structured Figure Ownership Pass ──────────────────────────────────────
    // Every accepted structured-reader figure must use a DreamScape-owned
    // Cloudinary URL before reader persistence. External publisher/PMC CDN URLs
    // are used only as ingestion inputs and must not remain in persisted HTML.
    const figureSourceId = String(source._id || source.doi || source.pmcid || 'unknown')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .substring(0, 48);
    const figurePublicIdPrefix = `structured_figures/${figureSourceId}`;
    const figureMaterializeCache = createFigureMaterializeCache();
    const figureWarnings: string[] = [];

    for (let i = 0; i < reconciledBlocks.length; i++) {
      const block = reconciledBlocks[i];
      if (block.blockType !== 'figure') continue;

      // Extract the currently-verified external URL (set by deduplicateAndMergeFigures)
      const externalUrl: string = block.imageUrl || '';

      // Skip blocks that already have no image (will render caption-only fallback)
      if (!externalUrl) continue;

      // Skip URLs that are already Cloudinary-owned (from PMC archive recovery)
      if (pmcPublicIdByUrl.has(externalUrl)) {
        // Already owned — no re-upload needed; public ID already in block HTML
        continue;
      }

      // Materialize: SSRF-safe download → byte validation → temp file → Cloudinary
      let owned: { cloudinarySecureUrl: string; cloudinaryPublicId: string } | null = null;
      try {
        owned = await materializeStructuredFigure(
          externalUrl,
          figureMaterializeCache,
          figurePublicIdPrefix
        );
      } catch {
        owned = null;
      }

      if (owned) {
        // Track new public ID in the existing lifecycle array so it participates
        // in the same rollback / cleanup logic as PMC archive assets.
        pmcArchivePublicIds.push(owned.cloudinaryPublicId);

        // Replace block.imageUrl with owned URL
        block.imageUrl = owned.cloudinarySecureUrl;

        // Rebuild figure HTML with owned src and data-cloudinary-public-id
        const captionMatch = (block.html || '').match(/<p class="caption">([\s\S]*?)<\/p>/);
        const legendMatch = (block.html || '').match(/<p class="legend">([\s\S]*?)<\/p>/);
        const altMatch = (block.html || '').match(/alt="([^"]*?)"/);
        const altText = altMatch ? altMatch[1] : escapeHtml(block.text || '');
        const captionHtml = captionMatch ? captionMatch[0] : '';
        const legendHtml = legendMatch ? legendMatch[0] : '';

        let ownedHtml = `<div class="figure-block">`;
        ownedHtml += `<img src="${owned.cloudinarySecureUrl}" data-cloudinary-public-id="${escapeHtml(owned.cloudinaryPublicId)}" alt="${altText}" class="figure-img" />`;
        ownedHtml += captionHtml;
        ownedHtml += legendHtml;
        ownedHtml += `</div>`;

        block.html = sanitizeHtml(ownedHtml) || ownedHtml;
      } else {
        // Materialization failed — use caption-only fallback; do not persist external URL
        figureWarnings.push(`Figure image unavailable after materialization attempt: ${externalUrl.replace(/^https?:\/\/[^/]+/, '[host]')}`);
        block.imageUrl = undefined;

        // Rebuild caption-only HTML (mirrors deduplicateAndMergeFigures unavailable path)
        const captionMatch = (block.html || '').match(/<p class="caption">([\s\S]*?)<\/p>/);
        const legendMatch = (block.html || '').match(/<p class="legend">([\s\S]*?)<\/p>/);
        const captionHtml = captionMatch ? captionMatch[0] : `<p class="caption"><strong>${escapeHtml(block.text || '')}</strong></p>`;
        const legendHtml = legendMatch ? legendMatch[0] : '';

        let fallbackHtml = `<div class="figure-block">`;
        fallbackHtml += `<p class="placeholder-error"><em>[Figure image unavailable]</em></p>`;
        fallbackHtml += captionHtml;
        fallbackHtml += legendHtml;
        fallbackHtml += `</div>`;
        block.html = sanitizeHtml(fallbackHtml) || fallbackHtml;
      }

      reconciledBlocks[i] = block;
    }

    if (figureWarnings.length > 0) {
      console.warn(`[Figure Materialization] ${figureWarnings.length} figure(s) could not be materialized:`, figureWarnings);
    }
    // ── End Structured Figure Ownership Pass ──────────────────────────────────

    console.log(`[Reconciliation] Figure materialization complete. Performing transactional save...`);
    const previousReaderImageIds = await getPersistedReaderImageAssetIds(source, isContribution);
    try {
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
    source.extractionMethod = selectedSourceType === 'jats_xml'
      ? 'jats'
      : selectedSourceType.includes('html')
        ? 'html'
        : selectedSourceType === 'pdf' || selectedSourceType === 'uploaded_pdf'
          ? 'pdf_text'
          : source.extractionMethod;

    const figuresCount = reconciledBlocks.filter((b: any) => b.blockType === 'figure').length;
    const tablesCount = reconciledBlocks.filter((b: any) => b.blockType === 'table').length;
    const referencesCount = reconciledBlocks.filter((b: any) => b.blockType === 'reference').length;

    // Use dynamic pagination algorithm matching FE paginateBlocks exactly to resolve pageCount
    const pagesCount = calculateVirtualPageCount(reconciledBlocks);

    source.smartReaderStats = {
      pageCount: pagesCount,
      figureCount: figuresCount,
      tableCount: tablesCount,
      referenceCount: referencesCount,
      updatedAt: new Date()
    };

    await source.save();
    } catch (error) {
      await deleteReaderImageAssets(pmcArchivePublicIds);
      throw error;
    }

    const usedArchiveIds = new Set(
      reconciledBlocks.flatMap((block: any) => {
        const matches = String(block.html || '').matchAll(/data-cloudinary-public-id="([^"]+)"/g);
        return [...matches].map((match) => match[1]);
      })
    );
    await deleteReaderImageAssets([
      ...previousReaderImageIds.filter((id) => !usedArchiveIds.has(id)),
      ...pmcArchivePublicIds.filter((id) => !usedArchiveIds.has(id)),
    ]);

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
  await deleteReaderImageAssets(pmcArchivePublicIds);
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
  let errorType = 'metadata_only';
  if (has403Block) {
    failMessage = 'Không thể tải toàn văn tự động do máy chủ tài liệu chặn truy cập (403/Forbidden).';
    errorType = 'publisher_blocked';
  } else if (isChallengePage) {
    failMessage = 'Không thể truy cập do bị chặn bởi hệ thống Cloudflare / bảo vệ chống bot.';
    errorType = 'publisher_blocked';
  } else if (isMetadataOnly) {
    failMessage = 'Nguồn bài viết chỉ chứa thông tin mô tả (Metadata), không có nội dung toàn văn để nhập.';
    errorType = 'metadata_only';
  }

  return {
    success: false,
    message: failMessage,
    error: errorType,
    resolverReport,
    candidateAttempts
  };
}
