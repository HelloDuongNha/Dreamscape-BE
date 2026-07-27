import { DoclingItem } from '../../types/docling.types';

export type DoclingBBox = [number, number, number, number];

export class DoclingReaderOrderService {
  public static normalizeLabel(text: string): string {
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

  public static isBodyStartHeading(item: DoclingItem): boolean {
    return item.type === 'heading' && (
      this.isAbstractHeading(item.text) || this.isIntroductionHeading(item.text)
    );
  }

  public static isLikelyAuthorLine(text: string): boolean {
    const clean = text.trim();
    if (!clean || clean.length > 300) return false;
    const hasAuthorSeparator = /\b(?:and|&|và)\b|[,;·|]/iu.test(clean);
    const nameCount = (clean.match(/\b\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]+)+/gu) || []).length;
    return hasAuthorSeparator && nameCount >= 2 && !/[.!?]\s*$/.test(clean);
  }

  public static isLikelyAffiliation(text: string): boolean {
    const clean = text.trim();
    if (!clean || clean.length > 500) return false;
    return /^(?:[a-z0-9,*†‡§]+\s+)?(?:department|division|faculty|school|institute|institution|university|college|hospital|laboratory|research (?:institute|center|centre)|khoa|trường|viện|đại học|bệnh viện)\b/iu.test(clean);
  }

  private static isReferencesHeading(text: string): boolean {
    const normalized = text.trim().toLowerCase().replace(/[^a-z0-9\p{L}]+/gu, ' ').trim();
    return ['references', 'bibliography', 'literature cited', 'works cited', 'tài liệu tham khảo'].includes(normalized);
  }

  private static isUnlabelledBodyHeading(text: string): boolean {
    const clean = text.trim();
    if (!clean || clean.length > 140 || /[.!?]\s*$/u.test(clean)) return false;
    const normalized = clean.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return /^(?:limitations?|limitations? of (?:the )?model|discussion|conclusions?|results?|methods?|materials and methods|future directions?|summary)$/i.test(normalized);
  }

  private static isBackMatterMetadata(text: string): boolean {
    const clean = text.trim();
    if (!clean || /^[-–—•'’"`]+$/u.test(clean)) return true;
    return /^(?:conflict of interest(?: statement)?|received\s*:|accepted\s*:|published online\s*:|citation\s*:|this article was submitted to\b|copyright\b|©|author contributions?\b|funding\b|acknowledg(?:e)?ments?\b|data availability\b|ethics statement\b|reviewed by\b|academic editor\b)/iu.test(clean);
  }

  private static isReferenceSeparator(text: string): boolean {
    return !text.trim() || /^[-–—•'’"`]+$/u.test(text.trim());
  }

  private static isLikelyBodyProseMislabelledAsReference(text: string): boolean {
    const clean = text.trim();
    if (clean.length < 55 || !/^\p{Ll}/u.test(clean) || !/[.!?]$/u.test(clean)) return false;
    return !/(?:\b(?:19|20)\d{2}\b|\bdoi\s*:|https?:\/\/|\bet\s+al\.|^[\p{Lu}][\p{L}'’.-]+\s*,)/iu.test(clean);
  }

  private static normalizeReferenceBoundaries(items: DoclingItem[]): void {
    let inReferences = false;
    for (const item of items) {
      if (item.type === 'heading') {
        inReferences = this.isReferencesHeading(item.text);
        continue;
      }
      if (item.type !== 'reference') continue;

      if (this.isBackMatterMetadata(item.text)) {
        item.type = 'metadata';
        if (!this.isReferenceSeparator(item.text)) inReferences = false;
        continue;
      }
      if (this.isUnlabelledBodyHeading(item.text)) {
        item.type = 'heading';
        inReferences = false;
        continue;
      }
      if (inReferences && this.isLikelyBodyProseMislabelledAsReference(item.text)) {
        item.type = 'paragraph';
        continue;
      }
      if (!inReferences) item.type = 'paragraph';
    }
  }

  private static mergeFragmentedReferences(items: DoclingItem[]): DoclingItem[] {
    const merged: DoclingItem[] = [];
    for (const item of items) {
      const previous = merged[merged.length - 1];
      const clean = item.text.trim();
      if (item.type === 'metadata' && this.isReferenceSeparator(clean)) continue;
      if (item.type !== 'reference' || previous?.type !== 'reference') {
        merged.push(item);
        continue;
      }

      const startsWithPunctuation = /^[,.;:)]/u.test(clean);
      const isPageNumberFragment = /^\d{1,4}$/u.test(clean);
      const isLowercaseContinuation = /^\p{Ll}/u.test(clean) && !/[.!?]\s*$/u.test(previous.text.trim());
      if (!startsWithPunctuation && !isPageNumberFragment && !isLowercaseContinuation) {
        merged.push(item);
        continue;
      }

      if (isPageNumberFragment) {
        const pageStart = previous.text.match(/,\s*(\d{1,4})\s*$/u);
        previous.text = pageStart
          ? `${previous.text.slice(0, pageStart.index)}, ${pageStart[1]}–${clean}`
          : `${previous.text.trimEnd()} ${clean}`;
      } else if (startsWithPunctuation) {
        previous.text = `${previous.text.trimEnd()}${clean}`;
      } else {
        previous.text = `${previous.text.trimEnd()} ${clean}`;
      }
    }
    return merged;
  }

  public static horizontalOverlap(a: DoclingBBox, b: DoclingBBox): number {
    return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  }

  // Restore reading order and mark front matter before block filtering.
  public static orderItemsForReader(items: DoclingItem[]): DoclingItem[] {
    let ordered = [...items];
    this.normalizeReferenceBoundaries(ordered);
    ordered = this.mergeFragmentedReferences(ordered);

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

    for (let index = 0; index < ordered.length; index++) {
      const heading = ordered[index];
      if (heading.pageNumber !== 1 || heading.type !== 'heading' || !this.isKeywordHeading(heading.text)) continue;
      (heading as any)._isKeywordMetadata = true;
      if (!heading.bbox) continue;
      const headingBox = heading.bbox as DoclingBBox;
      for (let cursor = index + 1; cursor < ordered.length; cursor++) {
        const candidate = ordered[cursor];
        if (candidate.pageNumber !== heading.pageNumber || candidate.type === 'heading' || !candidate.bbox) break;
        const box = candidate.bbox as DoclingBBox;
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
    if (abstractIndex < 0 || introductionIndex < 0 || abstractIndex < introductionIndex) return ordered;

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
}
