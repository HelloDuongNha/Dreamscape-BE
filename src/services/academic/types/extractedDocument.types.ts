import type { StructuredTableData } from '../types';

export interface ExtractedBlock {
  blockType: 'title' | 'heading' | 'paragraph' | 'list_item' | 'figure' | 'table' | 'reference' | 'page_break' | 'metadata';
  text: string;
  html?: string;
  tableData?: StructuredTableData;
  pageNumber?: number;
  readingOrder: number;
  sectionHint?: string;
  confidence?: number;
  sourceMethod: 'pdf_text' | 'docling';
}

export interface ExtractedPage {
  pageIndex: number;
  physicalPageNumber: number;
  wordCount: number;
  characterCount: number;
  blocks: ExtractedBlock[];
}

export interface ExtractedDocument {
  title?: string;
  language?: string;
  pageCount: number;
  pages: ExtractedPage[];
  totalWordCount: number;
  totalCharacterCount: number;
  extractedVia: 'pdf_text' | 'docling';
  hasUsableTextLayer: boolean;
  qualitySignals: {
    pagesWithText: number;
    emptyPageCount: number;
    averageCharactersPerPage: number;
    lowTextPageCount: number;
  };
}
