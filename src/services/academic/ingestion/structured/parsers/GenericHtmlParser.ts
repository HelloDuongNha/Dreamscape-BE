import * as cheerio from 'cheerio';
import { CanonicalBlocksOutput, CanonicalBlock } from '../../../types/canonical.types';
import { cleanReferenceText } from './FrontiersHtmlParser';

export function parseGenericHtml(htmlText: string): CanonicalBlocksOutput {
  const blocks: CanonicalBlock[] = [];
  const warnings: string[] = [];
  let title = 'Untitled Web Article';
  let order = 0;

  try {
    const $ = cheerio.load(htmlText);

    // 1. Title Extraction
    const articleTitle = $('h1, title').first().text().trim();
    if (articleTitle) {
      title = articleTitle;
      blocks.push({
        blockType: 'title',
        semanticType: 'title',
        sectionHeading: null,
        text: title,
        html: `<h1>${escapeHtml(title)}</h1>`,
        order: order++
      });
    }

    // Process semantic body
    const body = $('article, main, body').first();
    let currentHeading: string | null = null;

    body.find('h1, h2, h3, h4, p, ul, ol, figure, .table, table, [class*="figure"], [class*="table"]').each((_, el) => {
      const $el = $(el);
      if ($el.data('processed')) return;

      const tagName = el.tagName?.toLowerCase();
      const className = $el.attr('class') || '';

      if ($el.closest('.c-article-references, [class*="references" i], [id*="references" i], [id*="bib" i], .References, .references, .ReferenceList, #references, .ref-list, .reflist, nav, footer, header, #sidebar, .sidebar').length > 0) return;

      if (tagName === 'figure' || className.includes('figure') || $el.closest('figure').length > 0) {
        if (tagName !== 'figure' && !className.includes('figure')) return;
        
        $el.data('processed', true);
        $el.find('*').data('processed', true);

        const captionText = $el.find('figcaption, .caption, [class*="caption"]').first().text().trim() || $el.text().trim();
        const img = $el.find('img').first();
        const src = img.attr('src') || img.attr('data-src') || '';
        let imgHtml = '';
        if (src) {
          imgHtml = `<img src="${escapeHtml(src)}" alt="${escapeHtml(captionText)}" class="figure-image" style="max-width: 100%; height: auto; display: block; margin: 12px auto;" />`;
        }
        blocks.push({
          blockType: 'figure',
          semanticType: 'figure',
          sectionHeading: currentHeading,
          text: captionText,
          html: `<div class="figure-block"><p class="caption"><strong>${escapeHtml(captionText)}</strong></p>${imgHtml || '<p class="placeholder-error"><em>[Figure image unavailable]</em></p>'}</div>`,
          order: order++
        });
      } else if (tagName === 'table' || className.includes('table') || $el.closest('table').length > 0) {
        if (tagName !== 'table' && !className.includes('table')) return;

        $el.data('processed', true);
        $el.find('*').data('processed', true);

        const captionText = $el.find('.caption, caption, [class*="caption"]').first().text().trim() || 'Bảng số liệu';
        const rawTable = tagName === 'table' ? $el : $el.find('table').first();
        let tableHtml = '';
        if (rawTable.length > 0) {
          tableHtml = $.html(rawTable);
        }
        const fullSizeLink = $el.find('a').filter((_, aEl) => $(aEl).text().toLowerCase().includes('full size table')).first().attr('href') || '';
        blocks.push({
          blockType: 'table',
          semanticType: 'table',
          sectionHeading: currentHeading,
          text: captionText,
          html: `<div class="table-block"><p class="caption"><strong>${escapeHtml(captionText)}</strong></p>${tableHtml || '<p class="placeholder-error"><em>[Table data unavailable]</em></p>'}</div>`,
          order: order++,
          tableLink: fullSizeLink || undefined
        });
      } else if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3' || tagName === 'h4') {
        $el.data('processed', true);
        const hText = $el.text().trim();
        if (hText && hText !== title) {
          currentHeading = hText;
          blocks.push({
            blockType: 'heading',
            semanticType: 'heading',
            sectionHeading: null,
            text: hText,
            html: `<h2>${escapeHtml(hText)}</h2>`,
            order: order++
          });
        }
      } else if (tagName === 'p') {
        $el.data('processed', true);
        const text = $el.text().trim();
        if (text) {
          blocks.push({
            blockType: 'paragraph',
            semanticType: 'paragraph',
            sectionHeading: currentHeading,
            text,
            html: `<p>${escapeHtml(text)}</p>`,
            order: order++
          });
        }
      } else if (tagName === 'ul' || tagName === 'ol') {
        $el.data('processed', true);
        $el.find('*').data('processed', true);

        const listType = $el.attr('list-type') || (tagName === 'ol' ? 'order' : 'simple');
        let index = 1;
        $el.children('li').each((_, li) => {
          const $li = $(li);
          const rawText = $li.text().trim();
          let marker = '-';
          let cleanText = rawText;

          const match = rawText.match(/^(\([a-zA-Z0-9]+\)|[a-zA-Z0-9]+\.)\s+/);
          if (match) {
            marker = match[1];
            cleanText = rawText.substring(match[0].length).trim();
          } else {
            marker = listType === 'order' ? `(${index})` : '-';
          }
          index++;

          blocks.push({
            blockType: 'list_item',
            semanticType: 'list',
            sectionHeading: currentHeading,
            text: cleanText,
            html: `<li>${escapeHtml(cleanText)}</li>`,
            marker,
            order: order++
          });
        });
      }
    });

    // 2. Separate References
    const refSelectors = '.c-article-references, [class*="references" i], [id*="references" i], [id*="bib" i], .References, .references, .ReferenceList, #references, .ref-list, .reflist';
    let refContainer = $(refSelectors).first();
    const allContainers = $(refSelectors);
    if (allContainers.length > 1) {
      let bestContainer = refContainer;
      let maxScore = -1;
      allContainers.each((_, containerEl) => {
        const $c = $(containerEl);
        const items = $c.find('li, .c-article-references__item, .c-article-references__text, .reference, .ref-item, .References__item').not('.References__links__item, .reference-links li');
        let citationCount = 0;
        items.each((_, itemEl) => {
          const itemText = $(itemEl).text().trim();
          if (/\b(19|20)\d{2}\b/.test(itemText)) {
            citationCount++;
          }
        });
        if (citationCount > maxScore) {
          maxScore = citationCount;
          bestContainer = $c;
        }
      });
      refContainer = bestContainer;
    }

    if (refContainer.length > 0) {
      blocks.push({
        blockType: 'heading',
        semanticType: 'heading',
        sectionHeading: null,
        text: 'REFERENCES',
        html: '<h2>REFERENCES</h2>',
        order: order++
      });

      refContainer.find('li, .c-article-references__item, .c-article-references__text, .reference, .ref-item, .References__item')
        .not('.References__links__item, .reference-links li, .c-article-references__links')
        .each((_, ref) => {
          const $ref = $(ref).clone();
          
          const rawText = $ref.text().trim();
          const lowercaseText = rawText.toLowerCase();

          // Exclude metadata elements
          const metadataKeywords = [
            'summary', 'keywords', 'citation:', 'received:', 'accepted:', 'published:',
            'volume', 'copyright', 'correspondence:', 'disclaimer', 'conflict of interest',
            'author contributions', 'funding', 'acknowledgments', 'supplementary material',
            'editor', 'reviewer'
          ];
          const isMetadata = metadataKeywords.some(keyword => {
            if (keyword.endsWith(':')) {
              return lowercaseText.includes(keyword);
            }
            return lowercaseText.startsWith(keyword) || (lowercaseText.length < 200 && lowercaseText.includes(keyword));
          });
          if (isMetadata) return;

          // Replace non-action links (like DOI text) with text content
          $ref.find('a').each((_, aEl) => {
            const $a = $(aEl);
            const aText = $a.text().trim();
            const isActionLink = /pubmed|abstract|crossref|google|scholar|export|download/i.test(aText);
            if (!isActionLink) {
              $a.replaceWith(aText);
            } else {
              $a.remove();
            }
          });

          // Remove remaining UI links list containers
          $ref.find('.References__links, .reference-links, .c-article-references__links').remove();

          const text = cleanReferenceText($ref.text());
          if (text) {
            blocks.push({
              blockType: 'reference',
              semanticType: 'reference',
              sectionHeading: 'REFERENCES',
              text,
              html: `<div class="reference-item">${escapeHtml(text)}</div>`,
              order: order++
            });
          }
        });
    }

  } catch (err: any) {
    return {
      title,
      parserEngine: 'GenericHtmlParser',
      sourceType: 'generic_html',
      warnings: [...warnings, `Generic HTML parse failed: ${err.message}`],
      blocks,
      success: false,
      error: err.message
    };
  }

  return {
    title,
    parserEngine: 'GenericHtmlParser',
    sourceType: 'generic_html',
    warnings,
    blocks,
    success: true
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
