import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAcademicSection extends Document {
  documentId: Types.ObjectId;
  heading: string;
  sectionType: string;
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
    heading: {
      type: String,
      required: true,
    },
    sectionType: {
      type: String,
      required: true,
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
