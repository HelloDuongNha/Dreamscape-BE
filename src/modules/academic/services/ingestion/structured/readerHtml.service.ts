import * as cheerio from 'cheerio';

export function escapeReaderHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function sanitizeReaderHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  try {
    const $ = cheerio.load(rawHtml, null, false);
    const allowedTags = new Set([
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'p', 'span', 'strong',
      'em', 'sup', 'sub', 'img', 'a', 'div', 'h1', 'h2', 'h3', 'h4',
      'ul', 'ol', 'li',
    ]);
    const allowedAttributes: Record<string, Set<string>> = {
      img: new Set(['src', 'alt', 'class', 'data-cloudinary-public-id']),
      a: new Set(['href', 'target', 'rel', 'class']),
      td: new Set(['colspan', 'rowspan']),
      th: new Set(['colspan', 'rowspan']),
      div: new Set(['class']),
      table: new Set(['class']),
      p: new Set(['class']),
      span: new Set(['class']),
    };

    $('*').each((_, element) => {
      const node = $(element);
      const tagName = (element as any).tagName?.toLowerCase();
      if (!tagName) return;
      if (!allowedTags.has(tagName)) {
        if (['script', 'style', 'iframe', 'object', 'embed'].includes(tagName)) node.remove();
        else node.replaceWith(node.text());
        return;
      }

      const allowed = allowedAttributes[tagName] || new Set<string>();
      for (const [name, value = ''] of Object.entries((element as any).attribs || {})) {
        if (!allowed.has(name) || name.startsWith('on') || String(value).toLowerCase().includes('javascript:')) {
          node.removeAttr(name);
          continue;
        }
        if (
          (name === 'src' || name === 'href')
          && !/^(https?:)?\/\//i.test(String(value))
          && !String(value).startsWith('/')
          && !String(value).startsWith('.')
        ) {
          node.removeAttr(name);
        }
      }
    });
    return $.html();
  } catch (error) {
    console.error('[Sanitizer] Failed to sanitize reader HTML:', error);
    return '';
  }
}
