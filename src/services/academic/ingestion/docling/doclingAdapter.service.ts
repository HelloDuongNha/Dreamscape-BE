import { DoclingExtractionResult, DoclingArtifactDescriptor } from '../../types/docling.types';
import { CanonicalBlocksOutput, CanonicalBlock, BlockType, SemanticType } from '../../types/canonical.types';
import { DoclingReaderPolicyService } from './doclingReaderPolicy.service';
import { DoclingTextRepairService } from './doclingTextRepair.service';

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
  /**
   * Cleans trailing accent characters separated by whitespace from letters
   * due to raw PDF parser font decoding failures, and handles ligatures.
   */
  private static normalizePdfTypography(text: string): string {
    const accentMarks: Record<string, string> = {
      '˜': '\u0303',
      '¨': '\u0308',
      '`': '\u0300',
      '´': '\u0301',
      '^': '\u0302',
    };

    // Some embedded PDF fonts expose a footnote glyph as ETX/U+FFFD. Preserve
    // its role as an unresolved marker without showing a replacement diamond.
    let normalized = text.replace(/[\u0003\uFFFD]/g, '*').replace(
      /\s+([˜¨`´^])\s+([\p{L}])/gu,
      (_match, mark: string, letter: string) => `${letter}${accentMarks[mark]}`.normalize('NFC'),
    );

    normalized = normalized.replace(/([\p{L}])\s+(['’])\s+([\p{L}])/gu, '$1$2$3');
    return DoclingTextRepairService.repairText(normalized);
  }

  private static stripPublisherDownloadNotice(text: string): string {
    const notice = /downloaded\s+from\s+https?\s*:\s*\/?\/?/i.exec(text);
    if (!notice) return text;
    const tail = text.slice(notice.index).toLowerCase();
    if (!tail.includes('terms and conditions') && !tail.includes('online library')) return text;

    // Publisher watermarks often prepend ISSN, year and issue immediately
    // before "Downloaded from". Remove that prefix too, but preserve all body
    // text occurring before the watermark on the same extracted block.
    const prefix = text.slice(0, notice.index);
    const metadataPrefix = /\b\d{6,9}\s*,\s*(?:19|20)\d{2}\s*,\s*\d+\s*,\s*$/i.exec(prefix);
    const cutIndex = metadataPrefix ? metadataPrefix.index : notice.index;
    return text.slice(0, cutIndex).trim();
  }

  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private static startsWithLowercase(text: string): boolean {
    return /^\p{Ll}/u.test(text.trim());
  }

  private static isSentenceContinuation(previous: string, next: string): boolean {
    const left = previous.trim();
    if (!left || !this.startsWithLowercase(next)) return false;
    return !/[.!?。！？:;"'”’\])}]$/.test(left);
  }

  private static joinContinuation(previous: string, next: string): string {
    const left = previous.trimEnd();
    const right = next.trimStart();
    return left.endsWith('-') ? `${left.slice(0, -1)}${right}` : `${left} ${right}`;
  }

  private static isStandaloneReferenceIdentifier(text: string): boolean {
    const clean = text.trim().replace(/[.,;]+$/, '');
    return /^(?:(?:https?:\/\/(?:dx\.)?doi\.org\/)|(?:doi\s*:\s*))?10\.\d{4,9}\/\S+$/i.test(clean);
  }

  /**
   * Repair conservative cross-page flow defects after structural filtering:
   * - join adjacent lowercase paragraph continuations;
   * - join a continuation separated only by a floating table and its Note,
   *   leaving the table/note after the completed paragraph;
   * - attach a DOI-only reference line to the preceding reference.
   */
  private static normalizeCanonicalFlow(input: CanonicalBlock[]): CanonicalBlock[] {
    const blocks = [...input];

    for (let i = 0; i < blocks.length; i++) {
      const current = blocks[i];

      if (
        current.blockType === 'reference' &&
        this.isStandaloneReferenceIdentifier(current.text) &&
        i > 0 &&
        blocks[i - 1].blockType === 'reference'
      ) {
        const previous = blocks[i - 1];
        previous.text = `${previous.text.trim()} ${current.text.trim()}`;
        previous.html = `<p>${this.escapeHtml(previous.text)}</p>`;
        blocks.splice(i, 1);
        i -= 1;
        continue;
      }

      if (current.blockType !== 'paragraph') continue;

      const next = blocks[i + 1];
      if (next?.blockType === 'paragraph' && this.isSentenceContinuation(current.text, next.text)) {
        current.text = this.joinContinuation(current.text, next.text);
        current.html = `<p>${this.escapeHtml(current.text)}</p>`;
        blocks.splice(i + 1, 1);
        i -= 1;
        continue;
      }

      let cursor = i + 1;
      let sawTable = false;
      while (cursor < blocks.length) {
        const candidate = blocks[cursor];
        if (candidate.blockType === 'table') {
          sawTable = true;
          cursor += 1;
          continue;
        }
        if (sawTable && candidate.blockType === 'paragraph' && /^note\s*[.:]/i.test(candidate.text.trim())) {
          cursor += 1;
          continue;
        }
        break;
      }

      const continuation = blocks[cursor];
      if (
        sawTable &&
        continuation?.blockType === 'paragraph' &&
        this.isSentenceContinuation(current.text, continuation.text)
      ) {
        current.text = this.joinContinuation(current.text, continuation.text);
        current.html = `<p>${this.escapeHtml(current.text)}</p>`;
        blocks.splice(cursor, 1);
        i -= 1;
      }
    }

    blocks.forEach((block, index) => { block.order = index; });
    return blocks;
  }

  /**
   * Maps a DoclingExtractionResult to canonical blocks using DoclingReaderPolicyService.
   */
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
      const normalizedItemText = this.stripPublisherDownloadNotice(
        this.normalizePdfTypography(item.text)
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
      const itemText = normalizedItemText;
      const captionText = this.normalizePdfTypography(policy.captionText || item.caption || '');
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

      const escapedText = this.escapeHtml(itemText);

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
            ? `<p class="caption"><strong>${this.escapeHtml(captionText)}</strong></p>`
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

    const normalizedBlocks = this.normalizeCanonicalFlow(blocks);
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
