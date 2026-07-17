import mongoose, { Document, Schema, Types } from 'mongoose';
import type { StructuredTableData } from '../services/academic/types/canonical.types';

export interface IAcademicChunk extends Document {
  sourceId?: Types.ObjectId;
  previewContributionId?: Types.ObjectId;
  chunkPurpose: 'reader' | 'rag';
  documentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  text: string;
  html?: string;
  tableData?: StructuredTableData;
  marker?: string;
  blockType?: string;
  embedding?: number[];
  tokenCount: number;
  sectionOrder: number;
  chunkOrder: number;
}

const StructuredTableCellSchema = new Schema(
  {
    row: { type: Number, required: true, min: 0 },
    column: { type: Number, required: true, min: 0 },
    rowSpan: { type: Number, required: true, min: 1 },
    columnSpan: { type: Number, required: true, min: 1 },
    // Empty cells are meaningful in a rectangular table grid. Mongoose's
    // string `required` validator rejects "", so preserve it explicitly.
    text: { type: String, required: false, default: '' },
    role: { type: String, enum: ['header', 'data'], required: true },
  },
  { _id: false }
);

const RawExtractedTableCellSchema = new Schema(
  {
    startRow: { type: Number, required: true, min: 0 },
    endRow: { type: Number, required: true, min: 0 },
    startColumn: { type: Number, required: true, min: 0 },
    endColumn: { type: Number, required: true, min: 0 },
    // Raw Docling output may also contain an intentionally empty grid cell.
    text: { type: String, required: false, default: '' },
    columnHeader: { type: Boolean, required: true },
    rowHeader: { type: Boolean, required: true },
  },
  { _id: false }
);

const StructuredTableDataSchema = new Schema(
  {
    version: { type: Number, enum: [1], required: true },
    source: { type: String, enum: ['docling', 'jats', 'html', 'other'], required: true },
    reconstructionMethod: { type: String, required: true },
    rowCount: { type: Number, required: true, min: 0 },
    columnCount: { type: Number, required: true, min: 0 },
    cells: { type: [StructuredTableCellSchema], required: true, default: [] },
    rawCells: { type: [RawExtractedTableCellSchema], required: true, default: [] },
    warnings: { type: [String], required: true, default: [] },
  },
  { _id: false }
);

const AcademicChunkSchema = new Schema<IAcademicChunk>(
  {
    sourceId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicSource',
      required: false,
      index: true,
    },
    previewContributionId: {
      type: Schema.Types.ObjectId,
      ref: 'SourceContribution',
      required: false,
      index: true,
    },
    chunkPurpose: {
      type: String,
      enum: ['reader', 'rag'],
      required: true,
      default: 'reader',
      index: true,
    },
    documentId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicDocument',
      required: true,
      index: true,
    },
    sectionId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicSection',
      required: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
    },
    html: {
      type: String,
      required: false,
    },
    tableData: {
      type: StructuredTableDataSchema,
      required: false,
    },
    marker: {
      type: String,
      required: false,
    },
    blockType: {
      type: String,
      required: false,
    },
    embedding: {
      type: [Number],
      required: false,
      default: [],
    },
    tokenCount: {
      type: Number,
      required: true,
    },
    sectionOrder: {
      type: Number,
      required: true,
    },
    chunkOrder: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: false,
    collection: 'academic_chunks',
  }
);

// Query Optimization Indexes
// Allow multiple chunks per document, chunkPurpose, chunkOrder
AcademicChunkSchema.index({ documentId: 1, chunkPurpose: 1, chunkOrder: 1 }, { unique: true });

export default mongoose.model<IAcademicChunk>('AcademicChunk', AcademicChunkSchema);
