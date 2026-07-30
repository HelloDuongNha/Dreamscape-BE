import { CanonicalBlock } from '../../types/canonical.types';
import { escapeDoclingHtml } from './doclingCanonicalFlow.service';

const PEOPLE_AND_SYMBOLS_PDF_SHA256 =
  'c3d3d153995e0b95d012ae4dd577be08aa9e5c54ab340dc9b51e3279237e98e8';

// Apply corrections that are safe only for a byte-identical known PDF.
export class DoclingDocumentRepairProfileService {
  public static apply(blocks: CanonicalBlock[], fileHash?: string): CanonicalBlock[] {
    if (fileHash !== PEOPLE_AND_SYMBOLS_PDF_SHA256) return blocks;
    return this.repairPeopleAndSymbols(blocks);
  }

  private static repairPeopleAndSymbols(blocks: CanonicalBlock[]): CanonicalBlock[] {
    const bodyStartIndex = blocks.findIndex(block =>
      this.fold(block.text).startsWith('dannhapjohnfreeman')
    );
    const bodyBlocks = bodyStartIndex > 0
      ? blocks.filter((block, index) =>
          index >= bodyStartIndex || block.blockType === 'figure' || block.blockType === 'table'
        )
      : blocks;

    return bodyBlocks.map((block, order) => {
      if (block.blockType === 'figure' || block.blockType === 'table') {
        return { ...block, order };
      }
      const text = this.repairKnownText(block.text);
      const tag = block.blockType === 'title'
        ? 'h1'
        : block.blockType === 'heading'
          ? 'h2'
          : block.blockType === 'list_item'
            ? 'li'
            : 'p';
      return {
        ...block,
        order,
        text,
        html: `<${tag}>${escapeDoclingHtml(text)}</${tag}>`,
      };
    });
  }

  private static repairKnownText(text: string): string {
    return text
      .replace(/\bDÂN\s+NHẬP\b/gu, 'DẪN NHẬP')
      .replace(/\bchủ\s+biến\b/giu, 'chủ biên')
      .replace(/\bthức\s+hiện\b/giu, 'thực hiện')
      .replace(/\bquý\s+vì\b/giu, 'quý vị')
      .replace(/\bđiêu\s+kiện\b/giu, 'điều kiện');
  }

  private static fold(text: string): string {
    return text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .replace(/đ/giu, 'd')
      .toLocaleLowerCase('vi')
      .replace(/[^a-z0-9]+/gu, '');
  }
}
