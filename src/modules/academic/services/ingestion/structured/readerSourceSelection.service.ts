import type { FullTextCandidate } from '../../types/canonical.types';
import {
  boilerplateHeadings,
  garbagePatterns,
  navigationWidgetPatterns,
  pdfArtifactPatterns,
} from './academicCleanupRules';

export type ReaderSourcePolicy = 'any' | 'structured_only';

export function groupReaderCandidates(
  candidates: FullTextCandidate[],
  policy: ReaderSourcePolicy = 'any',
) {
  return {
    pdf: policy === 'structured_only'
      ? []
      : candidates.filter(candidate =>
          candidate.contentType === 'pdf'
          || candidate.sourceType === 'uploaded_pdf'
          || candidate.sourceType === 'pdf'),
    xml: candidates.filter(candidate =>
      candidate.contentType === 'xml' || candidate.sourceType === 'jats_xml'),
    publisherHtml: candidates.filter(candidate =>
      candidate.contentType === 'html' && candidate.sourceType === 'publisher_html'),
    genericHtml: candidates.filter(candidate =>
      candidate.contentType === 'html' && candidate.sourceType === 'generic_html'),
  };
}

export function classifyBlock(block: any, index: number, total: number, sourceType: string): string {
  const text = String(block?.text || '').trim();
  const lowerText = text.toLowerCase();
  if (!text) return 'unknown_noise';

  if (block.blockType === 'reference' || block.semanticType === 'reference' || block.blockType === 'reference_item') {
    return 'article_reference';
  }
  if (block.blockType === 'figure') return 'article_figure';
  if (block.blockType === 'table') return 'article_table';
  if (block.blockType === 'caption') return 'article_caption';
  if (navigationWidgetPatterns.some(pattern => pattern.test(lowerText))) return 'navigation_or_widget';

  if ((/^page\s+\d+$/i.test(lowerText) || /^page\s+\d+\s+of\s+\d+$/i.test(lowerText) || /^\d+\s*$/i.test(lowerText))
    && text.length < 30) {
    return 'pdf_page_marker';
  }
  if (pdfArtifactPatterns.some(pattern => pattern.test(lowerText)) && text.length < 250) {
    return 'pdf_header_footer';
  }
  if (garbagePatterns.some(pattern => pattern.test(lowerText))) return 'garbage_noise';
  if (['verify you are human', 'ddos protection', 'cloudflare', 'client challenge', 'access denied']
    .some(marker => lowerText.includes(marker))) {
    return 'challenge_or_block_page';
  }

  const hasEmail = text.includes('@') || /orcid/i.test(lowerText);
  if (hasEmail && text.length < 250
    && (/email|correspondence|contact|✉/i.test(lowerText)
      || /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(text)
      || lowerText.includes('orcid'))) {
    return 'correspondence_email';
  }

  const institutionKeywords = [
    'university', 'department', 'institute', 'hospital', 'school of', 'academy',
    'clinic', 'center for', 'laboratory', 'laboratories', 'universiteit',
    'universidad', 'faculdade', 'faculty',
  ];
  const hasInstitution = institutionKeywords.some(keyword => lowerText.includes(keyword));
  const hasPointerPrefix = /^\d+([,\d*✉]*)\s*/.test(text) || /^[a-z]\d+/.test(lowerText);
  const lacksTrailingPunctuation = !/[.!?]$/.test(text);
  if (
    block.blockType !== 'heading'
    && text.length < 400
    && (hasInstitution || (lacksTrailingPunctuation && (hasPointerPrefix || text.length < 150)))
  ) {
    return 'author_affiliation';
  }

  if (block.blockType === 'heading' && boilerplateHeadings.some(pattern => pattern.test(lowerText))) {
    return 'publisher_boilerplate';
  }
  if (sourceType === 'pdf') {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const numberCount = (text.match(/\b\d+(\.\d+)?\b/g) || []).length;
    if (wordCount > 5 && numberCount / wordCount > 0.4 && text.length < 350) {
      return 'table_fragment';
    }
  }
  if (block.blockType === 'title' || block.semanticType === 'title') return 'article_title';
  if (block.blockType === 'abstract' || block.semanticType === 'abstract' || (index < 12 && lowerText.startsWith('abstract'))) {
    return 'article_abstract';
  }
  if (block.blockType === 'heading') return 'article_heading';
  if (block.blockType === 'paragraph' && text.length < 15 && !block.sectionHeading) return 'garbage_noise';
  return 'article_paragraph';
}

function hasCleanFullBody(parsed: any): boolean {
  if (!Array.isArray(parsed?.blocks)) return false;
  const paragraphs = parsed.blocks.filter((block: any) =>
    classifyBlock(block, 0, parsed.blocks.length, parsed.sourceType) === 'article_paragraph');
  const wordCount = paragraphs.reduce(
    (total: number, block: any) => total + String(block.text || '').split(/\s+/).filter(Boolean).length,
    0,
  );
  const headingCount = parsed.blocks.filter((block: any) => block.blockType === 'heading').length;
  return wordCount > 300 && headingCount > 2;
}

function artifactRatio(parsed: any): number {
  if (!Array.isArray(parsed?.blocks) || parsed.blocks.length === 0) return 1;
  const artifactClasses = new Set([
    'pdf_page_marker',
    'pdf_header_footer',
    'author_affiliation',
    'correspondence_email',
    'navigation_or_widget',
    'table_fragment',
    'garbage_noise',
  ]);
  const artifactCount = parsed.blocks.filter((block: any, index: number) =>
    artifactClasses.has(classifyBlock(block, index, parsed.blocks.length, parsed.sourceType))).length;
  return artifactCount / parsed.blocks.length;
}

export function selectPreferredReaderSource(input: {
  parsedXml: any;
  parsedHtml: any;
  parsedPdf: any;
}) {
  if (input.parsedXml && hasCleanFullBody(input.parsedXml)) {
    return { selectedSource: input.parsedXml, decision: 'clean_xml', pdfArtifactRatio: null };
  }
  if (
    input.parsedHtml
    && input.parsedHtml.sourceType === 'publisher_html'
    && hasCleanFullBody(input.parsedHtml)
  ) {
    return { selectedSource: input.parsedHtml, decision: 'clean_publisher_html', pdfArtifactRatio: null };
  }
  if (input.parsedPdf && input.parsedPdf.wordCount > 50) {
    const ratio = artifactRatio(input.parsedPdf);
    if (ratio < 0.3) {
      return { selectedSource: input.parsedPdf, decision: 'low_noise_pdf', pdfArtifactRatio: ratio };
    }
    return {
      selectedSource: input.parsedHtml || input.parsedXml || input.parsedPdf,
      decision: 'fallback_after_noisy_pdf',
      pdfArtifactRatio: ratio,
    };
  }
  return {
    selectedSource: input.parsedHtml || input.parsedPdf || input.parsedXml || null,
    decision: 'first_available_fallback',
    pdfArtifactRatio: null,
  };
}
