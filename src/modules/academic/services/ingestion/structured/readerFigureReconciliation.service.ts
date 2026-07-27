import { fetchUrlWithSafeRedirects } from '../../../../../infrastructure/security/ssrfGuard';
import { escapeReaderHtml, sanitizeReaderHtml } from './readerHtml.service';

function isSvgBuffer(buffer: Buffer): boolean {
  const text = buffer.toString('utf8').trim().toLowerCase();
  return text.includes('<svg')
    && !text.includes('<html')
    && !text.includes('<body')
    && !text.includes('<!doctype html');
}

function hasRecognizedImageBytes(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 4) return false;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer.length >= 6) {
    const gifSignature = buffer.toString('ascii', 0, 6);
    if (gifSignature === 'GIF89a' || gifSignature === 'GIF87a') return true;
  }
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) return true;
  return isSvgBuffer(buffer);
}

function isTerminalImageError(error: any): boolean {
  if (!error) return false;
  if (error.name === 'SsrfError' || error.message?.includes('SSRF')) return true;

  const message = String(error.message || '').toLowerCase();
  return ['404', '400', '401', '403', '15mb', 'không phải pdf', 'chuyển hướng']
    .some((marker) => message.includes(marker));
}

async function verifyImageUrl(
  url: string,
  cache: Map<string, string | null>,
  transientRetryCounts: Map<string, number>,
): Promise<string | null> {
  const trimmed = url.trim();
  if (cache.has(trimmed)) return cache.get(trimmed)!;

  try {
    const response = await fetchUrlWithSafeRedirects(trimmed);
    if (!response?.buffer?.length) {
      cache.set(trimmed, null);
      return null;
    }

    const contentType = (response.contentType || '').toLowerCase();
    if (contentType.includes('html') || contentType.includes('json')) {
      if (contentType.includes('xml') && isSvgBuffer(response.buffer)) {
        cache.set(trimmed, response.finalUrl);
        return response.finalUrl;
      }
      cache.set(trimmed, null);
      return null;
    }

    const isImageType = contentType.startsWith('image/');
    const isGenericType = !contentType
      || contentType === 'application/octet-stream'
      || contentType === 'text/plain'
      || contentType === 'application/xml';
    const isValid = isImageType
      ? (!contentType.includes('svg') || isSvgBuffer(response.buffer))
      : isGenericType && hasRecognizedImageBytes(response.buffer);

    if (isValid) {
      if (contentType.includes('svg') || isSvgBuffer(response.buffer)) {
        const text = response.buffer.toString('utf8').trim().toLowerCase();
        if (text.includes('<html') || text.includes('<body')) {
          cache.set(trimmed, null);
          return null;
        }
      }
      cache.set(trimmed, response.finalUrl);
      return response.finalUrl;
    }

    cache.set(trimmed, null);
    return null;
  } catch (error: any) {
    if (isTerminalImageError(error)) {
      console.warn(`[Figure Verification] Terminal error for ${trimmed}: ${error.message}`);
      cache.set(trimmed, null);
      return null;
    }

    const attempt = (transientRetryCounts.get(trimmed) || 0) + 1;
    transientRetryCounts.set(trimmed, attempt);
    console.warn(`[Figure Verification] Transient failure for ${trimmed} (attempt ${attempt}/3): ${error.message}`);
    if (attempt >= 3) {
      console.warn(`[Figure Verification] Retry limit exceeded for ${trimmed}. Promoting to terminal failure.`);
      cache.set(trimmed, null);
      return null;
    }
    throw error;
  }
}

function getMappedPmcUrl(url: string, pmcImageMap?: Map<string, string>): string | null {
  if (!pmcImageMap?.size) return null;
  const filename = url.split('/').pop() || '';
  const normalizedFilename = filename.toLowerCase();
  const nameWithoutExtension = filename.replace(/\.[a-zA-Z0-9]+$/, '').toLowerCase();
  return pmcImageMap.get(normalizedFilename) || pmcImageMap.get(nameWithoutExtension) || null;
}

export async function resolveReaderImageUrl(
  url: string | undefined,
  cache: Map<string, string | null>,
  transientRetryCounts: Map<string, number>,
  pmcImageMap?: Map<string, string>,
): Promise<string | null> {
  const trimmed = url?.trim();
  if (!trimmed) return null;

  const mappedUrl = getMappedPmcUrl(trimmed, pmcImageMap);
  if (mappedUrl) {
    try {
      const verifiedUrl = await verifyImageUrl(mappedUrl, cache, transientRetryCounts);
      if (verifiedUrl) return verifiedUrl;
    } catch {
      console.warn(`[Figure Verification] Transient error on mapped PMC CDN ${mappedUrl}, falling back to original URL ${trimmed}`);
    }
  }

  try {
    return await verifyImageUrl(trimmed, cache, transientRetryCounts);
  } catch {
    return null;
  }
}

function getFigureImageUrl(block: any): string {
  return block.imageUrl || String(block.html || '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
}

function getFigureKey(text: string): string {
  const match = (text || '').match(/(?:supplementary\s+)?(figure|figs?|fig|hình)\.?\s*(\d+[a-z]?)/i);
  return match ? match[2].toLowerCase() : '';
}

export async function reconcileReaderFigures(
  blocks: any[],
  cache: Map<string, string | null>,
  transientRetryCounts: Map<string, number>,
  pmcImageMap?: Map<string, string>,
  pmcPublicIdByUrl?: Map<string, string>,
): Promise<any[]> {
  const merged: any[] = [];
  const seenFigures = new Map<string, any>();

  for (const block of blocks) {
    if (block.blockType === 'figure') {
      const key = getFigureKey(block.text || '');
      const existing = key ? seenFigures.get(key) : undefined;
      if (existing) {
        console.log(`[Reconciliation] Merging duplicate figure block for key: ${key}`);
        const currentUrl = await resolveReaderImageUrl(
          getFigureImageUrl(block),
          cache,
          transientRetryCounts,
          pmcImageMap,
        );
        const existingUrl = await resolveReaderImageUrl(
          getFigureImageUrl(existing),
          cache,
          transientRetryCounts,
          pmcImageMap,
        );
        const existingText = String(existing.text || '').replace(/Full\s+size\s+image/gi, '').trim();
        const currentText = String(block.text || '').replace(/Full\s+size\s+image/gi, '').trim();
        existing.text = currentText.length > existingText.length ? currentText : existingText;
        existing.imageUrl = currentUrl || existingUrl || '';
        continue;
      }

      if (key) {
        block.text = String(block.text || '').replace(/Full\s+size\s+image/gi, '').trim();
      }
      block.imageUrl = await resolveReaderImageUrl(
        getFigureImageUrl(block),
        cache,
        transientRetryCounts,
        pmcImageMap,
      ) || '';
      if (key) seenFigures.set(key, block);
    }
    merged.push(block);
  }

  return merged.map((block) => {
    if (block.blockType !== 'figure') return block;

    const key = getFigureKey(block.text);
    const figure = key ? seenFigures.get(key) || block : block;
    const text = String(figure.text || '')
      .replace(/HÌNH\s+ẢNH\s*\/\s*BIỂU\s+ĐỒ/gi, '')
      .replace(/Full\s+size\s+image/gi, '')
      .trim();
    const sentences = text.split(/(?<=\.)\s+(?=[A-Z\d©])/);
    if (sentences[0]?.match(/^(fig|figure|hinh|hình)\.?$/i) && sentences[1]) {
      sentences[0] += ` ${sentences[1]}`;
      sentences.splice(1, 1);
    }

    const title = sentences[0] || '';
    const legend = sentences.slice(1).join(' ') || '';
    let html = '<div class="figure-block">';
    if (figure.imageUrl) {
      const publicId = pmcPublicIdByUrl?.get(figure.imageUrl);
      const assetAttribute = publicId
        ? ` data-cloudinary-public-id="${escapeReaderHtml(publicId)}"`
        : '';
      html += `<img src="${figure.imageUrl}" alt="${escapeReaderHtml(title)}" class="figure-img"${assetAttribute} />`;
    } else {
      html += '<p class="placeholder-error"><em>[Figure image unavailable]</em></p>';
    }
    html += `<p class="caption"><strong>${escapeReaderHtml(title)}</strong></p>`;
    if (legend) html += `<p class="legend">${escapeReaderHtml(legend)}</p>`;
    html += '</div>';

    return {
      ...block,
      text,
      imageUrl: figure.imageUrl || undefined,
      html: sanitizeReaderHtml(html) || '',
    };
  });
}
