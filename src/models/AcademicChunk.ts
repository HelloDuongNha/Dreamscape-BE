import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAcademicChunk extends Document {
  sourceId?: Types.ObjectId;
  previewContributionId?: Types.ObjectId;
  chunkPurpose: 'reader' | 'rag';
  documentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  text: string;
  html?: string;
  marker?: string;
  blockType?: string;
  embedding?: number[];
  tokenCount: number;
  sectionOrder: number;
  chunkOrder: number;
}

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
