export interface CanonicalReaderIdentity {
  documentId: string;
  sourceLanguage: string | null;
  sourceContentHash: string;
  parserEngine: string | null;
  parserVersion: string | null;
  updatedAt: string | null;
}

export interface CanonicalReaderBlockIdentity {
  chunkId: string;
  sectionId: string;
  chunkIndex: number;
  contentHash: string;
}

export interface CanonicalReaderSectionIdentity {
  sectionId: string;
  sectionOrder: number | null;
  heading: string | null;
  sectionType: string | null;
}

export interface TableCellData {
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  text: string;
  role: 'header' | 'data';
}

export interface StructuredTableData {
  version: number;
  source: string;
  reconstructionMethod: string;
  rowCount: number;
  columnCount: number;
  cells: TableCellData[];
}

export interface ApiResponseSection {
  sectionIndex: number;
  sectionType: string;
  text: string;
  html: string | null;
  marker: string | null;
  pageStart: number;
  pageEnd: number;
  blockIdentity: CanonicalReaderBlockIdentity;
  sectionIdentity: CanonicalReaderSectionIdentity | null;
  tableData?: StructuredTableData | null;
}
