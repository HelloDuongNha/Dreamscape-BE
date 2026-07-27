import {
  createFigureMaterializeCache,
  materializeStructuredFigure,
} from './structuredFigureAsset.service';
import { escapeReaderHtml, sanitizeReaderHtml } from './readerHtml.service';

export async function materializeReaderFigures(input: {
  blocks: any[];
  sourceKey: unknown;
  alreadyOwned: Map<string, string>;
  newAssetIds: string[];
}): Promise<void> {
  const sourceId = String(input.sourceKey || 'unknown')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .substring(0, 48);
  const cache = createFigureMaterializeCache();
  const warnings: string[] = [];

  for (const block of input.blocks) {
    if (block.blockType !== 'figure' || !block.imageUrl || input.alreadyOwned.has(block.imageUrl)) continue;
    const externalUrl = String(block.imageUrl);
    const owned = await materializeStructuredFigure(
      externalUrl,
      cache,
      `structured_figures/${sourceId}`,
    );
    const existingCaption = String(block.html || '').match(/<p class="caption">([\s\S]*?)<\/p>/)?.[0] || '';
    const legend = String(block.html || '').match(/<p class="legend">([\s\S]*?)<\/p>/)?.[0] || '';

    if (owned) {
      input.newAssetIds.push(owned.cloudinaryPublicId);
      block.imageUrl = owned.cloudinarySecureUrl;
      const alt = String(block.html || '').match(/alt="([^"]*?)"/)?.[1]
        || escapeReaderHtml(block.text || '');
      const html = `<div class="figure-block"><img src="${owned.cloudinarySecureUrl}" `
        + `data-cloudinary-public-id="${escapeReaderHtml(owned.cloudinaryPublicId)}" `
        + `alt="${alt}" class="figure-img" />${existingCaption}${legend}</div>`;
      block.html = sanitizeReaderHtml(html) || html;
      continue;
    }

    warnings.push(externalUrl.replace(/^https?:\/\/[^/]+/, '[host]'));
    block.imageUrl = undefined;
    const caption = existingCaption
      || `<p class="caption"><strong>${escapeReaderHtml(block.text || '')}</strong></p>`;
    const fallback = '<div class="figure-block">'
      + '<p class="placeholder-error"><em>[Figure image unavailable]</em></p>'
      + `${caption}${legend}</div>`;
    block.html = sanitizeReaderHtml(fallback) || fallback;
  }

  if (warnings.length) {
    console.warn(`[Figure Materialization] ${warnings.length} figure(s) could not be materialized:`, warnings);
  }
}
