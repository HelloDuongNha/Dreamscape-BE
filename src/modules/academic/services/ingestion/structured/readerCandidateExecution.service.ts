import fs from 'fs';
import path from 'path';
import type { FullTextCandidate } from '../../types/canonical.types';
import { fetchUrlWithSafeRedirects } from '../../../../../infrastructure/security/ssrfGuard';
import { downloadOriginalPdfAsset } from '../../storage/originalPdfStorage.service';
import { normalizeDocument } from './documentNormalizer.service';
import { parseSourceFile } from './smartReaderParser.service';
import { validateQuality } from './qualityValidator';

interface CandidateGroups {
  pdf: FullTextCandidate[];
  xml: FullTextCandidate[];
  publisherHtml: FullTextCandidate[];
  genericHtml: FullTextCandidate[];
}

interface CandidateAttempt {
  url: string;
  sourceType: string;
  contentType: string;
  status: 'success' | 'failed';
  wordCount?: number;
  headingCount?: number;
  overallScore?: number;
  error?: string;
}

function resolveFigureUrl(src: string, baseUrl: string): string {
  const trimmed = String(src || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const absoluteBase = /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`;
    return new URL(trimmed, absoluteBase).href;
  } catch {
    return trimmed;
  }
}

function makeFigureUrlsAbsolute(blocks: any[], baseUrl: string): void {
  for (const block of blocks || []) {
    if (block.blockType !== 'figure') continue;
    let imageUrl = block.imageUrl || '';
    if (!imageUrl && block.html) {
      imageUrl = block.html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
    }
    if (!imageUrl) continue;
    const absoluteUrl = resolveFigureUrl(imageUrl, baseUrl);
    block.imageUrl = absoluteUrl;
    if (block.html && absoluteUrl) {
      block.html = block.html.replace(
        /(<img[^>]+src=["'])([^"']*)(["'])/i,
        `$1${absoluteUrl}$3`,
      );
    }
  }
}

async function parseCandidate(input: {
  candidate: FullTextCandidate;
  source: any;
  tempDir: string;
  pmcImageMap?: Map<string, string>;
  attempts: CandidateAttempt[];
}): Promise<{ parsed: any; blockedBy403: boolean }> {
  const { candidate, source, tempDir, pmcImageMap, attempts } = input;
  let tempPath = '';
  const startedAt = Date.now();
  try {
    console.log(`[Reimport] Downloading candidate: sourceType=${candidate.sourceType}, url=${candidate.url}`);
    let downloaded: { buffer: Buffer; finalUrl: string };
    if (candidate.sourceType === 'uploaded_pdf') {
      if (!source.originalFile) throw new Error('Missing storage reference for uploaded PDF');
      downloaded = {
        buffer: await downloadOriginalPdfAsset(source.originalFile),
        finalUrl: candidate.url,
      };
    } else {
      downloaded = await fetchUrlWithSafeRedirects(candidate.url);
    }

    if (!downloaded.buffer?.length) throw new Error('Empty response or no parsed blocks');

    const extension = candidate.contentType === 'pdf'
      ? '.pdf'
      : candidate.contentType === 'xml'
        ? '.xml'
        : '.html';
    tempPath = path.join(
      tempDir,
      `import_${Date.now()}_${Math.random().toString(36).substring(2, 10)}${extension}`,
    );
    fs.writeFileSync(tempPath, downloaded.buffer);

    const output = await parseSourceFile(
      tempPath,
      candidate.contentType,
      candidate.sourceType,
      pmcImageMap,
    );
    if (!output.success || output.blocks.length === 0) {
      throw new Error('Empty response or no parsed blocks');
    }

    makeFigureUrlsAbsolute(output.blocks, downloaded.finalUrl);
    const normalized = normalizeDocument(output.blocks, source.title || output.title);
    const report = validateQuality(
      { ...output, blocks: normalized },
      output.parserEngine,
      candidate.sourceType,
      candidate.sourceType === 'pdf',
      Date.now() - startedAt,
    );
    const wordCount = normalized.reduce(
      (total, block) => total + String(block.text || '').split(/\s+/).filter(Boolean).length,
      0,
    );
    const headingCount = normalized.filter(block => block.blockType === 'heading').length;
    attempts.push({
      url: candidate.url,
      sourceType: candidate.sourceType,
      contentType: candidate.contentType,
      status: 'success',
      wordCount,
      headingCount,
      overallScore: report.overallScore,
    });
    return {
      parsed: {
        blocks: normalized,
        parserEngine: output.parserEngine,
        sourceType: candidate.sourceType,
        title: output.title || source.title,
        report,
        wordCount,
        finalUrl: downloaded.finalUrl,
      },
      blockedBy403: false,
    };
  } catch (error: any) {
    const message = error?.message || String(error);
    console.warn(`[Reimport] Failed candidate parse: ${candidate.url} - ${message}`);
    attempts.push({
      url: candidate.url,
      sourceType: candidate.sourceType,
      contentType: candidate.contentType,
      status: 'failed',
      error: message,
    });
    return { parsed: null, blockedBy403: message.includes('403') };
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
    }
  }
}

async function firstParsedCandidate(input: {
  candidates: FullTextCandidate[];
  source: any;
  tempDir: string;
  pmcImageMap?: Map<string, string>;
  attempts: CandidateAttempt[];
}): Promise<{ parsed: any; blockedBy403: boolean }> {
  let blockedBy403 = false;
  for (const candidate of input.candidates) {
    const result = await parseCandidate({ ...input, candidate });
    blockedBy403 ||= result.blockedBy403;
    if (result.parsed) return { parsed: result.parsed, blockedBy403 };
  }
  return { parsed: null, blockedBy403 };
}

export async function executeReaderCandidates(input: {
  groups: CandidateGroups;
  source: any;
  pmcImageMap?: Map<string, string>;
}) {
  const tempDir = path.join(__dirname, '../../../../../uploads/tmp');
  fs.mkdirSync(tempDir, { recursive: true });
  const attempts: CandidateAttempt[] = [];
  let blockedBy403 = false;

  const run = async (candidates: FullTextCandidate[]) => {
    const result = await firstParsedCandidate({
      candidates,
      source: input.source,
      tempDir,
      pmcImageMap: input.pmcImageMap,
      attempts,
    });
    blockedBy403 ||= result.blockedBy403;
    return result.parsed;
  };

  const parsedPdf = await run(input.groups.pdf);
  const parsedXml = await run(input.groups.xml);
  let parsedHtml = await run(input.groups.publisherHtml);
  if (!parsedXml && !parsedHtml) parsedHtml = await run(input.groups.genericHtml);

  return { parsedPdf, parsedXml, parsedHtml, candidateAttempts: attempts, has403Block: blockedBy403 };
}
