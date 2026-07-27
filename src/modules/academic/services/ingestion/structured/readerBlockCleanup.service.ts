import { escapeReaderHtml } from './readerHtml.service';

const REFERENCE_JUNK = [
  'acknowledgements', 'acknowledgments', 'author contributions', 'contributions',
  'correspondence', 'ethics declarations', 'competing interests', 'supplementary information',
  'rights and permissions', 'about this article', 'share this article', 'search',
  'quick links', 'download references', 'similar content', 'download xlsx', 'download tiff',
  'open access license', 'license text',
];

const ENDMATTER_HEADINGS = [
  'acknowledgements', 'acknowledgments', 'funding', 'author contributions', 'contributions',
  'correspondence', 'ethics declarations', 'competing interests', 'conflict of interest',
  'supplementary information', 'additional information', 'rights and permissions',
  'open access license', 'publisher’s note', 'equal contribution notes', 'author information',
  'affiliations', 'share this article', 'search', 'quick links', 'download references',
  'download citation', 'related articles', 'similar content',
];

const CORE_HEADINGS = [
  'introduction', 'methods', 'results', 'discussion', 'abstract',
  'data availability', 'code availability', 'references', 'tài liệu tham khảo',
];

const PROTECTED_ORPHAN_HEADINGS = [
  'references', 'tài liệu tham khảo', 'introduction', 'methods', 'results',
  'discussion', 'conclusion', 'abstract', 'data availability', 'materials and methods',
];

const EMBEDDED_HEADINGS = [
  'INTRODUCTION', 'METHODS', 'MATERIALS AND METHODS', 'RESULTS', 'DISCUSSION',
  'CONCLUSION', 'CONCLUSIONS', 'REFERENCES', 'GIỚI THIỆU', 'PHƯƠNG PHÁP',
  'KẾT QUẢ', 'THẢO LUẬN', 'KẾT LUẬN', 'TÀI LIỆU THAM KHẢO', 'ABSTRACT', 'TÓM TẮT',
];

const END_METADATA_PREFIXES = [
  'acknowledgements', 'acknowledgments', 'funding', 'author contributions',
  'competing interests', 'conflict of interest', 'correspondence to', 'equal contribution',
  'supplementary information', 'additional information',
];

export function getFigureOrTableNumber(text: string): string {
  const match = (text || '').match(
    /(?:supplementary\s+)?(figure|figs?|fig|table|tabs?|hình|bảng)\.?\s*(\d+[a-z]?)/i,
  );
  return match ? match[2].toLowerCase() : '';
}

export function splitEmbeddedHeadings(blocks: any[]): any[] {
  const result: any[] = [];
  for (const block of blocks) {
    if (block.blockType === 'paragraph') {
      const text = block.text.trim();
      const heading = EMBEDDED_HEADINGS.find((candidate) => (
        text.startsWith(candidate)
        && text.length > candidate.length
        && /^\s+[A-Z\d©]/.test(text.substring(candidate.length))
      ));
      if (heading) {
        console.log(`[Reconciliation] Splitting embedded heading "${heading}" from paragraph text.`);
        const remainder = text.substring(heading.length).trim();
        result.push({
          ...block,
          blockType: 'heading',
          semanticType: 'heading',
          text: heading,
          html: `<h2>${escapeReaderHtml(heading)}</h2>`,
        });
        result.push({
          ...block,
          text: remainder,
          html: `<p>${escapeReaderHtml(remainder)}</p>`,
        });
        continue;
      }
    }
    result.push(block);
  }
  return result;
}

export function cleanEndmatterBlocks(blocks: any[]): any[] {
  const clean: any[] = [];
  let inEndmatter = false;

  for (const block of blocks) {
    const text = (block.text || '').trim();
    const lowerText = text.toLowerCase();
    if (block.blockType === 'heading') {
      if (ENDMATTER_HEADINGS.some((keyword) => lowerText.includes(keyword))) {
        inEndmatter = true;
      } else if (CORE_HEADINGS.some((keyword) => lowerText.includes(keyword))) {
        inEndmatter = false;
      }
    }

    if (inEndmatter) {
      console.log(`[Endmatter Cleanup] Discarding block in endmatter section: type=${block.blockType}, text="${text.substring(0, 80)}"`);
      continue;
    }

    const isJunkParagraph = block.blockType === 'paragraph'
      && END_METADATA_PREFIXES.some((prefix) => lowerText.startsWith(prefix))
      && text.length < 300;
    if (isJunkParagraph) {
      console.log(`[Endmatter Cleanup] Discarding standalone metadata paragraph: text="${text.substring(0, 80)}"`);
      continue;
    }
    clean.push(block);
  }
  return clean;
}

function cleanReferencesList(blocks: any[]): any[] {
  const clean: any[] = [];
  const seenCitations = new Set<string>();
  let sawReferenceHeader = false;
  let inReferences = false;
  let foundFirstCitation = false;

  for (const block of blocks) {
    const lowerText = (block.text || '').toLowerCase().trim();
    const isReferenceHeader = block.blockType === 'heading'
      && (lowerText.includes('references') || lowerText.includes('tài liệu tham khảo'));
    if (isReferenceHeader) {
      if (sawReferenceHeader) continue;
      sawReferenceHeader = true;
      inReferences = true;
      clean.push(block);
      continue;
    }

    const isReference = block.blockType === 'reference'
      || block.semanticType === 'reference'
      || block.blockType === 'reference_item';
    if (!inReferences) {
      if (!isReference) clean.push(block);
      continue;
    }

    if (block.blockType === 'heading') {
      inReferences = false;
      clean.push(block);
      continue;
    }
    if (!isReference) continue;

    const isJunk = REFERENCE_JUNK.some((prefix) => lowerText.includes(prefix))
      || lowerText.length < 25;
    if (isJunk) {
      console.log(`[References Cleanup] Discarding junk reference item: "${block.text.substring(0, 80)}"`);
      continue;
    }

    if (!foundFirstCitation) {
      const hasAuthorMarker = /^[A-Z][a-zA-Z\s]+,\s*[A-Z]/.test(block.text)
        || /^\d+\.\s+[A-Z]/.test(block.text)
        || /^\[\d+\]\s+[A-Z]/.test(block.text);
      const isWordy = block.text.split(/\s+/).length > 4;
      if (!hasAuthorMarker && !isWordy) {
        console.log(`[References Cleanup] Skipping pre-citation junk reference block: "${block.text.substring(0, 80)}"`);
        continue;
      }
      foundFirstCitation = true;
    }

    const normalized = lowerText.replace(/[^a-z0-9]/g, '');
    if (seenCitations.has(normalized)) {
      console.log(`[References Cleanup] Skipping duplicate reference: "${block.text.substring(0, 80)}"`);
      continue;
    }
    seenCitations.add(normalized);
    clean.push(block);
  }
  return clean;
}

function cleanOrphanHeadings(blocks: any[]): any[] {
  let result = [...blocks];
  for (let pass = 0; pass < 3; pass++) {
    for (let index = result.length - 1; index >= 0; index--) {
      const block = result[index];
      if (!block || block.blockType !== 'heading') continue;

      const lowerText = (block.text || '').toLowerCase().trim();
      const isProtected = PROTECTED_ORPHAN_HEADINGS.some(
        (keyword) => lowerText.includes(keyword),
      );
      let nextHeadingIndex = result.length;
      for (let cursor = index + 1; cursor < result.length; cursor++) {
        if (result[cursor]?.blockType === 'heading') {
          nextHeadingIndex = cursor;
          break;
        }
      }

      const hasContent = result.slice(index + 1, nextHeadingIndex).some((candidate) => (
        ['paragraph', 'table', 'figure', 'list_item', 'reference'].includes(candidate?.blockType)
      ));
      if (!hasContent && !isProtected) {
        console.log(`[Endmatter Cleanup] Removing empty/orphan heading: "${block.text}"`);
        result[index] = null;
      }
    }
    result = result.filter(Boolean);
  }
  return result;
}

function cleanConsecutiveParagraphs(blocks: any[]): any[] {
  const clean: any[] = [];
  let lastText = '';
  for (const block of blocks) {
    if (block.blockType === 'paragraph') {
      const normalized = (block.text || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (normalized && normalized === lastText) continue;
      lastText = normalized;
    }
    clean.push(block);
  }
  return clean;
}

export function finalizeReaderBlocks(blocks: any[]): any[] {
  return cleanConsecutiveParagraphs(cleanOrphanHeadings(cleanReferencesList(blocks)));
}
