import { DoclingItem } from '../../types/docling.types';

export interface DoclingPolicyResult {
  isExcluded: boolean;
  blockTypeOverride?: 'title' | 'heading' | 'paragraph' | 'list_item' | 'reference' | 'table' | 'figure';
  captionText?: string;
}

type BBox = [number, number, number, number];

export class DoclingReaderPolicyService {
  private static normalizeLabel(text: string): string {
    return text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  private static isAbstractHeading(text: string): boolean {
    const normalized = this.normalizeLabel(text).replace(/^\d+/, '');
    return ['abstract', 'summary', 'tomtat', 'resume', 'resumen', 'zusammenfassung'].includes(normalized);
  }

  private static isKeywordHeading(text: string): boolean {
    const normalized = this.normalizeLabel(text);
    return ['keyword', 'keywords', 'keywordindex', 'tukhoá', 'tukhoa'].includes(normalized);
  }

  private static isIntroductionHeading(text: string): boolean {
    const normalized = this.normalizeLabel(text).replace(/^\d+(?:\d+)*/, '');
    return ['introduction', 'gioithieu', 'datvande', 'mởđầu', 'modau'].includes(normalized);
  }

  private static isBodyStartHeading(item: DoclingItem): boolean {
    return item.type === 'heading' && (
      this.isAbstractHeading(item.text) || this.isIntroductionHeading(item.text)
    );
  }

  /**
   * Docling can emit the left-column Introduction before the right-column
   * Abstract on page one. Move only the page-one Abstract group ahead of the
   * Introduction group; preserve every other item in its original relative order.
   */
  public static orderItemsForReader(items: DoclingItem[]): DoclingItem[] {
    const ordered = [...items];

    // Some publisher PDFs cause Docling to label the author line as `title`
    // while the real article title is the nearest preceding heading. Detect
    // this from structure (a title followed by numbered affiliations), not
    // publisher wording, so the author list never becomes the reader title.
    for (let index = 0; index < ordered.length; index++) {
      const candidate = ordered[index];
      if (candidate.pageNumber !== 1 || candidate.type !== 'title') continue;
      const following = ordered.slice(index + 1, index + 5);
      const hasNumberedAffiliations = following.some((item) =>
        item.pageNumber === 1 && /^(?:\d+|[a-z])\s+(?:department|division|faculty|centre|center|institute|university|hospital|school|laboratory)\b/i.test(item.text.trim())
      );
      const looksLikeAuthorList = /\s[|·]\s/.test(candidate.text) ||
        /\b\p{Lu}[\p{L}'’-]+\s+\p{Lu}[\p{L}'’-]+\s*\d+(?:\s*,\s*\d+)*\b/u.test(candidate.text);
      if (!hasNumberedAffiliations || !looksLikeAuthorList) continue;

      (candidate as any)._isFrontMatterMetadata = true;
      for (let cursor = index - 1; cursor >= 0; cursor--) {
        const preceding = ordered[cursor];
        if (preceding.pageNumber !== 1) break;
        if (preceding.type === 'heading' && !/^(review|research|original|clinical)\s+article$/i.test(preceding.text.trim())) {
          (preceding as any)._isCanonicalTitle = true;
          break;
        }
      }
    }

    // Keywords are useful metadata but not reader body. Mark only the heading
    // and its spatially adjacent value block; never consume the next column's
    // body continuation merely because it follows in Docling iteration order.
    for (let index = 0; index < ordered.length; index++) {
      const heading = ordered[index];
      if (heading.pageNumber !== 1 || heading.type !== 'heading' || !this.isKeywordHeading(heading.text)) continue;
      (heading as any)._isKeywordMetadata = true;
      if (!heading.bbox) continue;
      const headingBox = heading.bbox as BBox;
      for (let cursor = index + 1; cursor < ordered.length; cursor++) {
        const candidate = ordered[cursor];
        if (candidate.pageNumber !== heading.pageNumber || candidate.type === 'heading' || !candidate.bbox) break;
        const box = candidate.bbox as BBox;
        const verticalGap = headingBox[3] - box[1];
        if (verticalGap < -5 || verticalGap > 80 || this.horizontalOverlap(headingBox, box) <= 0) break;
        (candidate as any)._isKeywordMetadata = true;
      }
    }

    const abstractIndex = ordered.findIndex(
      (item) => item.pageNumber === 1 && item.type === 'heading' && this.isAbstractHeading(item.text)
    );
    const introductionIndex = ordered.findIndex(
      (item) => item.pageNumber === 1 && item.type === 'heading' && this.isIntroductionHeading(item.text)
    );

    if (abstractIndex < 0 || introductionIndex < 0 || abstractIndex < introductionIndex) {
      return ordered;
    }

    let abstractEnd = abstractIndex + 1;
    while (abstractEnd < ordered.length) {
      const item = ordered[abstractEnd];
      if (item.pageNumber !== 1 || (item.type === 'heading' && abstractEnd > abstractIndex)) break;
      abstractEnd += 1;
    }

    const abstractGroup = ordered.splice(abstractIndex, abstractEnd - abstractIndex);
    const newIntroductionIndex = ordered.findIndex(
      (item) => item.pageNumber === 1 && item.type === 'heading' && this.isIntroductionHeading(item.text)
    );
    ordered.splice(newIntroductionIndex, 0, ...abstractGroup);
    return ordered;
  }

  public static isTableCaptionText(text: string): boolean {
    const clean = text.trim().toLowerCase();
    return /^(table|tab\.|bảng|bang|bg\.)\s*\d+/i.test(clean);
  }

  public static isFigureCaptionText(text: string): boolean {
    const clean = text.trim().toLowerCase();
    return /^(figure|fig\.|fig|hình|hinh|hđ\.)\s*\d+/i.test(clean);
  }

  private static horizontalOverlap(a: BBox, b: BBox): number {
    return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  }

  /** Associate same-page captions using PDF bottom-left bbox coordinates. */
  public static associateTableCaptions(items: DoclingItem[]): Map<string, string> {
    const associated = new Map<string, string>();
    const usedItemIds = new Set<string>();
    const tables = items.filter((item) => item.type === 'table' && item.bbox);

    for (const table of tables) {
      const tableBox = table.bbox as BBox;
      const tableTop = tableBox[1];
      const candidates = items
        .filter((item) => {
          if (
            usedItemIds.has(item.id) ||
            item.pageNumber !== table.pageNumber ||
            !item.bbox ||
            (item.type !== 'caption' && !this.isTableCaptionText(item.text))
          ) return false;
          const box = item.bbox as BBox;
          const gap = box[3] - tableTop;
          return gap >= -5 && gap <= 40 && this.horizontalOverlap(box, tableBox) > 0;
        })
        .sort((a, b) => {
          const gapA = Math.abs((a.bbox as BBox)[3] - tableTop);
          const gapB = Math.abs((b.bbox as BBox)[3] - tableTop);
          return gapA - gapB;
        });

      const primary = candidates[0];
      if (!primary?.bbox) continue;

      let captionText = primary.text.trim();
      const primaryBox = primary.bbox as BBox;
      usedItemIds.add(primary.id);
      (primary as any)._isMergedTableCaption = true;

      // A short descriptive line often sits between "Table N" and the grid.
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
            const box = item.bbox as BBox;
            const belowPrimary = box[1] <= primaryBox[3] + 5;
            const aboveTable = box[3] >= tableTop - 5;
            return belowPrimary && aboveTable && this.horizontalOverlap(box, tableBox) > 0;
          })
          .sort((a, b) => Math.abs((primaryBox[3] - (a.bbox as BBox)[1])) - Math.abs((primaryBox[3] - (b.bbox as BBox)[1])))[0];

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

  public static evaluateItem(
    item: DoclingItem,
    associatedTableCaptions: Map<string, string>,
    allItems: DoclingItem[]
  ): DoclingPolicyResult {
    const text = item.text.trim();

    if ((item as any)._isMergedTableCaption) return { isExcluded: true };
    if ((item as any)._isCanonicalTitle) {
      return { isExcluded: false, blockTypeOverride: 'title' };
    }
    if (this.isPageFurnitureOrMetadata(item, text, allItems)) return { isExcluded: true };

    // A scientific figure owns its caption. Do not emit the same caption as a
    // loose paragraph immediately before the figure block.
    if (
      (item.type === 'caption' || this.isFigureCaptionText(text)) &&
      allItems.some((candidate) =>
        candidate.type === 'figure' && this.findNearbyFigureCaption(candidate, allItems)?.id === item.id
      )
    ) {
      return { isExcluded: true };
    }

    // Structural blocks legitimately have empty text; evaluate them before text quality.
    if (item.type === 'table') {
      if (!item.html?.trim()) return { isExcluded: true };
      return {
        isExcluded: false,
        blockTypeOverride: 'table',
        captionText: associatedTableCaptions.get(item.id)
      };
    }

    if (item.type === 'figure') {
      if (!this.verifyFigureScientificEvidence(item, allItems)) return { isExcluded: true };
      return {
        isExcluded: false,
        blockTypeOverride: 'figure',
        captionText: item.caption || this.findNearbyFigureCaption(item, allItems)?.text
      };
    }

    if (this.isCorruptedText(text)) return { isExcluded: true };

    // Layout models occasionally label a lowercase sentence continuation as a
    // section header at a page/column boundary. Preserve it as body text.
    if (item.type === 'heading' && /^\p{Ll}/u.test(text) && /[.!?]$/.test(text)) {
      return { isExcluded: false, blockTypeOverride: 'paragraph' };
    }
    return { isExcluded: false };
  }

  private static isCorruptedText(text: string): boolean {
    if (!text) return true;
    if (/^WKH$/i.test(text)) return true;
    if (/Sd,Lh/i.test(text)) return true;
    return false;
  }

  private static isStandaloneIdentifier(text: string): boolean {
    const clean = text.trim().replace(/[.,;]+$/, '');
    return /^(?:(?:https?:\/\/(?:dx\.)?doi\.org\/)|(?:doi\s*:\s*))?10\.\d{4,9}\/\S+$/i.test(clean) ||
      /^(?:isbn(?:-1[03])?\s*:\s*)[0-9xX-]{10,20}$/i.test(clean) ||
      /^PMC\d+$/i.test(clean);
  }

  private static isPageFurnitureOrMetadata(item: DoclingItem, text: string, allItems: DoclingItem[]): boolean {
    if ((item as any)._isKeywordMetadata || (item as any)._isFrontMatterMetadata) return true;
    if (item.type === 'page_header' || item.type === 'page_footer' || item.type === 'metadata' || item.type === 'footnote') {
      return true;
    }

    const clean = text.toLowerCase();
    const compactLabel = this.normalizeLabel(text);
    if (item.type !== 'reference' && this.isStandaloneIdentifier(text)) return true;

    if (
      compactLabel === 'articleinfo' ||
      compactLabel === 'articlehistory' ||
      /^(keywords?|key\s+words|từ\s+kh[oó]a|từ\s+khoá)\s*:/iu.test(text.trim()) ||
      clean.includes('received in revised form') ||
      /^received\s+\d/i.test(clean) ||
      /^accepted\s+\d/i.test(clean) ||
      /^available online\s+/i.test(clean) ||
      clean.includes('all rights reserved') ||
      clean.includes('copyright ©') ||
      clean.includes('creative commons') ||
      clean.startsWith('under the cc ')
    ) return true;

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    if (emailRegex.test(text) && /(correspond|e-?mail|contact)/i.test(text)) return true;

    if (item.pageNumber === 1) {
      const titleIndex = allItems.findIndex((candidate) => candidate.pageNumber === 1 && candidate.type === 'title');
      // `evaluateItem` receives a normalized shallow copy, so object identity
      // is intentionally not stable here. Item IDs are the canonical identity.
      const currentIndex = allItems.findIndex((candidate) => candidate.id === item.id);

      // Publisher/navigation furniture preceding a reliable article title.
      if (titleIndex >= 0 && currentIndex >= 0 && currentIndex < titleIndex) return true;

      // Author/affiliation/keyword band between title and Abstract/Introduction.
      const bodyStartIndex = allItems.findIndex((candidate, index) => index > titleIndex && this.isBodyStartHeading(candidate));
      if (
        titleIndex >= 0 &&
        bodyStartIndex > titleIndex &&
        currentIndex > titleIndex &&
        currentIndex < bodyStartIndex &&
        item.type !== 'title'
      ) return true;
    }

    return false;
  }

  private static findNearbyFigureCaption(item: DoclingItem, allItems: DoclingItem[]): DoclingItem | undefined {
    if (!item.bbox) return undefined;
    const figureBox = item.bbox as BBox;
    return allItems
      .filter((other) => {
        if (other.id === item.id || other.pageNumber !== item.pageNumber || !other.bbox) return false;
        if (other.type !== 'caption' && !this.isFigureCaptionText(other.text)) return false;
        const captionBox = other.bbox as BBox;
        const gapBelow = figureBox[3] - captionBox[1];
        return gapBelow >= -10 && gapBelow <= 150 && this.horizontalOverlap(figureBox, captionBox) > 0;
      })
      .sort((a, b) => Math.abs(figureBox[3] - (a.bbox as BBox)[1]) - Math.abs(figureBox[3] - (b.bbox as BBox)[1]))[0];
  }

  private static verifyFigureScientificEvidence(item: DoclingItem, allItems: DoclingItem[]): boolean {
    return Boolean(item.caption?.trim() || this.findNearbyFigureCaption(item, allItems));
  }
}
