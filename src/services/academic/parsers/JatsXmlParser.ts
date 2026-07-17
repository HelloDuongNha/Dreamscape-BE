import * as cheerio from 'cheerio';
import { CanonicalBlocksOutput, CanonicalBlock } from '../types';

export function parseJatsXml(xmlText: string, pmcImageMap?: Map<string, string>): CanonicalBlocksOutput {
  const blocks: CanonicalBlock[] = [];
  const warnings: string[] = [];
  let title = 'Untitled Article';
  let order = 0;

  try {
    const $ = cheerio.load(xmlText, { xmlMode: true });
    const doi = $('article-id[pub-id-type="doi"]').first().text().trim();

    const resolveGraphicUrl = (href: string): string => {
      if (!href) return '';
      const rawHref = href.trim();
      if (/^https?:\/\//i.test(rawHref)) return rawHref;

      const cleanHref = rawHref.replace(/^PMC\d+\//i, '').replace(/^info:doi\//i, '');
      const filename = cleanHref.split('/').pop() || '';
      if (pmcImageMap?.has(filename.toLowerCase())) {
        return pmcImageMap.get(filename.toLowerCase()) || '';
      }
      if (pmcImageMap?.has(cleanHref.toLowerCase())) {
        return pmcImageMap.get(cleanHref.toLowerCase()) || '';
      }

      if (doi.startsWith('10.1371/')) {
        let figureDoi = cleanHref;
        if (!figureDoi.startsWith('10.1371/')) {
          const hrefToken = filename.replace(/\.(?:png|jpe?g|gif|tiff?|webp)$/i, '');
          const articleToken = doi.split('/').pop() || '';
          const shortArticleToken = articleToken.replace(/^journal\./i, '');
          if (hrefToken.startsWith(`${shortArticleToken}.`)) {
            figureDoi = `10.1371/journal.${hrefToken}`;
          } else {
            const suffix = hrefToken.match(/(?:^|\.)([gt]\d+)$/i)?.[1];
            figureDoi = suffix ? `${doi}.${suffix}` : '';
          }
        }
        if (figureDoi) {
          return `https://journals.plos.org/plosone/article/figure/image?id=${figureDoi}&size=large`;
        }
      }

      const pmcIdText = $('article-id[pub-id-type="pmcid"], article-id[pub-id-type="pmc"]').first().text().trim();
      const pmcId = pmcIdText
        ? (pmcIdText.toUpperCase().startsWith('PMC') ? pmcIdText : `PMC${pmcIdText}`)
        : '';
      return pmcId
        ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcId}/bin/${cleanHref}`
        : '';
    };

    // 1. Title Extraction
    const articleTitle = $('article-title').first().text().trim();
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

    // JATS stores the article abstract in front matter, outside <body>. Emit it
    // before body sections so every structured DOI/PDF-first import has the
    // same Abstract heading and paragraphs.
    const abstractNode = $('front article-meta abstract').first();
    if (abstractNode.length > 0) {
      const abstractHeading = abstractNode.children('title').first().text().trim() || 'Abstract';
      blocks.push({
        blockType: 'heading',
        semanticType: 'heading',
        sectionHeading: null,
        text: abstractHeading,
        html: `<h2>${escapeHtml(abstractHeading)}</h2>`,
        order: order++
      });

      const abstractParagraphs = abstractNode.find('p').toArray();
      if (abstractParagraphs.length > 0) {
        abstractParagraphs.forEach((paragraph) => {
          const text = $(paragraph).clone().find('title').remove().end().text().trim();
          if (!text) return;
          blocks.push({
            blockType: 'paragraph',
            semanticType: 'abstract',
            sectionHeading: abstractHeading,
            text,
            html: `<p>${escapeHtml(text)}</p>`,
            order: order++
          });
        });
      } else {
        const text = abstractNode.clone().children('title').remove().end().text().trim();
        if (text) {
          blocks.push({
            blockType: 'paragraph',
            semanticType: 'abstract',
            sectionHeading: abstractHeading,
            text,
            html: `<p>${escapeHtml(text)}</p>`,
            order: order++
          });
        }
      }
    }

    // Helper to split inline list paragraph if it contains alphabetical or numerical lists
    const splitInlineListParagraphInJats = (text: string, currentHeading: string | null): CanonicalBlock[] | null => {
      const alphaPattern = /\s*\(([a-z])\)\s+/g;
      const numPattern = /\s*\(([0-9]+)\)\s+/g;
      const dotNumPattern = /\s*([0-9]+)\.\s+/g;

      let patternToUse: RegExp | null = null;

      if (/\((a)\)\s+/i.test(text) && /\((b)\)\s+/i.test(text)) {
        patternToUse = alphaPattern;
      } else if (/\((1)\)\s+/i.test(text) && /\((2)\)\s+/i.test(text)) {
        patternToUse = numPattern;
      } else if (/(\s+|^)1\.\s+/i.test(text) && /(\s+|^)2\.\s+/i.test(text)) {
        patternToUse = dotNumPattern;
      }

      if (!patternToUse) return null;

      const matches: { marker: string; index: number; length: number }[] = [];
      let match;
      patternToUse.lastIndex = 0;
      while ((match = patternToUse.exec(text)) !== null) {
        matches.push({
          marker: match[1] || match[0].trim(),
          index: match.index,
          length: match[0].length
        });
      }

      if (matches.length < 2) return null;

      const results: CanonicalBlock[] = [];

      const preamble = text.substring(0, matches[0].index).trim();
      if (preamble) {
        results.push({
          blockType: 'paragraph',
          semanticType: 'paragraph',
          sectionHeading: currentHeading,
          text: preamble,
          html: `<p>${escapeHtml(preamble)}</p>`,
          order: order++
        });
      }

      for (let i = 0; i < matches.length; i++) {
        const startIdx = matches[i].index + matches[i].length;
        const endIdx = i + 1 < matches.length ? matches[i + 1].index : text.length;
        const itemText = text.substring(startIdx, endIdx).trim();

        let marker = matches[i].marker;
        if (patternToUse === alphaPattern || patternToUse === numPattern) {
          marker = `(${marker})`;
        } else if (patternToUse === dotNumPattern) {
          marker = `${marker}.`;
        }

        results.push({
          blockType: 'list_item',
          semanticType: 'list',
          sectionHeading: currentHeading,
          text: itemText,
          html: `<li>${escapeHtml(itemText)}</li>`,
          marker,
          order: order++
        });
      }

      return results;
    };

    // Helper to process list elements
    const processList = (listNode: any, currentHeading: string | null) => {
      const listType = $(listNode).attr('list-type') || 'simple';
      let index = 1;
      $(listNode).children('list-item').each((_, item) => {
        const itemText = $(item).text().trim();
        let marker = $(item).find('label').text().trim();
        if (!marker) {
          if (listType === 'order') {
            marker = `(${index})`;
          } else {
            marker = '-';
          }
        }
        index++;

        let cleanText = itemText;
        if (marker && marker !== '-' && cleanText.startsWith(marker)) {
          cleanText = cleanText.substring(marker.length).trim();
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
    };

    // Helper to process sections recursively
    const processSection = (secNode: any, parentHeading: string | null) => {
      const headingText = $(secNode).children('title').first().text().trim();
      const currentHeading = headingText || parentHeading;

      if (headingText) {
        blocks.push({
          blockType: 'heading',
          semanticType: 'heading',
          sectionHeading: parentHeading,
          text: headingText,
          html: `<h2>${escapeHtml(headingText)}</h2>`,
          order: order++
        });
      }

      // Process children
      $(secNode).children().each((_, child) => {
        const tagName = child.tagName?.toLowerCase();
        if (tagName === 'title') return; // already handled

        if (tagName === 'sec') {
          processSection(child, currentHeading);
        } else if (tagName === 'p') {
          // Extract nested fig and table-wrap before emitting paragraph
          const nestedFigs = $(child).find('fig');
          const nestedTableWraps = $(child).find('table-wrap');

          if (nestedFigs.length > 0 || nestedTableWraps.length > 0) {
            // Emit any text content before/between nested elements as paragraph
            const clone = $(child).clone();
            clone.find('fig, table-wrap').remove();
            const remainingText = clone.text().trim();
            if (remainingText) {
              const splitItems = splitInlineListParagraphInJats(remainingText, currentHeading);
              if (splitItems) {
                blocks.push(...splitItems);
              } else {
                blocks.push({
                  blockType: 'paragraph',
                  semanticType: 'paragraph',
                  sectionHeading: currentHeading,
                  text: remainingText,
                  html: `<p>${escapeHtml(remainingText)}</p>`,
                  order: order++
                });
              }
            }
            // Process nested figs
            nestedFigs.each((_, figEl) => {
              const fLabel = $(figEl).find('label').text().trim();
              const fCaption = $(figEl).find('caption').text().trim();
              const fText = `${fLabel ? fLabel + ': ' : ''}${fCaption}`;
              const fGraphic = $(figEl).find('graphic').first();
              const fHref = fGraphic.attr('xlink:href') || fGraphic.attr('href') || '';
              const fImgUrl = resolveGraphicUrl(fHref);
              let fImgHtml = '';
              if (fImgUrl) {
                fImgHtml = `<img src="${escapeHtml(fImgUrl)}" alt="${escapeHtml(fText)}" class="figure-image" style="max-width: 100%; height: auto; display: block; margin: 12px auto;" />`;
              }
              blocks.push({
                blockType: 'figure',
                semanticType: 'figure',
                sectionHeading: currentHeading,
                text: fText,
                html: `<div class="figure-block"><p class="caption"><strong>${escapeHtml(fText)}</strong></p>${fImgHtml || '<p class="placeholder-error"><em>[Figure image unavailable]</em></p>'}</div>`,
                imageUrl: fImgUrl || undefined,
                order: order++
              });
            });
            // Process nested table-wraps
            nestedTableWraps.each((_, twEl) => {
              const tLabel = $(twEl).find('label').text().trim();
              const tCaption = $(twEl).find('caption').text().trim();
              const tText = `${tLabel ? tLabel + ': ' : ''}${tCaption}`;
              const rawTable = $(twEl).find('table').first();
              let tableHtml = '';
              if (rawTable.length > 0) {
                tableHtml = $.html(rawTable);
              }
              blocks.push({
                blockType: 'table',
                semanticType: 'table',
                sectionHeading: currentHeading,
                text: tText,
                html: `<div class="table-block"><p class="caption"><strong>${escapeHtml(tText)}</strong></p>${tableHtml ? `<div class="table-wrapper">${tableHtml}</div>` : '<p class="placeholder-error"><em>[Table data unavailable]</em></p>'}</div>`,
                order: order++
              });
            });
          } else {
            const text = $(child).text().trim();
            if (text) {
              const splitItems = splitInlineListParagraphInJats(text, currentHeading);
              if (splitItems) {
                blocks.push(...splitItems);
              } else {
                blocks.push({
                  blockType: 'paragraph',
                  semanticType: 'paragraph',
                  sectionHeading: currentHeading,
                  text,
                  html: `<p>${escapeHtml(text)}</p>`,
                  order: order++
                });
              }
            }
          }
        } else if (tagName === 'list') {
          processList(child, currentHeading);
        } else if (tagName === 'fig') {
          const label = $(child).find('label').text().trim();
          const caption = $(child).find('caption').text().trim();
          const text = `${label ? label + ': ' : ''}${caption}`;
          const graphic = $(child).find('graphic').first();
          const href = graphic.attr('xlink:href') || graphic.attr('href') || '';
          let imgHtml = '';
          let imgUrl = resolveGraphicUrl(href);
          if (href) {
            const cleanHref = href.replace(/^PMC\d+\//, '');
            if (!imgUrl && doi && doi.startsWith('10.3389/')) {
              const publisherId = $('article-id[pub-id-type="publisher-id"]').first().text().trim();
              if (publisherId) {
                const frontiersFilename = cleanHref.replace(/\.[a-zA-Z0-9]+$/, '.webp');
                imgUrl = `https://www.frontiersin.org/files/Articles/${publisherId}/xml-images/${frontiersFilename}`;
              }
            }

            if (imgUrl) {
              imgHtml = `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(text)}" class="figure-image" style="max-width: 100%; height: auto; display: block; margin: 12px auto;" />`;
            }
          }
          blocks.push({
            blockType: 'figure',
            semanticType: 'figure',
            sectionHeading: currentHeading,
            text,
            html: `<div class="figure-block"><p class="caption"><strong>${escapeHtml(text)}</strong></p>${imgHtml || '<p class="placeholder-error"><em>[Figure image unavailable]</em></p>'}</div>`,
            imageUrl: imgUrl || undefined,
            order: order++
          });
        } else if (tagName === 'table-wrap') {
          const label = $(child).find('label').text().trim();
          const caption = $(child).find('caption').text().trim();
          const text = `${label ? label + ': ' : ''}${caption}`;
          const rawTable = $(child).find('table').first();
          let tableHtml = '';
          if (rawTable.length > 0) {
            tableHtml = $.html(rawTable);
          }
          blocks.push({
            blockType: 'table',
            semanticType: 'table',
            sectionHeading: currentHeading,
            text,
            html: `<div class="table-block"><p class="caption"><strong>${escapeHtml(text)}</strong></p>${tableHtml || '<p class="placeholder-error"><em>[Table data unavailable]</em></p>'}</div>`,
            order: order++
          });
        }
      });
    };

    // 2. Body Sections
    const hasRefList = $('ref-list').length > 0;
    $('body > sec').each((_, sec) => {
      // Skip body <sec> titled "references" if <ref-list> exists in back matter
      const secTitle = $(sec).children('title').first().text().trim().toLowerCase();
      if (hasRefList && (secTitle === 'references' || secTitle === 'bibliography')) {
        return;
      }
      processSection(sec, null);
    });

    // Handle paragraphs directly under body
    $('body > p').each((_, p) => {
      const text = $(p).text().trim();
      if (text) {
        blocks.push({
          blockType: 'paragraph',
          semanticType: 'paragraph',
          sectionHeading: null,
          text,
          html: `<p>${escapeHtml(text)}</p>`,
          order: order++
        });
      }
    });

    // 3. References (Back Matter)
    const refList = $('ref-list');
    if (refList.length > 0) {
      blocks.push({
        blockType: 'heading',
        semanticType: 'heading',
        sectionHeading: null,
        text: 'REFERENCES',
        html: '<h2>REFERENCES</h2>',
        order: order++
      });

      refList.find('ref').each((_, ref) => {
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
      parserEngine: 'JatsXmlParser',
      sourceType: 'jats_xml',
      warnings: [...warnings, `JATS XML Parse failed: ${err.message}`],
      blocks,
      success: false,
      error: err.message
    };
  }

  return {
    title,
    parserEngine: 'JatsXmlParser',
    sourceType: 'jats_xml',
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
