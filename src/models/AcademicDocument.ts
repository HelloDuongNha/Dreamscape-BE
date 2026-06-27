import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAcademicDocument extends Document {
  sourceId: Types.ObjectId;
  parserVersion: number;
  parserEngine: string;
  sectionIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const AcademicDocumentSchema = new Schema<IAcademicDocument>(
  {
    sourceId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicSource',
      required: true,
      unique: true,
      index: true,
    },
    parserVersion: {
      type: Number,
      required: true,
    },
    parserEngine: {
      type: String,
      required: true,
    },
    sectionIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'AcademicSection' }],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'academic_documents',
  }
);

export default mongoose.model<IAcademicDocument>('AcademicDocument', AcademicDocumentSchema);
