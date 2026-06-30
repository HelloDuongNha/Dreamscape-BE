import * as cheerio from 'cheerio';
import { CanonicalBlocksOutput, CanonicalBlock } from '../types';

export function parsePlosHtml(htmlText: string): CanonicalBlocksOutput {
  const blocks: CanonicalBlock[] = [];
  const warnings: string[] = [];
  let title = 'Untitled PLOS Article';
  let order = 0;

  try {
    const $ = cheerio.load(htmlText);

    // 1. Title Extraction
    const articleTitle = $('.title-wrap, h1').first().text().trim();
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

    // Process main content
    const content = $('.article-text, article, body').first();
    let currentHeading: string | null = null;

    content.find('h1, h2, h3, h4, p, ul, ol, .figure, .table').each((_, el) => {
      const $el = $(el);
      const tagName = el.tagName?.toLowerCase();

      if ($el.closest('.references, .reflist').length > 0) return;

      if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3' || tagName === 'h4') {
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
        $el.children('li').each((_, li) => {
          const $li = $(li);
          const rawText = $li.text().trim();
          let marker = '-';
          let cleanText = rawText;

          const match = rawText.match(/^(\([a-zA-Z0-9]+\)|[a-zA-Z0-9]+\.)\s+/);
          if (match) {
            marker = match[1];
            cleanText = rawText.substring(match[0].length).trim();
          }

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
    const refContainer = $('.references, .reflist').first();
    if (refContainer.length > 0) {
      blocks.push({
        blockType: 'heading',
        semanticType: 'heading',
        sectionHeading: null,
        text: 'REFERENCES',
        html: '<h2>REFERENCES</h2>',
        order: order++
      });

      refContainer.find('li, .reference, .ref-item').each((_, ref) => {
        const text = $(ref).text().trim();
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
      parserEngine: 'PlosParser',
      sourceType: 'publisher_html',
      warnings: [...warnings, `PLOS HTML parse failed: ${err.message}`],
      blocks,
      success: false,
      error: err.message
    };
  }

  return {
    title,
    parserEngine: 'PlosParser',
    sourceType: 'publisher_html',
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
