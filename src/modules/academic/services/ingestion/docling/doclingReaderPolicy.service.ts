import { DoclingItem } from '../../types/docling.types';
import { DoclingCaptionPolicyService } from './doclingCaptionPolicy.service';
import { DoclingItemPolicyService } from './doclingItemPolicy.service';
import { DoclingReaderOrderService } from './doclingReaderOrder.service';
import { DoclingPolicyResult } from './doclingPolicy.types';

export { DoclingPolicyResult } from './doclingPolicy.types';

// Keep the adapter-facing contract stable while each policy owns one concern.
export class DoclingReaderPolicyService {
  public static orderItemsForReader(items: DoclingItem[]): DoclingItem[] {
    return DoclingReaderOrderService.orderItemsForReader(items);
  }

  public static isTableCaptionText(text: string): boolean {
    return DoclingCaptionPolicyService.isTableCaptionText(text);
  }

  public static isFigureCaptionText(text: string): boolean {
    return DoclingCaptionPolicyService.isFigureCaptionText(text);
  }

  public static associateTableCaptions(items: DoclingItem[]): Map<string, string> {
    return DoclingCaptionPolicyService.associateTableCaptions(items);
  }

  public static evaluateItem(
    item: DoclingItem,
    associatedTableCaptions: Map<string, string>,
    allItems: DoclingItem[]
  ): DoclingPolicyResult {
    return DoclingItemPolicyService.evaluateItem(item, associatedTableCaptions, allItems);
  }
}
