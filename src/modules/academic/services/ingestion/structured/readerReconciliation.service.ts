import { boilerplateHeadings, navigationWidgetPatterns } from './academicCleanupRules';
import { classifyBlock, selectPreferredReaderSource } from './readerSourceSelection.service';
import {
  cleanEndmatterBlocks,
  finalizeReaderBlocks,
  getFigureOrTableNumber,
  splitEmbeddedHeadings,
} from './readerBlockCleanup.service';
import {
  reconcileReaderFigures,
  resolveReaderImageUrl,
} from './readerFigureReconciliation.service';
import {
  deduplicateAndFormatTables,
  hydrateLinkedTables,
} from './readerTableProcessing.service';

interface ReconciliationInput {
  source: any;
  parsedPdf?: any;
  parsedXml?: any;
  parsedHtml?: any;
  pmcImageMap?: Map<string, string>;
  pmcPublicIdByUrl: Map<string, string>;
}

export interface ReconciliationResult {
  blocks: any[];
  selectedSourceType: string;
  parserEngineUsed: string;
  documentTitle: string;
  isValid: boolean;
  isChallengePage: boolean;
  isMetadataOnly: boolean;
}

function filterArticleBlocks(
  blocks: any[],
  selectedSourceType: string,
  pdfHeadings: string[],
): any[] {
  let skipWidgetGroup = false;
  const sourceBlocks = cleanEndmatterBlocks([...blocks]);
  return sourceBlocks.filter((block, index) => {
    const lowerText = (block.text || '').trim().toLowerCase();
    const classification = classifyBlock(block, index, sourceBlocks.length, selectedSourceType);
    if (block.blockType === 'heading') {
      if (navigationWidgetPatterns.some((pattern) => pattern.test(lowerText))) {
        skipWidgetGroup = true;
        return false;
      }
      const isRealSection = [
        'introduction', 'methods', 'results', 'discussion', 'references',
        'data availability', 'materials and methods', 'abstract',
      ].some((keyword) => lowerText.includes(keyword)) || pdfHeadings.includes(lowerText);
      if (isRealSection) skipWidgetGroup = false;
    }
    return !skipWidgetGroup && classification.startsWith('article_');
  });
}

async function enrichPdfMedia(
  blocks: any[],
  enrichBlocks: any[],
  verifiedUrls: Map<string, string | null>,
  retryCounts: Map<string, number>,
  pmcImageMap?: Map<string, string>,
): Promise<any[]> {
  const structuredMedia = enrichBlocks.filter(
    (block) => block.blockType === 'figure' || block.blockType === 'table',
  );
  return Promise.all(blocks.map(async (block) => {
    if (block.blockType !== 'figure' && block.blockType !== 'table') return block;

    const number = getFigureOrTableNumber(block.text);
    const match = number
      ? structuredMedia.find((candidate) => (
          getFigureOrTableNumber(candidate.text) === number
          && candidate.blockType === block.blockType
        ))
      : undefined;
    if (match && block.blockType === 'figure') {
      const imageUrl = match.imageUrl
        || String(match.html || '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]
        || '';
      const verifiedUrl = await resolveReaderImageUrl(
        imageUrl,
        verifiedUrls,
        retryCounts,
        pmcImageMap,
      );
      if (verifiedUrl) {
        console.log(`[Reconciliation] Merging verified structured figure metadata for index ${number}`);
        match.imageUrl = verifiedUrl;
        match.html = match.html.replace(
          /(<img[^>]+src=["'])([^"']*)(["'])/i,
          `$1${verifiedUrl}$3`,
        );
        return {
          ...block,
          text: match.text || block.text,
          html: match.html,
          style: { ...(block.style || {}), ...(match.style || {}) },
        };
      }
      console.log(`[Reconciliation] Skipping unverified structured figure enrichment for index ${number}`);
    } else if (match) {
      console.log(`[Reconciliation] Merging structured ${block.blockType} metadata for index ${number}`);
      return {
        ...block,
        text: match.text || block.text,
        html: match.html || block.html,
        style: { ...(block.style || {}), ...(match.style || {}) },
      };
    }

    if (!block.html || block.html.startsWith('<p>') || block.html.includes('placeholder-error')) {
      block.html = '';
    }
    return block;
  }));
}

function removeStructuredBoilerplate(
  blocks: any[],
  selectedSourceType: string,
  pdfHeadings: string[],
  hasPdf: boolean,
): any[] {
  let skipSection = false;
  return blocks.map((block) => {
    const lowerText = (block.text || '').toLowerCase().trim();
    if (block.blockType === 'heading') {
      const isBoilerplate = boilerplateHeadings.some((pattern) => pattern.test(lowerText));
      if (isBoilerplate) {
        const hardExcludes = [
          'rights and permissions', 'about this article', 'cite this article',
          'download references', 'similar content', 'sign in', 'log in', 'subscribe',
        ];
        if (hardExcludes.some((keyword) => lowerText.includes(keyword))) {
          skipSection = true;
          return null;
        }
        const absentFromPdf = hasPdf
          && !pdfHeadings.some((heading) => heading.includes(lowerText) || lowerText.includes(heading));
        if (absentFromPdf || (!hasPdf && selectedSourceType.includes('html'))) {
          skipSection = true;
          return null;
        }
      }
      skipSection = false;
    }
    return skipSection ? null : block;
  }).filter(Boolean);
}

function restoreStructuredReferences(
  blocks: any[],
  selectedSourceType: string,
  parsedXml?: any,
  parsedHtml?: any,
): any[] {
  const enrichSource = parsedXml || parsedHtml;
  const references = enrichSource
    ? enrichSource.blocks.filter(
        (block: any) => block.blockType === 'reference' || block.semanticType === 'reference',
      )
    : [];
  if (selectedSourceType !== 'pdf' || references.length === 0) return blocks;

  console.log(`[Reconciliation] Restoring references using HTML/XML references count: ${references.length}`);
  const headingIndex = blocks.findIndex((block) => (
    block.blockType === 'heading'
    && (
      block.text.toLowerCase().includes('references')
      || block.text.toLowerCase().includes('tài liệu tham khảo')
    )
  ));
  const restored = headingIndex === -1 ? [...blocks] : blocks.slice(0, headingIndex);
  restored.push({
    blockType: 'heading',
    semanticType: 'heading',
    sectionHeading: null,
    text: 'REFERENCES',
    html: '<h2>REFERENCES</h2>',
    order: restored.length,
  });
  references.forEach((reference: any) => {
    restored.push({
      ...reference,
      sectionHeading: 'REFERENCES',
      order: restored.length,
    });
  });
  return restored;
}

export async function reconcileReaderCandidates({
  source,
  parsedPdf,
  parsedXml,
  parsedHtml,
  pmcImageMap,
  pmcPublicIdByUrl,
}: ReconciliationInput): Promise<ReconciliationResult> {
  const selection = selectPreferredReaderSource({ parsedXml, parsedHtml, parsedPdf });
  console.log(`[Reimport Selection] ${selection.decision}${selection.pdfArtifactRatio === null
    ? ''
    : ` (PDF artifact ratio ${(selection.pdfArtifactRatio * 100).toFixed(1)}%)`}`);

  const pdfHeadings = parsedPdf
    ? parsedPdf.blocks
        .filter((block: any) => block.blockType === 'heading')
        .map((block: any) => block.text.toLowerCase().trim().replace(/\s+/g, ' '))
    : [];
  const selected = selection.selectedSource;
  let blocks: any[] = [];
  let selectedSourceType = 'none';
  let parserEngineUsed = 'none';
  let documentTitle = source.title;

  if (selected) {
    selectedSourceType = selected.sourceType;
    parserEngineUsed = selected.parserEngine;
    documentTitle = selected.title;
    const verifiedUrls = new Map<string, string | null>();
    const retryCounts = new Map<string, number>();
    blocks = filterArticleBlocks(selected.blocks, selectedSourceType, pdfHeadings);

    if (selectedSourceType === 'pdf') {
      console.log('[Reconciliation] PDF selected as main body source. Enriching tables & figures from XML/HTML...');
      blocks = await enrichPdfMedia(
        blocks,
        (parsedXml || parsedHtml)?.blocks || [],
        verifiedUrls,
        retryCounts,
        pmcImageMap,
      );
    } else {
      console.log('[Reconciliation] JATS/XML or HTML selected as main body source. Performing structural validation and boilerplate exclusions using PDF...');
      blocks = removeStructuredBoilerplate(
        blocks,
        selectedSourceType,
        pdfHeadings,
        Boolean(parsedPdf),
      );
    }

    blocks = splitEmbeddedHeadings(blocks);
    await hydrateLinkedTables(blocks, selectedSourceType, source.url);
    blocks = await reconcileReaderFigures(
      blocks,
      verifiedUrls,
      retryCounts,
      pmcImageMap,
      pmcPublicIdByUrl,
    );
    blocks = deduplicateAndFormatTables(blocks);
    blocks = restoreStructuredReferences(blocks, selectedSourceType, parsedXml, parsedHtml);
  }

  blocks = finalizeReaderBlocks(blocks);
  const totalLength = blocks.reduce((sum, block) => sum + (block.text || '').length, 0);
  const isChallengePage = blocks.some((block) => {
    const text = (block.text || '').toLowerCase();
    return text.includes('verify you are human')
      || text.includes('ddos protection')
      || text.includes('cloudflare');
  });
  const isMetadataOnly = totalLength < 400
    || blocks.filter((block) => block.blockType === 'paragraph').length < 2;
  let isValid = blocks.length > 0 && !isChallengePage && !isMetadataOnly;

  if (selectedSourceType === 'pdf') {
    const artifactCount = blocks.filter((block) => {
      const classification = classifyBlock(block, 0, blocks.length, 'pdf');
      return classification === 'pdf_page_marker'
        || classification === 'pdf_header_footer'
        || classification === 'table_fragment';
    }).length;
    if (artifactCount / blocks.length > 0.3) {
      console.warn(`[Reconciliation] PDF artifact density too high (${artifactCount}/${blocks.length}). Rejecting save.`);
      isValid = false;
    }
  }

  return {
    blocks,
    selectedSourceType,
    parserEngineUsed,
    documentTitle,
    isValid,
    isChallengePage,
    isMetadataOnly,
  };
}
