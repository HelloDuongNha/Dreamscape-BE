import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAcademicSection extends Document {
  documentId: Types.ObjectId;
  sourceId?: Types.ObjectId;
  previewContributionId?: Types.ObjectId;
  heading: string;
  sectionType: string;
  sectionOrder: number;
  chunkIds: Types.ObjectId[];
}

const AcademicSectionSchema = new Schema<IAcademicSection>(
  {
    documentId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicDocument',
      required: true,
      index: true,
    },
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
    heading: {
      type: String,
      required: true,
    },
    sectionType: {
      type: String,
      required: true,
    },
    sectionOrder: {
      type: Number,
      required: true,
      default: 0,
    },
    chunkIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'AcademicChunk' }],
      default: [],
    },
  },
  {
    timestamps: false,
    collection: 'academic_sections',
  }
);

export default mongoose.model<IAcademicSection>('AcademicSection', AcademicSectionSchema);
