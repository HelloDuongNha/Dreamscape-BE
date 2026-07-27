import { DoclingItem } from '../../types/docling.types';
import { DoclingBBox, DoclingReaderOrderService } from './doclingReaderOrder.service';

type NumberedFigureCaption = {
  item: DoclingItem;
  number: number;
  text: string;
  standalone: boolean;
};

export class DoclingCaptionPolicyService {
  public static isTableCaptionText(text: string): boolean {
    return /^(table|tab\.|bảng|bang|bg\.)\s*\d+/i.test(text.trim().toLowerCase());
  }

  public static isFigureCaptionText(text: string): boolean {
    return /^(figure|fig\.|fig|hình|hinh|hđ\.)\s*\d+/i.test(text.trim().toLowerCase());
  }

  public static extractNumberedFigureCaption(item: DoclingItem): NumberedFigureCaption | undefined {
    const text = item.text.trim();
    const match = text.match(/(?:^|(?<=[.!?]\s))((?:figure|fig\.?|hình|hinh)\s*(\d+)\s*[:.−–—-]\s*[\s\S]+)$/iu);
    const caption = match?.[1]?.trim();
    const number = Number.parseInt(match?.[2] || '', 10);
    if (!caption || !Number.isFinite(number) || caption.length < 18 || caption.length > 700) return undefined;
    return { item, number, text: caption, standalone: text === caption };
  }

  // Attach a same-page caption to the table it spatially describes.
  public static associateTableCaptions(items: DoclingItem[]): Map<string, string> {
    const associated = new Map<string, string>();
    const usedItemIds = new Set<string>();
    const tables = items.filter((item) => item.type === 'table' && item.bbox);

    for (const table of tables) {
      const tableBox = table.bbox as DoclingBBox;
      const tableTop = tableBox[1];
      const candidates = items
        .filter((item) => {
          if (
            usedItemIds.has(item.id) ||
            item.pageNumber !== table.pageNumber ||
            !item.bbox ||
            (item.type !== 'caption' && !this.isTableCaptionText(item.text))
          ) return false;
          const box = item.bbox as DoclingBBox;
          const gap = box[3] - tableTop;
          return gap >= -5 && gap <= 40 && DoclingReaderOrderService.horizontalOverlap(box, tableBox) > 0;
        })
        .sort((a, b) =>
          Math.abs((a.bbox as DoclingBBox)[3] - tableTop) -
          Math.abs((b.bbox as DoclingBBox)[3] - tableTop)
        );

      const primary = candidates[0];
      if (!primary?.bbox) continue;
      let captionText = primary.text.trim();
      const primaryBox = primary.bbox as DoclingBBox;
      usedItemIds.add(primary.id);
      (primary as any)._isMergedTableCaption = true;

      if (/^(table|tab\.|bảng|bang|bg\.)\s*\d+\s*$/i.test(captionText)) {
        const secondary = items
          .filter((item) => {
            if (
              usedItemIds.has(item.id) ||
              item.id === table.id ||
              item.pageNumber !== table.pageNumber ||
              !item.bbox ||
              (item.type !== 'paragraph' && item.type !== 'caption') ||
              !item.text.trim() ||
              item.text.length > 500 ||
              this.isTableCaptionText(item.text) ||
              this.isFigureCaptionText(item.text)
            ) return false;
            const box = item.bbox as DoclingBBox;
            const belowPrimary = box[1] <= primaryBox[3] + 5;
            const aboveTable = box[3] >= tableTop - 5;
            return belowPrimary && aboveTable && DoclingReaderOrderService.horizontalOverlap(box, tableBox) > 0;
          })
          .sort((a, b) =>
            Math.abs(primaryBox[3] - (a.bbox as DoclingBBox)[1]) -
            Math.abs(primaryBox[3] - (b.bbox as DoclingBBox)[1])
          )[0];
        if (secondary) {
          captionText = `${captionText} — ${secondary.text.trim()}`;
          usedItemIds.add(secondary.id);
          (secondary as any)._isMergedTableCaption = true;
        }
      }
      associated.set(table.id, captionText);
    }
    return associated;
  }

  public static findNearbyFigureCaption(item: DoclingItem, allItems: DoclingItem[]): DoclingItem | undefined {
    if (!item.bbox) return undefined;
    const figureBox = item.bbox as DoclingBBox;
    return allItems
      .filter((other) => {
        if (other.id === item.id || other.pageNumber !== item.pageNumber || !other.bbox) return false;
        if (other.type !== 'caption' && !this.isFigureCaptionText(other.text)) return false;
        const captionBox = other.bbox as DoclingBBox;
        const gapBelow = figureBox[3] - captionBox[1];
        return gapBelow >= -10 &&
          gapBelow <= 150 &&
          DoclingReaderOrderService.horizontalOverlap(figureBox, captionBox) > 0;
      })
      .sort((a, b) =>
        Math.abs(figureBox[3] - (a.bbox as DoclingBBox)[1]) -
        Math.abs(figureBox[3] - (b.bbox as DoclingBBox)[1])
      )[0];
  }

  // Match multi-image layouts only when captions form one complete sequence.
  public static findClusteredFigureCaption(item: DoclingItem, allItems: DoclingItem[]): DoclingItem | undefined {
    if (!item.bbox || item.type !== 'figure') return undefined;
    const pageFigures = allItems
      .filter((candidate) =>
        candidate.type === 'figure' &&
        candidate.pageNumber === item.pageNumber &&
        candidate.bbox &&
        !candidate.caption?.trim() &&
        !this.findNearbyFigureCaption(candidate, allItems)
      )
      .sort((left, right) => {
        const leftBox = left.bbox as DoclingBBox;
        const rightBox = right.bbox as DoclingBBox;
        const sameRow = Math.abs(leftBox[1] - rightBox[1]) <= 30;
        return sameRow ? leftBox[0] - rightBox[0] : rightBox[1] - leftBox[1];
      });
    if (!pageFigures.length) return undefined;

    const previousPageHasUncaptionedFigure = allItems.some((candidate) =>
      candidate.type === 'figure' &&
      candidate.pageNumber === item.pageNumber - 1 &&
      !candidate.caption?.trim() &&
      !this.findNearbyFigureCaption(candidate, allItems)
    );
    const numbered = allItems
      .filter((candidate) =>
        candidate.pageNumber === item.pageNumber ||
        (candidate.pageNumber === item.pageNumber - 1 && !previousPageHasUncaptionedFigure)
      )
      .map((candidate) => this.extractNumberedFigureCaption(candidate))
      .filter((candidate): candidate is NumberedFigureCaption => Boolean(candidate));

    const uniqueByNumber = new Map<number, NumberedFigureCaption>();
    for (const candidate of numbered) {
      if (!uniqueByNumber.has(candidate.number)) uniqueByNumber.set(candidate.number, candidate);
    }
    const orderedCaptions = [...uniqueByNumber.values()].sort((a, b) => a.number - b.number);
    const consecutive = orderedCaptions.every(
      (candidate, index) => index === 0 || candidate.number === orderedCaptions[index - 1].number + 1
    );
    if (!consecutive || orderedCaptions.length !== pageFigures.length) return undefined;

    const figureIndex = pageFigures.findIndex((candidate) => candidate.id === item.id);
    const match = orderedCaptions[figureIndex];
    return match ? { ...match.item, text: match.text } : undefined;
  }

  public static verifyStrictUntitledFigure(item: DoclingItem, allItems: DoclingItem[]): boolean {
    if (
      item.figureType !== 'embedded' ||
      !item.filePath ||
      !item.imageHash ||
      !item.bbox ||
      !item.width ||
      !item.height
    ) return false;

    const pixelArea = item.width * item.height;
    const aspectRatio = item.width / item.height;
    const box = item.bbox as DoclingBBox;
    const boxArea = Math.abs((box[2] - box[0]) * (box[1] - box[3]));
    if (
      pixelArea < 70_000 ||
      Math.min(item.width, item.height) < 100 ||
      aspectRatio < 0.25 ||
      aspectRatio > 4 ||
      boxArea < 10_000
    ) return false;

    const duplicateCount = allItems.filter(
      (candidate) => candidate.type === 'figure' && candidate.imageHash === item.imageHash
    ).length;
    const pageHasBodyProse = allItems.some(
      (candidate) =>
        candidate.pageNumber === item.pageNumber &&
        (candidate.type === 'paragraph' || candidate.type === 'list_item') &&
        candidate.text.trim().length >= 80
    );
    return duplicateCount === 1 && pageHasBodyProse;
  }

  public static buildUntitledFigureCaption(item: DoclingItem, allItems: DoclingItem[]): string {
    const pageText = allItems
      .filter((candidate) => candidate.pageNumber === item.pageNumber)
      .map((candidate) => candidate.text)
      .join(' ');
    const isVietnamese = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/iu.test(pageText);
    return isVietnamese
      ? `Hình minh họa không có chú thích · trang ${item.pageNumber}`
      : `Untitled figure · page ${item.pageNumber}`;
  }
}
