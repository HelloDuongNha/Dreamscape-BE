import type { StructuredTableData } from '../types';

export interface DoclingItem {
  id: string;
  type: 'title' | 'heading' | 'paragraph' | 'list_item' | 'reference' | 'table' | 'figure' | 'metadata' | 'page_header' | 'page_footer' | 'footnote' | 'caption';
  text: string;
  pageNumber: number;
  bbox?: [number, number, number, number];
  caption?: string;
  html?: string;
  tableData?: StructuredTableData;
  imageDescriptor?: string;
  filePath?: string;
  fileName?: string;
  width?: number;
  height?: number;
  format?: string;
  figureType?: 'embedded' | 'rendered_crop' | 'region_only';
  confidence?: number;
}

export interface DoclingExtractionResult {
  success: boolean;
  title: string;
  pageCount: number;
  items: DoclingItem[];
  duration: number;
  ocrUsed: boolean;
  imageScale?: number;
  warnings: string[];
  referenceQualityDegraded: boolean;
  errorCode?: string;
  errorDetail?: string;
}
