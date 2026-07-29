import { DoclingItem } from '../../types/docling.types';
import { DoclingCaptionPolicyService } from './doclingCaptionPolicy.service';
import { DoclingPolicyResult } from './doclingPolicy.types';
import { DoclingReaderOrderService } from './doclingReaderOrder.service';

export class DoclingItemPolicyService {
  // Decide whether one normalized Docling item belongs in the reader.
  public static evaluateItem(
    item: DoclingItem,
    associatedTableCaptions: Map<string, string>,
    allItems: DoclingItem[]
  ): DoclingPolicyResult {
    const text = item.text.trim();
    if ((item as any)._isMergedTableCaption) return { isExcluded: true };
    if ((item as any)._isCanonicalTitle) return { isExcluded: false, blockTypeOverride: 'title' };
    if (this.isPageFurnitureOrMetadata(item, text, allItems)) return { isExcluded: true };

    const trailingCaption = DoclingCaptionPolicyService.extractNumberedFigureCaption(item);
    if (
      trailingCaption &&
      !trailingCaption.standalone &&
      allItems.some((candidate) =>
        candidate.type === 'figure' &&
        DoclingCaptionPolicyService.findClusteredFigureCaption(candidate, allItems)?.id === item.id
      )
    ) {
      const captionStart = text.lastIndexOf(trailingCaption.text);
      const bodyText = captionStart > 0 ? text.slice(0, captionStart).trim() : '';
      if (bodyText) return { isExcluded: false, textOverride: bodyText };
    }

    if (
      (item.type === 'caption' || DoclingCaptionPolicyService.isFigureCaptionText(text)) &&
      allItems.some((candidate) =>
        candidate.type === 'figure' && (
          DoclingCaptionPolicyService.findNearbyFigureCaption(candidate, allItems)?.id === item.id ||
          (
            DoclingCaptionPolicyService.extractNumberedFigureCaption(item)?.standalone &&
            DoclingCaptionPolicyService.findClusteredFigureCaption(candidate, allItems)?.id === item.id
          )
        )
      )
    ) return { isExcluded: true };

    if (item.type === 'table') {
      if (!item.html?.trim()) return { isExcluded: true };
      return {
        isExcluded: false,
        blockTypeOverride: 'table',
        captionText: associatedTableCaptions.get(item.id)
      };
    }

    if (item.type === 'figure') {
      const linkedCaption =
        item.caption?.trim() ||
        DoclingCaptionPolicyService.findNearbyFigureCaption(item, allItems)?.text ||
        DoclingCaptionPolicyService.findClusteredFigureCaption(item, allItems)?.text;
      if (!linkedCaption && !DoclingCaptionPolicyService.verifyStrictUntitledFigure(item, allItems)) {
        return { isExcluded: true };
      }
      return {
        isExcluded: false,
        blockTypeOverride: 'figure',
        captionText: linkedCaption || DoclingCaptionPolicyService.buildUntitledFigureCaption(item, allItems)
      };
    }

    if (this.isCorruptedText(text)) return { isExcluded: true };
    if (item.type === 'heading' && /^\p{Ll}/u.test(text) && /[.!?]$/.test(text)) {
      return { isExcluded: false, blockTypeOverride: 'paragraph' };
    }
    return { isExcluded: false };
  }

  private static isCorruptedText(text: string): boolean {
    if (!text || /^WKH$/i.test(text) || /Sd,Lh/i.test(text)) return true;
    const folded = text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    const distributionNoticeSignals = [
      /luu\s+y\s+gui.{0,24}ban\s+doc/u,
      /d[ia]nh\s+dau.{0,30}rieng/u,
      /chia\s+se/u,
      /tren\s+mang/u,
      /dieu\s+kien.{0,20}mua/u,
      /suu\s+[tf]\s*am/u,
    ].filter((pattern) => pattern.test(folded)).length;
    return (
      folded === 'luu y gui toi ban doc' ||
      folded.includes('thuviennotion') ||
      (folded.includes('ung ho nhom') && folded.includes('cam on')) ||
      (/(?:cam|oam)\s+on\s+ban/u.test(folded) && folded.includes('nhom')) ||
      (folded.includes('book') && folded.includes('danh dau') && folded.includes('cong khai')) ||
      (folded.includes('book') && folded.includes('chia se')) ||
      (folded.startsWith('sach ') && /suu\s+[tf]am/u.test(folded)) ||
      (text.length <= 700 && distributionNoticeSignals >= 2)
    );
  }

  private static isStandaloneIdentifier(text: string): boolean {
    const clean = text.trim().replace(/[.,;]+$/, '');
    return /^(?:(?:https?:\/\/(?:dx\.)?doi\.org\/)|(?:doi\s*:\s*))?10\.\d{4,9}\/\S+$/i.test(clean) ||
      /^(?:isbn(?:-1[03])?\s*:\s*)[0-9xX-]{10,20}$/i.test(clean) ||
      /^PMC\d+$/i.test(clean);
  }

  private static isPageFurnitureOrMetadata(item: DoclingItem, text: string, allItems: DoclingItem[]): boolean {
    if ((item as any)._isKeywordMetadata || (item as any)._isFrontMatterMetadata) return true;
    if (['page_header', 'page_footer', 'metadata', 'footnote'].includes(item.type)) return true;

    const clean = text.toLowerCase();
    const compactLabel = DoclingReaderOrderService.normalizeLabel(text);
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

    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text) && /(correspond|e-?mail|contact)/i.test(text)) {
      return true;
    }

    if (item.pageNumber === 1) {
      const titleIndex = allItems.findIndex((candidate) => candidate.pageNumber === 1 && candidate.type === 'title');
      const currentIndex = allItems.findIndex((candidate) => candidate.id === item.id);
      const firstBodyStartIndex = allItems.findIndex((candidate) =>
        DoclingReaderOrderService.isBodyStartHeading(candidate)
      );
      if (
        currentIndex >= 0 &&
        (firstBodyStartIndex < 0 || currentIndex < firstBodyStartIndex) &&
        (
          DoclingReaderOrderService.isLikelyAuthorLine(text) ||
          DoclingReaderOrderService.isLikelyAffiliation(text)
        )
      ) return true;
      if (titleIndex >= 0 && currentIndex >= 0 && currentIndex < titleIndex) return true;

      const bodyStartIndex = allItems.findIndex(
        (candidate, index) =>
          index > titleIndex && DoclingReaderOrderService.isBodyStartHeading(candidate)
      );
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
}
