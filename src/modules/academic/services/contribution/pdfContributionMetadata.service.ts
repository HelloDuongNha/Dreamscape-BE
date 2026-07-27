import fs from 'fs';
import { PDFParse } from 'pdf-parse';
import { normalizeDoi } from '../source/openAccess.service';
import { resolveSourceImport } from '../source/sourceImportResolver.service';

export function extractDoiFromText(text: string): string | null {
  const match = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi.exec(text);
  if (!match) return null;
  let doi = match[0];
  while (doi && /[.,;:)\]!?'"\s/]$/.test(doi)) doi = doi.slice(0, -1);
  return doi || null;
}

export function isFilenameLike(title: string, filename: string): boolean {
  if (!title) return true;
  const cleanTitle = title.trim().toLowerCase();
  const cleanFilename = filename.trim().toLowerCase();
  return cleanTitle.endsWith('.pdf')
    || cleanTitle === cleanFilename
    || cleanTitle === cleanFilename.replace(/\.[^/.]+$/, '')
    || (/^[a-zA-Z0-9_-]+$/.test(cleanTitle) && cleanTitle.length > 5);
}

export async function inspectPdfMetadata(filePath: string) {
  try {
    const parser = new PDFParse({ data: fs.readFileSync(filePath) });
    const parsedText = await parser.getText({ first: 2 });
    const info = await parser.getInfo().catch(() => null) as any;
    return {
      detectedDoi: extractDoiFromText(parsedText.text || ''),
      metadataTitle: String(info?.Title || info?.title || '').trim() || null,
    };
  } catch (error: any) {
    console.warn('Lightweight PDF parsing failed:', error.message || error);
    return { detectedDoi: null, metadataTitle: null };
  }
}

export async function resolvePdfContributionMetadata(
  body: any,
  detectedDoi: string | null,
  userId: any,
) {
  const bodyDoi = typeof body?.doi === 'string' ? body.doi.trim() : '';
  const finalDoi = (bodyDoi || detectedDoi || '').trim();
  if (!finalDoi) return { finalDoi: '', resolvedMeta: null };

  const cleanDoi = normalizeDoi(finalDoi);
  try {
    const resolvedMeta = await resolveSourceImport({ doi: cleanDoi }, userId);
    return {
      finalDoi: cleanDoi,
      resolvedMeta: resolvedMeta?.title ? resolvedMeta : null,
    };
  } catch (error) {
    console.warn('Failed to resolve DOI metadata:', error);
    return { finalDoi: cleanDoi, resolvedMeta: null };
  }
}
