import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAcademicFullText extends Document {
  academicSourceId: Types.ObjectId;
  sourceType: 'pdf' | 'html' | 'repository_page' | 'unknown';
  extractionStatus: 'pending' | 'success' | 'failed';
  wordCount: number;
  characterCount: number;
  sectionCount: number;
  license: string;
  sourceUrl: string;
  importedBy: Types.ObjectId;
  importedAt: Date;
  errorReason?: string;
  extractionEngine?: 'grobid' | 'pymupdf' | 'pdf_parse' | 'html' | 'xml' | 'unknown' | 'jats_xml' | 'publisher_html' | 'sanitized_html' | 'pymupdf_text' | 'pdf_parse_fallback';
  extractionQuality?: 'high' | 'medium' | 'low';
  structureVersion?: string;
  hasStructuredReferences?: boolean;
  hasDetectedSections?: boolean;
  smartReaderSourceType?: 'jats_xml' | 'publisher_html' | 'sanitized_html' | 'pdf_text' | 'uploaded_pdf_text' | 'metadata_only';
  sourceUrlUsed?: string;
  parserQuality?: string;
  layoutQuality?: string;
  sourceUsedUrl?: string;
  sourceUsedType?: 'html' | 'xml' | 'pdf';
  readingHtml?: string;
  readingBlocks?: Array<{
    type: 'title' | 'heading' | 'paragraph' | 'list_item' | 'table' | 'figure' | 'caption' | 'blockquote' | 'page_break' | 'reference' | 'metadata';
    text?: string;
    html?: string;
    page?: number;
    order: number;
    asset?: {
      storageProvider: 'cloudinary';
      publicId: string;
      secureUrl: string;
      resourceType: string;
      format?: string;
      width?: number;
      height?: number;
      bytes?: number;
    };
    alt?: string;
    caption?: string;
    style?: Record<string, any>;
  }>;
  ocrNeeded?: boolean;
  warnings?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const AcademicFullTextSchema = new Schema<IAcademicFullText>(
  {
    academicSourceId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicSource',
      required: true,
      unique: true,
      index: true,
    },
    sourceType: {
      type: String,
      enum: ['pdf', 'html', 'repository_page', 'unknown'],
      required: true,
    },
    extractionStatus: {
      type: String,
      enum: ['pending', 'success', 'failed'],
      default: 'pending',
    },
    wordCount: {
      type: Number,
      default: 0,
    },
    characterCount: {
      type: Number,
      default: 0,
    },
    sectionCount: {
      type: Number,
      default: 0,
    },
    license: {
      type: String,
      default: 'unknown',
    },
    sourceUrl: {
      type: String,
      required: true,
    },
    importedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    importedAt: {
      type: Date,
      default: Date.now,
    },
    errorReason: {
      type: String,
    },
    extractionEngine: {
      type: String,
      enum: ['grobid', 'pymupdf', 'pdf_parse', 'html', 'xml', 'unknown', 'jats_xml', 'publisher_html', 'sanitized_html', 'pymupdf_text', 'pdf_parse_fallback'],
      default: 'unknown',
    },
    smartReaderSourceType: {
      type: String,
      enum: ['jats_xml', 'publisher_html', 'sanitized_html', 'pdf_text', 'uploaded_pdf_text', 'metadata_only'],
    },
    sourceUrlUsed: {
      type: String,
      trim: true,
    },
    parserQuality: {
      type: String,
    },
    layoutQuality: {
      type: String,
    },
    extractionQuality: {
      type: String,
      enum: ['high', 'medium', 'low'],
    },
    structureVersion: {
      type: String,
    },
    hasStructuredReferences: {
      type: Boolean,
      default: false,
    },
    hasDetectedSections: {
      type: Boolean,
      default: false,
    },
    sourceUsedUrl: {
      type: String,
      trim: true,
    },
    sourceUsedType: {
      type: String,
      enum: ['html', 'xml', 'pdf'],
    },
    readingHtml: {
      type: String,
    },
    readingBlocks: [
      {
        type: {
          type: String,
          enum: [
            'title',
            'heading',
            'paragraph',
            'list_item',
            'table',
            'figure',
            'caption',
            'blockquote',
            'page_break',
            'reference',
            'metadata',
          ],
        },
        text: String,
        html: String,
        page: Number,
        order: Number,
        asset: {
          storageProvider: {
            type: String,
            enum: ['cloudinary'],
          },
          publicId: String,
          secureUrl: String,
          resourceType: String,
          format: String,
          width: Number,
          height: Number,
          bytes: Number,
        },
        alt: String,
        caption: String,
        style: Schema.Types.Mixed,
      },
    ],
    ocrNeeded: {
      type: Boolean,
      default: false,
    },
    warnings: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'academic_fulltexts',
  }
);

export default mongoose.model<IAcademicFullText>('AcademicFullText', AcademicFullTextSchema);
