import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAcademicChunk extends Document {
  sourceId: Types.ObjectId;
  documentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  text: string;
  embedding: number[];
  tokenCount: number;
  sectionOrder: number;
  chunkOrder: number;
}

const AcademicChunkSchema = new Schema<IAcademicChunk>(
  {
    sourceId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicSource',
      required: true,
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
    embedding: {
      type: [Number],
      required: true,
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
AcademicChunkSchema.index({ documentId: 1, chunkOrder: 1 }, { unique: true });

export default mongoose.model<IAcademicChunk>('AcademicChunk', AcademicChunkSchema);
