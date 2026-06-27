import * as cheerio from 'cheerio';

export interface ExtractedSection {
  sectionIndex: number;
  sectionType: 'title' | 'abstract' | 'heading' | 'paragraph' | 'list_item' | 'reference_item' | 'caption' | 'metadata' | 'unknown' | 'figure' | 'table' | 'page_break' | 'reference';
  title?: string;
  text: string;
  html?: string;
  style?: any;
  pageStart?: number;
  pageEnd?: number;
}

export interface ParseResult {
  success: boolean;
  engine: 'html' | 'xml' | 'unknown' | 'jats_xml' | 'publisher_html' | 'sanitized_html';
  quality: 'high' | 'medium' | 'low';
  structureVersion: string;
  hasStructuredReferences: boolean;
  hasDetectedSections: boolean;
  wordCount: number;
  characterCount: number;
  title: string;
  authors: string[];
  sections: ExtractedSection[];
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Traverses cheerio nodes recursively to extract text, inserting spaces around
 * specific inline naming elements to prevent run-on author names (e.g. "BendorD.").
 */
function getElementTextWithSpaces($: cheerio.CheerioAPI, el: any): string {
  let text = '';
  $(el).contents().each((i, node) => {
    if (node.type === 'text') {
      text += (node as any).data;
    } else if (node.type === 'tag') {
      let childText = getElementTextWithSpaces($, node);
      const className = $(node).attr('class') || '';
      const tagName = node.name.toLowerCase();
      
      if (
        className.includes('References__surname') || 
        className.includes('References__givenNames') || 
        className.includes('References__name') || 
        className.includes('References__source') ||
        tagName === 'i' || tagName === 'b'
      ) {
        childText = childText + ' ';
      }
      text += childText;
    }
  });
  return text.replace(/\s+/g, ' ').replace(/\s+([,\.\)\]—–-])/g, '$1').trim();
}

/**
 * Recursively sanitizes Cheerio elements using a whitelist of allowed tags and attributes.
 * Allowed: i, em, b, strong, sub, sup, a[href] (safe protocol only).
 * Completely removes script, style, iframe.
 * Unwraps other tags, keeping their inner text/structure.
 */
export function sanitizeInnerHtml($: cheerio.CheerioAPI, node: any) {
  if (node.type === 'text') {
    return;
  }
  if (node.type === 'tag') {
    const tagName = node.name.toLowerCase();
    
    // Completely remove unsafe tags
    if (['script', 'style', 'iframe'].includes(tagName)) {
      $(node).remove();
      return;
    }
    
    const allowed = ['i', 'em', 'b', 'strong', 'sub', 'sup', 'a'];
    if (allowed.includes(tagName)) {
      // Clean attributes, allowing only safe href for 'a'
      const attribs = node.attribs || {};
      for (const attr of Object.keys(attribs)) {
        if (tagName === 'a' && attr === 'href') {
          const href = attribs[attr] || '';
          const isSafe = href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#');
          if (!isSafe) {
            $(node).removeAttr(attr);
          }
        } else {
          $(node).removeAttr(attr);
        }
      }
      // Recurse down children
      $(node).contents().each((i, child) => {
        sanitizeInnerHtml($, child);
      });
    } else {
      // Recurse children first to ensure inner text remains safe
      $(node).contents().each((i, child) => {
        sanitizeInnerHtml($, child);
      });
      // Unwrap the element, replacing the tag with its child nodes
      const contents = $(node).contents();
      $(node).replaceWith(contents);
    }
  }
}

/**
 * Helper to wrap and sanitize an element's HTML content.
 */
function getSanitizedElementHtml($: cheerio.CheerioAPI, el: any, defaultTag = 'p'): string {
  const innerHtml = $(el).html() || '';
  if (!innerHtml.trim()) {
    return `<${defaultTag}>${cleanText($(el).text())}</${defaultTag}>`;
  }
  const temp$ = cheerio.load(innerHtml, { xmlMode: true });
  temp$.root().contents().each((i, node) => {
    sanitizeInnerHtml(temp$, node);
  });
  return `<${defaultTag}>${temp$.html().trim()}</${defaultTag}>`;
}

/**
 * JATS/XML Scholarly Article Parser
 */
export function parseJatsXml(xmlText: string, url = ''): ParseResult {
  const $ = cheerio.load(xmlText, { xmlMode: true });

  // Convert JATS XML inline elements to whitelisted HTML equivalents (Correction 2)
  $('italic').each((i, el) => { el.name = 'i'; });
  $('bold').each((i, el) => { el.name = 'b'; });
  $('ext-link').each((i, el) => {
    el.name = 'a';
    const href = $(el).attr('xlink:href') || $(el).attr('href');
    if (href) {
      $(el).attr('href', href);
    }
  });

  const title = cleanText(
    $('article-title').first().text() || 
    'Tài liệu không có tiêu đề'
  );

  const authors: string[] = [];
  $('contrib[contrib-type="author"]').each((i, el) => {
    const surname = $(el).find('surname').text().trim();
    const givenNames = $(el).find('given-names').text().trim();
    if (surname || givenNames) {
      authors.push(`${givenNames} ${surname}`.trim());
    }
  });

  const sections: ExtractedSection[] = [];
  let sectionIndex = 0;

  // Extract Abstract
  const abstractEl = $('abstract');
  if (abstractEl.length > 0) {
    const paras: string[] = [];
    abstractEl.find('p').each((i, p) => {
      paras.push(cleanText($(p).text()));
    });
    const abstractText = paras.join('\n\n');
    if (abstractText) {
      // Gather HTML with tags
      const absHtmls: string[] = [];
      abstractEl.find('p').each((i, p) => {
        absHtmls.push(getSanitizedElementHtml($, p, 'p'));
      });
      sections.push({
        sectionIndex: sectionIndex++,
        sectionType: 'abstract',
        text: abstractText,
        html: absHtmls.join('\n')
      });
    }
  }

  // Extract Metadata/End-matter elements generically
  const metaLines: string[] = [];
  $('date[date-type="received"]').each((i, el) => {
    const y = $(el).find('year').text().trim();
    const m = $(el).find('month').text().trim();
    const d = $(el).find('day').text().trim();
    if (y) metaLines.push(`Received: ${y}-${m || '01'}-${d || '01'}`);
  });
  $('date[date-type="accepted"]').each((i, el) => {
    const y = $(el).find('year').text().trim();
    const m = $(el).find('month').text().trim();
    const d = $(el).find('day').text().trim();
    if (y) metaLines.push(`Accepted: ${y}-${m || '01'}-${d || '01'}`);
  });
  $('pub-date').each((i, el) => {
    const y = $(el).find('year').text().trim();
    const m = $(el).find('month').text().trim();
    const d = $(el).find('day').text().trim();
    if (y) metaLines.push(`Published: ${y}-${m || '01'}-${d || '01'}`);
  });
  const publisherName = $('publisher-name').first().text().trim();
  const journalTitle = $('journal-title').first().text().trim();
  if (journalTitle) metaLines.push(`Journal: ${journalTitle}`);
  if (publisherName) metaLines.push(`Publisher: ${publisherName}`);
  
  $('author-notes corresp').each((i, el) => {
    metaLines.push(`Correspondence: ${cleanText($(el).text())}`);
  });
  $('fn[fn-type="conflict"]').each((i, el) => {
    metaLines.push(`Conflict of Interest: ${cleanText($(el).text())}`);
  });
  $('permissions copyright-statement').each((i, el) => {
    metaLines.push(`Copyright: ${cleanText($(el).text())}`);
  });

  if (metaLines.length > 0) {
    sections.push({
      sectionIndex: sectionIndex++,
      sectionType: 'metadata',
      text: metaLines.join('\n')
    });
  }

  // Traverse XML body structurally
  const body = $('body');
  if (body.length > 0) {
    const traverse = (el: any) => {
      const name = el.name.toLowerCase();
      if (name === 'sec') {
        const titleEl = $(el).children('title');
        if (titleEl.length > 0) {
          sections.push({
            sectionIndex: sectionIndex++,
            sectionType: 'heading',
            text: cleanText(titleEl.text())
          });
        }
        $(el).children().each((i, child) => {
          if (child.name.toLowerCase() !== 'title') {
            traverse(child);
          }
        });
      } else if (name === 'p') {
        const text = cleanText($(el).text());
        if (text) {
          sections.push({
            sectionIndex: sectionIndex++,
            sectionType: 'paragraph',
            text,
            html: getSanitizedElementHtml($, el, 'p')
          });
        }
      } else if (name === 'list') {
        $(el).children('list-item').each((i, li) => {
          const text = cleanText($(li).text());
          if (text) {
            sections.push({
              sectionIndex: sectionIndex++,
              sectionType: 'list_item',
              text,
              html: getSanitizedElementHtml($, li, 'li')
            });
          }
        });
      } else if (name === 'fig') {
        const captionEl = $(el).find('caption');
        const capText = cleanText(captionEl.text());
        const id = $(el).attr('id') || '';
        sections.push({
          sectionIndex: sectionIndex++,
          sectionType: 'figure',
          text: capText,
          style: { id }
        });
      } else if (name === 'table-wrap') {
        const captionEl = $(el).find('caption');
        const capText = cleanText(captionEl.text());
        const id = $(el).attr('id') || '';
        sections.push({
          sectionIndex: sectionIndex++,
          sectionType: 'table',
          text: capText,
          style: { id }
        });
      }
    };

    body.children().each((i, child) => {
      traverse(child);
    });
  }

  // References list
  const refList = $('ref-list');
  if (refList.length > 0) {
    sections.push({
      sectionIndex: sectionIndex++,
      sectionType: 'heading',
      text: 'References'
    });

    refList.find('ref').each((i, el) => {
      const text = cleanText($(el).text());
      if (text) {
        sections.push({
          sectionIndex: sectionIndex++,
          sectionType: 'reference_item',
          text
        });
      }
    });
  }

  return {
    success: true,
    engine: 'jats_xml',
    quality: sections.length > 5 ? 'high' : 'medium',
    structureVersion: 'xml-jats-v1',
    hasStructuredReferences: refList.length > 0,
    hasDetectedSections: sections.some(s => s.sectionType === 'heading'),
    wordCount: sections.reduce((acc, s) => acc + s.text.split(/\s+/).filter(Boolean).length, 0),
    characterCount: sections.reduce((acc, s) => acc + s.text.length, 0),
    title,
    authors,
    sections
  };
}

/**
 * HTML Article Web Page Parser
 */
export function parseHtmlArticle(html: string, url = ''): ParseResult {
  const $ = cheerio.load(html);
  
  // 1. Meta fields extraction
  const title = cleanText(
    $('meta[name="citation_title"]').attr('content') || 
    $('meta[property="og:title"]').attr('content') || 
    $('h1').first().text() || 
    'Tài liệu không có tiêu đề'
  );

  const authors = $('meta[name="citation_author"]').map((i, el) => cleanText($(el).attr('content') || '')).get().filter(Boolean);

  const sections: ExtractedSection[] = [];
  let sectionIndex = 0;
  let hasStructuredRefs = false;
  let hasDecSections = false;

  const isFrontiers = url.toLowerCase().includes('frontiersin.org') || html.includes('frontiersin.org');
  const isPmc = url.toLowerCase().includes('ncbi.nlm.nih.gov/pmc') || html.includes('ncbi.nlm.nih.gov/pmc');
  const isPlos = url.toLowerCase().includes('plos.org') || html.includes('plos.org');

  // --- A. SPECIALIZED PUBLISHER ADAPTERS ---

  if (isFrontiers) {
    const abstractEl = $('.Abstract__content, .abstract, [class*="Abstract"] p').first();
    const abstractText = cleanText(abstractEl.text());
    if (abstractText) {
      sections.push({
        sectionIndex: sectionIndex++,
        sectionType: 'abstract',
        text: abstractText,
        html: getSanitizedElementHtml($, abstractEl, 'p')
      });
    }

    const articleContent = $('.ArticleContent');
    if (articleContent.length > 0) {
      articleContent.children().each((i, div) => {
        const id = $(div).attr('id') || '';
        const cls = $(div).attr('class') || '';
        
        if (id === 'h7' || cls.includes('References') || cls.includes('Summary')) {
          return;
        }

        const elementsToProcess = $(div).is('h2, h3, h4, h5, h6, p, li')
          ? $(div)
          : $(div).find('h2, h3, h4, h5, h6, p, li');

        elementsToProcess.each((j, el) => {
          const tagName = el.name.toLowerCase();
          const text = cleanText($(el).text());
          if (!text) return;

          if (tagName === 'p' && $(el).closest('li').length > 0) {
            return;
          }

          let stype: ExtractedSection['sectionType'] = 'paragraph';
          if (tagName.startsWith('h')) {
            stype = 'heading';
            hasDecSections = true;
          } else if (tagName === 'li') {
            stype = 'list_item';
          }

          sections.push({
            sectionIndex: sectionIndex++,
            sectionType: stype,
            text,
            html: stype === 'heading' ? undefined : getSanitizedElementHtml($, el, tagName)
          });
        });
      });
    }

    // Frontiers References
    const refContainer = $('.References');
    if (refContainer.length > 0) {
      sections.push({
        sectionIndex: sectionIndex++,
        sectionType: 'heading',
        text: 'References'
      });
      hasDecSections = true;

      refContainer.find('.References__item').each((i, item) => {
        const contentEl = $(item).find('.notranslate');
        if (contentEl.length > 0) {
          const text = getElementTextWithSpaces($, contentEl);
          if (text) {
            sections.push({
              sectionIndex: sectionIndex++,
              sectionType: 'reference_item',
              text
            });
            hasStructuredRefs = true;
          }
        }
      });
    }

  } else if (isPlos) {
    // PLOS ONE Abstract
    const abstractEl = $('.abstract-content, .abstract, [class*="abstract"]').first();
    const abstractText = cleanText(abstractEl.text());
    if (abstractText) {
      sections.push({
        sectionIndex: sectionIndex++,
        sectionType: 'abstract',
        text: abstractText,
        html: getSanitizedElementHtml($, abstractEl, 'p')
      });
    }

    // PLOS ONE Body
    const bodyContainer = $('.article-text, article, [class*="article-content"]').first();
    const targetArea = bodyContainer.length > 0 ? bodyContainer : $('body');

    targetArea.find('h2, h3, h4, p, li, figcaption').each((i, el) => {
      const tagName = el.name.toLowerCase();
      const text = cleanText($(el).text());
      if (!text) return;

      // Skip nested tags or reference blocks
      if ($(el).closest('.references, .ref-list, #reference-list').length > 0) {
        return;
      }
      if (tagName === 'p' && $(el).closest('li').length > 0) {
        return;
      }

      let stype: ExtractedSection['sectionType'] = 'paragraph';
      if (tagName.startsWith('h')) {
        stype = 'heading';
        hasDecSections = true;
      } else if (tagName === 'li') {
        stype = 'list_item';
      } else if (tagName === 'figcaption') {
        stype = 'caption';
      }

      sections.push({
        sectionIndex: sectionIndex++,
        sectionType: stype,
        text,
        html: stype === 'heading' ? undefined : getSanitizedElementHtml($, el, tagName)
      });
    });

    // PLOS ONE References
    const refList = $('.references, ol.references, #reference-list');
    if (refList.length > 0) {
      sections.push({
        sectionIndex: sectionIndex++,
        sectionType: 'heading',
        text: 'References'
      });
      hasDecSections = true;

      refList.find('li').each((i, li) => {
        const text = cleanText($(li).text());
        if (text) {
          sections.push({
            sectionIndex: sectionIndex++,
            sectionType: 'reference_item',
            text
          });
          hasStructuredRefs = true;
        }
      });
    }

  } else if (isPmc) {
    const abstractEl = $('.abstract, #abstract').first();
    if (abstractEl.length > 0) {
      const abstractText = cleanText(abstractEl.find('p').text() || abstractEl.text());
      if (abstractText) {
        sections.push({
          sectionIndex: sectionIndex++,
          sectionType: 'abstract',
          text: abstractText,
          html: getSanitizedElementHtml($, abstractEl, 'p')
        });
      }
    }

    const mcContent = $('#mc_content, .body, .jig-ncbiSec');
    if (mcContent.length > 0) {
      mcContent.find('h2, h3, h4, p, li').each((i, el) => {
        const tagName = el.name.toLowerCase();
        const text = cleanText($(el).text());
        if (!text) return;

        if ($(el).closest('.ref-list, #reference-list, .abstract, #abstract').length > 0) {
          return;
        }
        if (tagName === 'p' && $(el).closest('li').length > 0) {
          return;
        }

        let stype: ExtractedSection['sectionType'] = 'paragraph';
        if (tagName.startsWith('h')) {
          stype = 'heading';
          hasDecSections = true;
        } else if (tagName === 'li') {
          stype = 'list_item';
          hasDecSections = true;
        }

        sections.push({
          sectionIndex: sectionIndex++,
          sectionType: stype,
          text,
          html: stype === 'heading' ? undefined : getSanitizedElementHtml($, el, tagName)
        });
      });
    }

    const refList = $('.ref-list, #reference-list');
    if (refList.length > 0) {
      sections.push({
        sectionIndex: sectionIndex++,
        sectionType: 'heading',
        text: 'References'
      });
      hasDecSections = true;

      refList.find('li, .ref-citation').each((i, el) => {
        const text = cleanText($(el).text());
        if (text) {
          sections.push({
            sectionIndex: sectionIndex++,
            sectionType: 'reference_item',
            text
          });
          hasStructuredRefs = true;
        }
      });
    }

  } else {
    // --- B. GENERIC SEMANTIC HTML FALLBACK ---
    const abstractEl = $('.Abstract, .abstract, #abstract, [class*="abstract"]').first();
    if (abstractEl.length > 0) {
      const text = cleanText(abstractEl.find('p').text() || abstractEl.text());
      if (text) {
        sections.push({
          sectionIndex: sectionIndex++,
          sectionType: 'abstract',
          text,
          html: getSanitizedElementHtml($, abstractEl, 'p')
        });
      }
    }

    const wrappers = [
      'article', 
      'main',
      '[class*="article-body"]', 
      '[class*="article-content"]', 
      '[class*="entry-content"]', 
      '[class*="post-content"]',
      '.ArticleBody'
    ];
    
    let contentWrapper = null;
    for (const w of wrappers) {
      const match = $(w);
      if (match.length > 0) {
        contentWrapper = match.first();
        break;
      }
    }

    const targetArea = contentWrapper || $('body');

    targetArea.find('h2, h3, h4, p, li, figcaption').each((i, el) => {
      const tagName = el.name.toLowerCase();
      const text = cleanText($(el).text());
      if (!text) return;

      // Skip elements in common page structures (if using body fallback)
      if (!contentWrapper && $(el).closest('header, footer, nav, aside, .sidebar, .navigation, .footer, .header').length > 0) {
        return;
      }
      if ($(el).closest('.References, .references, #references, [class*="references"], .ref-list, .Abstract, .abstract, #abstract').length > 0) {
        return;
      }
      if (tagName === 'p' && $(el).closest('li').length > 0) {
        return;
      }

      let stype: ExtractedSection['sectionType'] = 'paragraph';
      if (tagName.startsWith('h')) {
        stype = 'heading';
        hasDecSections = true;
      } else if (tagName === 'li') {
        stype = 'list_item';
      } else if (tagName === 'figcaption') {
        stype = 'caption';
      }

      sections.push({
        sectionIndex: sectionIndex++,
        sectionType: stype,
        text,
        html: stype === 'heading' ? undefined : getSanitizedElementHtml($, el, tagName)
      });
    });

    const refsEl = $('.References, .references, #references, [class*="references"], .ref-list');
    if (refsEl.length > 0) {
      sections.push({
        sectionIndex: sectionIndex++,
        sectionType: 'heading',
        text: 'References'
      });
      hasDecSections = true;

      refsEl.find('li, p').each((i, el) => {
        const text = cleanText($(el).text());
        if (text && text.length > 15) {
          sections.push({
            sectionIndex: sectionIndex++,
            sectionType: 'reference_item',
            text
          });
          hasStructuredRefs = true;
        }
      });
    }
  }

  // Calculate statistics
  let totalWords = 0;
  let totalChars = 0;
  sections.forEach(s => {
    totalWords += s.text.split(/\s+/).filter(Boolean).length;
    totalChars += s.text.length;
  });

  const quality = hasStructuredRefs && hasDecSections ? 'high' : (hasDecSections ? 'medium' : 'low');

  return {
    success: true,
    engine: isFrontiers || isPlos || isPmc ? 'publisher_html' : 'sanitized_html',
    quality,
    structureVersion: 'html-cheerio-v2',
    hasStructuredReferences: hasStructuredRefs,
    hasDetectedSections: hasDecSections,
    wordCount: totalWords,
    characterCount: totalChars,
    title,
    authors,
    sections
  };
}
