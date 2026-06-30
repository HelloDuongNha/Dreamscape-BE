import * as cheerio from 'cheerio';
import { CanonicalBlocksOutput, CanonicalBlock } from '../types';

export function parseFrontiersHtml(htmlText: string): CanonicalBlocksOutput {
  const blocks: CanonicalBlock[] = [];
  const warnings: string[] = [];
  let title = 'Untitled Frontiers Article';
  let order = 0;

  try {
    const $ = cheerio.load(htmlText);

    // 1. Title Extraction
    const articleTitle = $('h1, .article-title, .title').first().text().trim();
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

    // Try to find the main content div to reduce noise using prioritized check
    let mainContent = $('.ArticleContent');
    if (mainContent.length === 0) {
      mainContent = $('.ArticleDetailsV4__main__content');
    }
    if (mainContent.length === 0) {
      mainContent = $('.article-body, #article-body, .main-content');
    }
    if (mainContent.length === 0) {
      mainContent = $('main');
    }
    const container = mainContent.length > 0 ? mainContent.first() : ($('article').not('.CardJournal, .CardA').first().length > 0 ? $('article').not('.CardJournal, .CardA').first() : $('body'));

    let currentHeading: string | null = null;

    // Traverse DOM child elements sequentially
    container.find('h1, h2, h3, h4, p, ul, ol, .figure, .table').each((_, el) => {
      const $el = $(el);
      const tagName = el.tagName?.toLowerCase();

      // Skip descendants of list items or nested list nodes under broad traversal to prevent duplicates
      if (tagName !== 'ul' && tagName !== 'ol' && $el.closest('li, ul, ol').length > 0) {
        return;
      }
      if ((tagName === 'ul' || tagName === 'ol') && $el.parent().closest('ul, ol').length > 0) {
        return;
      }

      // Skip elements that are inside references or headers that are duplicates of the title
      if ($el.closest('.References, .references, .ReferenceList, #references, .ref-list, footer, header').length > 0) return;

      // Skip elements matching sidebar/metrics/author noise classes or ancestors
      if ($el.closest([
        '.References',
        '.References__item',
        '.references',
        '.ReferenceList',
        '#references',
        '.ref-list',
        'footer',
        'header',
        'nav',
        '.Summary',
        '.Summary__dates',
        '.article-metadata',
        '.article-metadata-list',
        '.disclaimer-text',
        '.Statements',
        '.ArticleMetadata',
        '.ArticleReviews',
        '.author-notes',
        '.PeopleList__list',
        '.AffiliationList__list',
        '.ArticleMetrics',
        '.CardJournal',
        '.CardA',
        '[class*="PeopleList"]',
        '[class*="AffiliationList"]',
        '[class*="ArticleMetrics"]',
        '[class*="ArticleLayoutHeader"]',
        '[class*="CardRelated"]'
      ].join(', ')).length > 0) {
        return;
      }

      const text = $el.text().trim();
      const textLower = text.toLowerCase();

      // Skip generic noise phrases
      const noisePhrases = [
        'article metrics',
        'front. psychol',
        'sec. consciousness research',
        'volume 7 - 2016',
        'share on',
        'view article impact',
        'related articles',
        'people also looked at',
        'export citation',
        'download article',
        'crossmark',
        'edited by',
        'reviewed by',
        'opinion article'
      ];
      if (noisePhrases.some(phrase => textLower.includes(phrase))) {
        return;
      }

      // Skip author card initials signature
      if (/^[A-Z]{2,}[A-Z][a-z]+/g.test(text)) {
        return;
      }

      if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3' || tagName === 'h4') {
        const hText = text;
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
        // Skip metadata / affiliate lists if they are noisy
        if ($el.hasClass('author') || $el.hasClass('affiliation')) {
          return;
        }

        const hText = text;
        if (hText) {
          // Remove noisy links (like "TIF original image" or "PNG larger image")
          let cleanText = hText.replace(/\[\s*(TIF|PNG)\s*[^\]]*\]/gi, '').trim();
          if (cleanText) {
            blocks.push({
              blockType: 'paragraph',
              semanticType: 'paragraph',
              sectionHeading: currentHeading,
              text: cleanText,
              html: `<p>${escapeHtml(cleanText)}</p>`,
              order: order++
            });
          }
        }
      } else if (tagName === 'ul' || tagName === 'ol') {
        const listType = $el.attr('list-type') || (tagName === 'ol' ? 'order' : 'simple');
        let index = 1;
        $el.children('li').each((_, li) => {
          const $li = $(li);
          const rawText = $li.text().trim();
          
          let label = $li.find('.label, label').text().trim();
          let cleanText = rawText;
          if (label && cleanText.startsWith(label)) {
            cleanText = cleanText.substring(label.length).trim();
          } else {
            const match = rawText.match(/^(\([a-zA-Z0-9]+\)|[a-zA-Z0-9]+\.)\s+/);
            if (match) {
              label = match[1];
              cleanText = rawText.substring(match[0].length).trim();
            } else {
              label = listType === 'order' ? `(${index})` : '-';
            }
          }
          index++;

          blocks.push({
            blockType: 'list_item',
            semanticType: 'list',
            sectionHeading: currentHeading,
            text: cleanText,
            html: `<li>${escapeHtml(cleanText)}</li>`,
            marker: label,
            order: order++
          });
        });
      }
    });

    // 2. Separate References
    let refContainer = $('.References, .references, .ReferenceList, #references, .ref-list').first();
    const allContainers = $('.References, .references, .ReferenceList, #references, .ref-list');
    if (allContainers.length > 1) {
      let bestContainer = refContainer;
      let maxScore = -1;
      allContainers.each((_, containerEl) => {
        const $c = $(containerEl);
        const items = $c.find('li, .reference, .ref-item, .References__item').not('.References__links__item, .reference-links li');
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

      refContainer.find('li, .reference, .ref-item, .References__item')
        .not('.References__links__item, .reference-links li')
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
          $ref.find('.References__links, .reference-links').remove();

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
      parserEngine: 'FrontiersHtmlParser',
      sourceType: 'publisher_html',
      warnings: [...warnings, `Frontiers HTML parse failed: ${err.message}`],
      blocks,
      success: false,
      error: err.message
    };
  }

  return {
    title,
    parserEngine: 'FrontiersHtmlParser',
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

export function cleanReferenceText(text: string): string {
  let cleaned = text.trim();

  // 1. Spacing after leading reference number, e.g. "1Bendor" -> "1. Bendor"
  cleaned = cleaned.replace(/^(\d+)(?!\.)(\s*)([a-zA-Z])/, '$1. $3');

  // 2. Add space around DOI if it is glued, e.g. "CrossRef10.1038/" -> "CrossRef 10.1038/"
  cleaned = cleaned.replace(/([^\s])(10\.\d{4,9}\/)/gi, '$1 $2');

  // 3. String replacement for remaining stray UI action links
  const noisePatterns = [
    /pubmed\s+abstract/gi,
    /crossref\s+full\s*text/gi,
    /google\s+scholar/gi,
    /export\s+citation/gi,
    /download\s+article/gi,
    /view\s+article/gi,
    /view\s+reference\s+in\s+article/gi,
    /full\s*text/gi
  ];
  for (const pat of noisePatterns) {
    cleaned = cleaned.replace(pat, '');
  }

  // 4. Collapse excessive whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // 5. Double separator/comma cleanup
  cleaned = cleaned.replace(/,\s*,/g, ',');
  cleaned = cleaned.replace(/,\s*$/g, '');

  return cleaned;
}
