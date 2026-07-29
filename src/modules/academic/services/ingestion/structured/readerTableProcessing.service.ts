import * as cheerio from 'cheerio';
import { fetchUrlWithSafeRedirects } from '../../../../../infrastructure/security/ssrfGuard';
import { escapeReaderHtml, sanitizeReaderHtml } from './readerHtml.service';

function tableNumber(text: string): string {
  return String(text || '').match(/(?:supplementary\s+)?(table|tabs?|bảng)\.?\s*(\d+[a-z]?)/i)?.[2]?.toLowerCase() || '';
}

async function fetchNatureTableHtml(tableLink: string, baseUrl: string): Promise<string> {
  try {
    const finalBase = baseUrl.includes('nature.com') && !baseUrl.includes('doi.org')
      ? baseUrl
      : 'https://www.nature.com';
    const response = await fetchUrlWithSafeRedirects(new URL(tableLink, finalBase).href);
    const table = cheerio.load(response.buffer.toString())('table').first();
    return table.length > 0 ? sanitizeReaderHtml(table.toString()) : '';
  } catch (error: any) {
    console.warn(`[Reimport Table] Failed to fetch table HTML: ${error.message}`);
    return '';
  }
}

export async function hydrateLinkedTables(
  blocks: any[],
  sourceType: string,
  sourceUrl?: string,
): Promise<void> {
  if (!['generic_html', 'publisher_html'].includes(sourceType)) return;
  for (const block of blocks) {
    if (
      block.blockType !== 'table'
      || !tableNumber(block.text)
      || !block.tableLink
      || (block.tableHtmlContent && block.tableHtmlContent.length >= 50)
    ) {
      continue;
    }
    const html = await fetchNatureTableHtml(
      block.tableLink,
      sourceUrl || 'https://www.nature.com/articles/s41398-023-02637-6',
    );
    if (html) block.tableHtmlContent = html;
  }
}

export function deduplicateAndFormatTables(blocks: any[]): any[] {
  const merged: any[] = [];
  const seen = new Map<string, any>();

  for (const block of blocks) {
    if (block.blockType === 'table') {
      const key = tableNumber(block.text);
      if (key) {
        const existing = seen.get(key);
        if (existing) {
          const existingTable = existing.tableHtmlContent
            || String(existing.html || '').match(/<table[^>]*>([\s\S]*?)<\/table>/i)?.[0]
            || '';
          const currentTable = block.tableHtmlContent
            || String(block.html || '').match(/<table[^>]*>([\s\S]*?)<\/table>/i)?.[0]
            || '';
          const oldText = String(existing.text || '').replace(/Full\s+size\s+table/gi, '').trim();
          const newText = String(block.text || '').replace(/Full\s+size\s+table/gi, '').trim();
          existing.text = newText.length > oldText.length ? newText : oldText;
          existing.tableHtmlContent = currentTable || existingTable;
          existing.tableLink = block.tableLink || existing.tableLink;
          continue;
        }
        block.text = String(block.text || '').replace(/Full\s+size\s+table/gi, '').trim();
        block.tableHtmlContent = String(block.html || '').match(/<table[^>]*>([\s\S]*?)<\/table>/i)?.[0]
          || block.tableHtmlContent;
        seen.set(key, block);
      }
    }
    merged.push(block);
  }

  return merged.map(block => {
    if (block.blockType !== 'table') return block;
    const finalTable = seen.get(tableNumber(block.text));
    if (!finalTable) return block;
    const text = String(finalTable.text || '')
      .replace(/BẢNG\s+SỐ\s+LIỆU/gi, '')
      .replace(/Full\s+size\s+table/gi, '')
      .trim();
    if (!finalTable.tableHtmlContent) return { ...block, text, html: '' };
    const html = sanitizeReaderHtml(
      `<div class="table-block"><p class="caption"><strong>${escapeReaderHtml(text)}</strong></p>`
      + `<div class="table-wrapper">${finalTable.tableHtmlContent}</div></div>`,
    );
    return { ...block, text, html: html || '' };
  });
}
