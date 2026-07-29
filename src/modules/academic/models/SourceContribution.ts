import { Document, Schema, Types } from 'mongoose';
import { modelForDomain } from '../../../infrastructure/database/domainModels';

export interface ISourceContribution extends Document {
  submittedBy: Types.ObjectId;
  doi?: string;
  normalizedDoi?: string;
  pmcid?: string;
  normalizedPmcid?: string;
  url?: string;
  normalizedUrl?: string;
  submittedNote?: string;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  reviewNote?: string;
  license?: string;
  allowedUse?: string;
  title?: string;
  authors?: string[];
  year?: number;
  originalFile?: {
    storageProvider?: 'firebase' | 'cloudinary' | 'local' | 'gridfs';
    originalFileName?: string;
    mimeType?: string;
    fileSize?: number;
    cloudinaryPublicId?: string;
    cloudinarySecureUrl?: string;
    cloudinaryResourceType?: 'image' | 'raw' | 'video';
    cloudinaryFormat?: string;
    firebaseStorageBucket?: string;
    firebaseStoragePath?: string;
    uploadedBy?: Types.ObjectId;
    uploadedAt?: Date;
    fileHash?: string;
  };
  fullTextStatus?: 'none' | 'importing' | 'imported' | 'failed' | 'available';
  pdfUrl?: string;
  htmlUrl?: string;
  readableInApp?: boolean;
  copyrightStatus?: 'public_domain' | 'copyrighted_with_open_access' | 'paywalled';
  metadata?: Record<string, any>;
  smartReaderStats?: {
    pageCount: number;
    figureCount: number;
    tableCount: number;
    referenceCount: number;
    updatedAt?: Date;
  };
  // PDF-only ingestion metadata
  sourceOrigin?: 'doi' | 'pmcid' | 'isbn' | 'url' | 'uploaded_pdf' | 'doi_import' | 'url_import' | 'unspecified';
  extractionStatus?: 'uploaded' | 'inspecting' | 'extracting_text' | 'resolving_identifiers' | 'fetching_preferred_source' | 'ocr_processing' | 'compiling_reader' | 'completed' | 'partial' | 'failed';
  extractionMethod?: 'jats' | 'html' | 'pdf_text' | 'ocr' | 'mixed';
  extractionQuality?: 'good' | 'partial' | 'poor';
  detectedIdentifiers?: {
    doi?: string;
    isbn?: string;
    pmcid?: string;
  };
  pdfPageCount?: number;
  detectedLanguage?: string;
  readerBuildSnapshots?: Array<{
    status?: 'success' | 'failed';
    engine: string;
    sourceType: string;
    sectionCount: number;
    chunkCount: number;
    builtAt: Date;
    durationMs?: number;
    estimatedDurationSeconds?: number;
    pageCount?: number;
    ocrUsed?: boolean;
    failureCode?: string;
    failureMessage?: string;
  }>;
  pdfImportProgress?: {
    stage: string;
    startedAt: Date;
    updatedAt: Date;
    expectedDurationSeconds: number;
    pageCount: number;
    fileSizeBytes: number;
    ocrExpected: boolean;
    completedAt?: Date;
    durationMs?: number;
    timingDeltaSeconds?: number;
    failureCode?: string;
    failureMessage?: string;
  };
  pdfImportHistory?: Array<{
    durationMs: number;
    estimatedDurationSeconds: number;
    pageCount: number;
    fileSizeBytes: number;
    ocrUsed: boolean;
    succeeded?: boolean;
    completedAt: Date;
  }>;
}

const SourceContributionSchema = new Schema<ISourceContribution>(
  {
    submittedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    doi: {
      type: String,
      trim: true,
    },
    normalizedDoi: {
      type: String,
      trim: true,
      index: true,
    },
    pmcid: {
      type: String,
      trim: true,
    },
    normalizedPmcid: {
      type: String,
      trim: true,
      index: {
        unique: true,
        sparse: true,
      },
    },
    url: {
      type: String,
      trim: true,
    },
    normalizedUrl: {
      type: String,
      trim: true,
      index: true,
    },
    submittedNote: {
      type: String,
      trim: true,
    },
    reviewStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: {
      type: Date,
    },
    reviewNote: {
      type: String,
      trim: true,
    },
    license: {
      type: String,
    },
    allowedUse: {
      type: String,
    },
    title: {
      type: String,
      trim: true,
    },
    authors: {
      type: [String],
    },
    year: {
      type: Number,
    },
    originalFile: {
      storageProvider: String,
      originalFileName: String,
      mimeType: String,
      fileSize: Number,
      cloudinaryPublicId: String,
      cloudinarySecureUrl: String,
      cloudinaryResourceType: String,
      cloudinaryFormat: String,
      firebaseStorageBucket: String,
      firebaseStoragePath: String,
      uploadedBy: Schema.Types.ObjectId,
      uploadedAt: Date,
      fileHash: String,
    },
    fullTextStatus: {
      type: String,
      enum: ['none', 'importing', 'imported', 'failed', 'available'],
      default: 'none',
    },
    pdfUrl: {
      type: String,
      trim: true,
    },
    htmlUrl: {
      type: String,
      trim: true,
    },
    copyrightStatus: {
      type: String,
      enum: ['public_domain', 'copyrighted_with_open_access', 'paywalled'],
    },
    readableInApp: {
      type: Boolean,
      default: false,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    smartReaderStats: {
      pageCount: { type: Number, default: 0 },
      figureCount: { type: Number, default: 0 },
      tableCount: { type: Number, default: 0 },
      referenceCount: { type: Number, default: 0 },
      updatedAt: { type: Date }
    },
    // PDF-only ingestion metadata
    sourceOrigin: {
      type: String,
      enum: ['doi', 'pmcid', 'isbn', 'url', 'uploaded_pdf', 'doi_import', 'url_import', 'unspecified'],
    },
    extractionStatus: {
      type: String,
      enum: ['uploaded', 'inspecting', 'extracting_text', 'resolving_identifiers', 'fetching_preferred_source', 'ocr_processing', 'compiling_reader', 'completed', 'partial', 'failed'],
    },
    extractionMethod: {
      type: String,
      enum: ['jats', 'html', 'pdf_text', 'ocr', 'mixed'],
    },
    extractionQuality: {
      type: String,
      enum: ['good', 'partial', 'poor'],
    },
    detectedIdentifiers: {
      doi: { type: String, trim: true },
      isbn: { type: String, trim: true },
      pmcid: { type: String, trim: true },
    },
    pdfPageCount: {
      type: Number,
    },
    detectedLanguage: {
      type: String,
    },
    readerBuildSnapshots: [{
      status: { type: String, enum: ['success', 'failed'], default: 'success' },
      engine: { type: String, required: true },
      sourceType: { type: String, required: true },
      sectionCount: { type: Number, required: true, min: 0 },
      chunkCount: { type: Number, required: true, min: 0 },
      builtAt: { type: Date, required: true },
      durationMs: { type: Number, min: 0 },
      estimatedDurationSeconds: { type: Number, min: 1 },
      pageCount: { type: Number, min: 0 },
      ocrUsed: { type: Boolean },
      failureCode: { type: String },
      failureMessage: { type: String },
      _id: false,
    }],
    pdfImportProgress: {
      stage: { type: String },
      startedAt: { type: Date },
      updatedAt: { type: Date },
      expectedDurationSeconds: { type: Number, min: 1 },
      pageCount: { type: Number, min: 0, default: 0 },
      fileSizeBytes: { type: Number, min: 0, default: 0 },
      ocrExpected: { type: Boolean, default: false },
      completedAt: { type: Date },
      durationMs: { type: Number, min: 0 },
      timingDeltaSeconds: { type: Number },
      failureCode: { type: String },
      failureMessage: { type: String },
      _id: false,
    },
    pdfImportHistory: [{
      durationMs: { type: Number, required: true, min: 0 },
      estimatedDurationSeconds: { type: Number, required: true, min: 1 },
      pageCount: { type: Number, required: true, min: 0 },
      fileSizeBytes: { type: Number, required: true, min: 0 },
      ocrUsed: { type: Boolean, required: true },
      succeeded: { type: Boolean },
      completedAt: { type: Date, required: true },
      _id: false,
    }],
  },
  {
    timestamps: true,
    collection: 'source_contributions',
  }
);

export default modelForDomain<ISourceContribution>(
  'knowledge',
  'SourceContribution',
  SourceContributionSchema,
);
