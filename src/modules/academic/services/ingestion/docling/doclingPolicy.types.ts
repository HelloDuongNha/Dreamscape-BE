export interface DoclingPolicyResult {
  isExcluded: boolean;
  blockTypeOverride?: 'title' | 'heading' | 'paragraph' | 'list_item' | 'reference' | 'table' | 'figure';
  captionText?: string;
  textOverride?: string;
}
