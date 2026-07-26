import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAcademicDocument extends Document {
  sourceId?: Types.ObjectId;
  previewContributionId?: Types.ObjectId;
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
      required: false,
    },
    previewContributionId: {
      type: Schema.Types.ObjectId,
      ref: 'SourceContribution',
      required: false,
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

// Custom validation constraint: Must have either sourceId or previewContributionId
AcademicDocumentSchema.index(
  { sourceId: 1 },
  { unique: true, partialFilterExpression: { sourceId: { $gt: null } } }
);

export default mongoose.model<IAcademicDocument>('AcademicDocument', AcademicDocumentSchema);
