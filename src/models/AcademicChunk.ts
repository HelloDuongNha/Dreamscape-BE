import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAcademicChunk extends Document {
  academicSourceId: Types.ObjectId;
  academicFullTextId: Types.ObjectId;
  academicFullTextSectionId: Types.ObjectId;
  chunkIndex: number;
  chunkText: string;
  sectionType: 'title' | 'abstract' | 'heading' | 'paragraph' | 'list_item' | 'reference_item' | 'caption' | 'metadata' | 'unknown';
  sectionTitle?: string;
  pageStart?: number;
  pageEnd?: number;
  embedding: number[];
  embeddingModel: string;
  characterCount: number;
  wordCount: number;
  tokenEstimate?: number;
  sourceOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const AcademicChunkSchema = new Schema<IAcademicChunk>(
  {
    academicSourceId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicSource',
      required: true,
      index: true,
    },
    academicFullTextId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicFullText',
      required: true,
      index: true,
    },
    academicFullTextSectionId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicFullTextSection',
      required: true,
      index: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
    },
    chunkText: {
      type: String,
      required: true,
    },
    sectionType: {
      type: String,
      enum: ['title', 'abstract', 'heading', 'paragraph', 'list_item', 'reference_item', 'caption', 'metadata', 'unknown'],
      required: true,
    },
    sectionTitle: {
      type: String,
    },
    pageStart: {
      type: Number,
    },
    pageEnd: {
      type: Number,
    },
    embedding: {
      type: [Number],
      required: true,
      // No index: true to avoid heavy database indexes on vector arrays
    },
    embeddingModel: {
      type: String,
      required: true,
      index: true,
    },
    characterCount: {
      type: Number,
      required: true,
    },
    wordCount: {
      type: Number,
      required: true,
    },
    tokenEstimate: {
      type: Number,
    },
    sourceOrder: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'academic_chunks',
  }
);

// Compound unique index to prevent duplicate chunks for the same fulltext, index position, and model
AcademicChunkSchema.index(
  { academicFullTextId: 1, chunkIndex: 1, embeddingModel: 1 },
  { unique: true }
);

export default mongoose.model<IAcademicChunk>('AcademicChunk', AcademicChunkSchema);
