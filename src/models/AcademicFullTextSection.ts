import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAcademicFullTextSection extends Document {
  academicFullTextId: Types.ObjectId;
  academicSourceId: Types.ObjectId;
  sectionIndex: number;
  title?: string;
  text: string;
  characterCount: number;
  wordCount: number;
  pageStart?: number;
  pageEnd?: number;
  sectionType?: 'title' | 'abstract' | 'heading' | 'paragraph' | 'list_item' | 'reference_item' | 'caption' | 'metadata' | 'unknown' | 'figure' | 'table' | 'page_break' | 'reference';
  style?: any;
  html?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AcademicFullTextSectionSchema = new Schema<IAcademicFullTextSection>(
  {
    academicFullTextId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicFullText',
      required: true,
      index: true,
    },
    academicSourceId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicSource',
      required: true,
      index: true,
    },
    sectionIndex: {
      type: Number,
      required: true,
    },
    title: {
      type: String,
    },
    text: {
      type: String,
      required: true,
    },
    characterCount: {
      type: Number,
      required: true,
    },
    wordCount: {
      type: Number,
      required: true,
    },
    pageStart: {
      type: Number,
    },
    pageEnd: {
      type: Number,
    },
    sectionType: {
      type: String,
      enum: ['title', 'abstract', 'heading', 'paragraph', 'list_item', 'reference_item', 'caption', 'metadata', 'unknown', 'figure', 'table', 'page_break', 'reference'],
      default: 'unknown',
    },
    style: {
      type: Schema.Types.Mixed,
    },
    html: {
      type: String,
    },
  },
  {
    timestamps: true,
    collection: 'academic_fulltext_sections',
  }
);

// Compound index to ensure unique section order per imported fulltext
AcademicFullTextSectionSchema.index({ academicFullTextId: 1, sectionIndex: 1 }, { unique: true });

export default mongoose.model<IAcademicFullTextSection>('AcademicFullTextSection', AcademicFullTextSectionSchema);
