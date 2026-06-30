import mongoose from 'mongoose';

export interface FullTextCandidate {
  sourceType: "jats_xml" | "publisher_html" | "pdf" | "uploaded_pdf" | "generic_html";
  url: string;
  contentType: string;
  confidence: number;
  reason: string;
}

export type BlockType =
  | "title"
  | "metadata"
  | "heading"
  | "paragraph"
  | "list_item"
  | "reference"
  | "figure"
  | "table"
  | "page_break";

export type SemanticType =
  | "title"
  | "metadata"
  | "author"
  | "affiliation"
  | "keywords"
  | "abstract"
  | "heading"
  | "paragraph"
  | "list"
  | "reference"
  | "caption"
  | "figure"
  | "table"
  | "footnote"
  | "appendix"
  | "acknowledgement";

export interface CanonicalBlock {
  blockType: BlockType;
  semanticType: SemanticType;
  sectionHeading: string | null;
  text: string;
  html: string;
  marker?: string;
  order: number;
  pageNumber?: number;
  tableLink?: string;
  tableHtmlContent?: string;
  imageUrl?: string;
}

export interface CanonicalBlocksOutput {
  title: string;
  parserEngine: string;
  sourceType: string;
  warnings: string[];
  blocks: CanonicalBlock[];
  success: boolean;
  error?: string;
}

export interface ReaderQualityReport {
  overallScore: number;
  headingScore: number;
  paragraphScore: number;
  referenceScore: number;
  listScore: number;
  noiseScore: number;
  metadataScore: number;
  figureScore: number;
  tableScore: number;
  whitespaceScore: number;
  pageContinuityScore: number;
  warnings: string[];
  chosenParser: string;
  chosenCandidate: string;
  fallbackUsed: boolean;
  processingTimeMs: number;
  metrics: {
    blockCount: number;
    headingCount: number;
    paragraphCount: number;
    listItemCount: number;
    referenceCount: number;
    figureCount: number;
    tableCount: number;
  };
}

export interface ParserResult {
  output: CanonicalBlocksOutput;
  report: ReaderQualityReport;
}
