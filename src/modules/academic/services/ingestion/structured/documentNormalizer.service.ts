import { CanonicalBlock } from '../../types/canonical.types';

export function normalizeDocument(blocks: CanonicalBlock[], articleTitle: string): CanonicalBlock[] {
  if (blocks.length === 0) return [];

  const normalized: CanonicalBlock[] = [];
  let currentSectionHeading: string | null = null;
  let orderCounter = 0;

  // Ensure Title block is present at index 0
  const hasTitle = blocks.some(b => b.blockType === 'title');
  if (!hasTitle) {
    normalized.push({
      blockType: 'title',
      semanticType: 'title',
      sectionHeading: null,
      text: articleTitle,
      html: `<h1>${escapeHtml(articleTitle)}</h1>`,
      order: orderCounter++
    });
  }

  for (const b of blocks) {
    let cleanText = b.text.trim();
    if (!cleanText) continue;

    const cleanTextLower = cleanText.toLowerCase();
    const genericNoise = [
      'enable javascript', 'cookie policy', 'privacy policy', 'terms of use',
      'verify you are human', 'cloudflare', 'ddos protection',
      'sign in to your account', 'log in to', 'subscribe to',
      'copyright ©', 'view author information', 'view article impact',
      'associated content'
    ];

    const isNoise = genericNoise.some(n => cleanTextLower.includes(n)) && cleanText.length < 300;
    if (isNoise) continue;

    if (b.blockType === 'heading') {
      currentSectionHeading = cleanText;
    }

    let markerVal = b.marker || undefined;
    let cleanHtml = b.html.trim();

    if (b.blockType === 'list_item') {
      const match = cleanText.match(/^(\([a-zA-Z0-9]+\)|[a-zA-Z0-9]+\.)\s+(.*)$/);
      if (match) {
        markerVal = match[1];
        cleanText = match[2].trim();
        cleanHtml = `<li>${escapeHtml(cleanText)}</li>`;
      } else if (!markerVal || markerVal === '•' || markerVal === 'bullet') {
        markerVal = '-';
      }
    }

    normalized.push({
      blockType: b.blockType,
      semanticType: b.semanticType,
      sectionHeading: b.sectionHeading || currentSectionHeading,
      text: cleanText,
      html: cleanHtml,
      marker: markerVal,
      pageNumber: b.pageNumber,
      order: orderCounter++,
      tableLink: (b as any).tableLink,
      tableHtmlContent: (b as any).tableHtmlContent,
      imageUrl: (b as any).imageUrl
    });
  }

  return normalized;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
