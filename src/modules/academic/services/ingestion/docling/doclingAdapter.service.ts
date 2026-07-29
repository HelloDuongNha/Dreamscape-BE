import { DoclingExtractionResult, DoclingArtifactDescriptor } from '../../types/docling.types';
import { CanonicalBlocksOutput, CanonicalBlock, BlockType, SemanticType } from '../../types/canonical.types';
import { DoclingReaderPolicyService } from './doclingReaderPolicy.service';
import { DoclingTextRepairService } from './doclingTextRepair.service';
import {
  escapeDoclingHtml,
  normalizeCanonicalFlow,
  normalizeDoclingTypography,
  stripPublisherDownloadNotice,
} from './doclingCanonicalFlow.service';

export interface DoclingAdapterOutput {
  canonicalOutput: CanonicalBlocksOutput;
  /** Verified figure artifact descriptors for D2 upload */
  figureArtifacts: DoclingArtifactDescriptor[];
  referenceQualityDegraded: boolean;
  detectedPictureCount: number;
  acceptedFigureCount: number;
  discardedFurnitureCount: number;
}

export class DoclingAdapterService {
  public static mapToCanonicalBlocks(
    extraction: DoclingExtractionResult,
    artifacts: DoclingArtifactDescriptor[],
  ): DoclingAdapterOutput {
    const blocks: CanonicalBlock[] = [];
    const figureArtifacts: DoclingArtifactDescriptor[] = [];
    const warnings: string[] = [];

    if (extraction.referenceQualityDegraded) {
      warnings.push(
        'Chất lượng tài liệu tham khảo bị giảm sút do Docling trộn lẫn các mục trích dẫn (ví dụ: Barrett và Barzilay).',
      );
    }

    // Build an index of validated artifact descriptors keyed by item ID
    const artifactById = new Map<string, DoclingArtifactDescriptor>(
      artifacts.map((a) => [a.itemId, a]),
    );

    // Normalize only the known page-one Abstract/Introduction column inversion.
    const orderedItems = DoclingReaderPolicyService.orderItemsForReader(extraction.items as any);

    // 1. Pre-process items to associate table captions
    const associatedTableCaptions = DoclingReaderPolicyService.associateTableCaptions(
      orderedItems as any
    );

    let orderCounter = 0;
    let detectedPictureCount = 0;
    let acceptedFigureCount = 0;

    for (const item of orderedItems) {
      if (item.type === 'figure') {
        detectedPictureCount++;
      }

      // 2. Evaluate block eligibility using Reader Policy Service
      const normalizedItemText = stripPublisherDownloadNotice(
        normalizeDoclingTypography(item.text)
      );
      const policyItem = { ...item, text: normalizedItemText };
      const policy = DoclingReaderPolicyService.evaluateItem(
        policyItem as any,
        associatedTableCaptions,
        orderedItems as any
      );

      if (policy.isExcluded) {
        continue;
      }

      const activeType = policy.blockTypeOverride || item.type;
      const itemText = policy.textOverride || normalizedItemText;
      const captionText = normalizeDoclingTypography(policy.captionText || item.caption || '');
      const normalizedTableHtml = activeType === 'table'
        ? DoclingTextRepairService.repairHtml(item.html || '')
        : item.html;
      const normalizedTableData = activeType === 'table' && item.tableData
        ? {
            ...item.tableData,
            cells: item.tableData.cells.map((cell) => ({
              ...cell,
              text: DoclingTextRepairService.repairText(cell.text || ''),
            })),
          }
        : item.tableData;

      // A renderable scientific figure must have meaningful reader text. The
      // caption is its canonical text; persisting an image-only block with an
      // empty string violates the AcademicChunk contract and is inaccessible.
      if (activeType === 'figure' && !captionText.trim()) {
        continue;
      }

      let blockType: BlockType = 'paragraph';
      let semanticType: SemanticType = 'paragraph';
      let htmlMarkup = '';
      let tableHtmlContent: string | undefined;

      const escapedText = escapeDoclingHtml(itemText);

      switch (activeType) {
        case 'title':
          blockType = 'title';
          semanticType = 'title';
          htmlMarkup = `<h1>${escapedText}</h1>`;
          break;
        case 'heading':
          blockType = 'heading';
          semanticType = 'heading';
          htmlMarkup = `<h2>${escapedText}</h2>`;
          break;
        case 'list_item':
          blockType = 'list_item';
          semanticType = 'list';
          htmlMarkup = `<li>${escapedText}</li>`;
          break;
        case 'reference':
          blockType = 'reference';
          semanticType = 'reference';
          htmlMarkup = `<p>${escapedText}</p>`;
          break;
        case 'table': {
          blockType = 'table';
          semanticType = 'table';
          tableHtmlContent = normalizedTableHtml || '';
          const captionHtml = captionText
            ? `<p class="caption"><strong>${escapeDoclingHtml(captionText)}</strong></p>`
            : '';
          htmlMarkup = `<div class="table-block">${captionHtml}<div class="table-wrapper">${tableHtmlContent}</div></div>`;
          break;
        }
        case 'figure': {
          blockType = 'figure';
          semanticType = 'figure';
          acceptedFigureCount++;
          htmlMarkup = '';

          const artifact = artifactById.get(item.id);
          if (artifact) {
            figureArtifacts.push({
              ...artifact,
              caption: captionText || undefined
            });
          } else {
            figureArtifacts.push({
              itemId: item.id,
              pageNumber: item.pageNumber,
              bbox: item.bbox,
              figureType: 'region_only',
              caption: captionText || undefined,
            });
          }
          break;
        }
        default:
          blockType = 'paragraph';
          semanticType = 'paragraph';
          htmlMarkup = `<p>${escapedText}</p>`;
      }

      blocks.push({
        blockType,
        semanticType,
        sectionHeading: null,
        text: (activeType === 'table' || activeType === 'figure') && captionText ? captionText : itemText,
        html: htmlMarkup,
        order: orderCounter++,
        pageNumber: item.pageNumber,
        tableHtmlContent,
        tableData: activeType === 'table' ? normalizedTableData : undefined,
        marker: activeType === 'figure' ? (item as any).marker || undefined : undefined
      });
    }

    const normalizedBlocks = DoclingTextRepairService
      .repairDocumentCorpus(normalizeCanonicalFlow(blocks))
      .map((block) => {
        if (block.blockType === 'table' || block.blockType === 'figure') return block;
        const tag = block.blockType === 'title'
          ? 'h1'
          : block.blockType === 'heading'
            ? 'h2'
            : block.blockType === 'list_item'
              ? 'li'
              : 'p';
        return { ...block, html: `<${tag}>${escapeDoclingHtml(block.text)}</${tag}>` };
      });
    const discardedFurnitureCount = detectedPictureCount - acceptedFigureCount;

    const canonicalOutput: CanonicalBlocksOutput = {
      title: extraction.title,
      parserEngine: 'docling',
      sourceType: 'uploaded_pdf',
      warnings,
      blocks: normalizedBlocks,
      success: extraction.success,
      error: extraction.errorDetail,
    };

    return {
      canonicalOutput,
      figureArtifacts,
      referenceQualityDegraded: extraction.referenceQualityDegraded,
      detectedPictureCount,
      acceptedFigureCount,
      discardedFurnitureCount
    };
  }
}
