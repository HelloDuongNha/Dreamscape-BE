import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAcademicSource extends Document {
  sourceContributionId: Types.ObjectId;
  doi?: string;
  normalizedDoi?: string;
  pmcid?: string;
  normalizedPmcid?: string;
  url?: string;
  normalizedUrl?: string;
  metadata: Record<string, any>;
  license: string;
  allowedUse: 'metadata_only' | 'abstract_only' | 'open_access_fulltext';
  verificationStatus: 'unverified' | 'verified_doi' | 'manual';
  sourceQuality: 'peer_reviewed' | 'preprint' | 'informal';
  copyrightStatus: 'public_domain' | 'copyrighted_with_open_access' | 'paywalled';
  title?: string;
  authors?: string[];
  journal?: string;
  year?: number;
  abstract?: string;
  fullTextStatus: 'none' | 'available' | 'imported' | 'failed' | 'blocked';
  fullTextUrl?: string;
  oaStatus: string;
  openAccessStatus?: string;
  readableInApp: boolean;
  fullTextSourceType: 'pdf' | 'html' | 'xml' | 'repository_page' | 'unknown';
  landingPageUrl?: string;
  pdfUrl?: string;
  xmlUrl?: string;
  htmlUrl?: string;
  fullTextImportError?: string;
  fullTextImportedAt?: Date;
  fullTextImportedBy?: Types.ObjectId;
  originalFile?: {
    storageProvider: 'cloudinary' | 'local' | 'gridfs';
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    cloudinaryPublicId?: string;
    cloudinarySecureUrl?: string;
    cloudinaryResourceType?: 'image' | 'raw' | 'video';
    cloudinaryFormat?: string;
    uploadedBy?: Types.ObjectId;
    uploadedAt?: Date;
    fileHash?: string;
  };
  chunkBuildStatus?: 'none' | 'building' | 'completed' | 'failed';
  chunkBuildError?: string;
  chunkBuiltAt?: Date;
  chunkEmbeddingModel?: string;
  chunkCount?: number;
  smartReaderStats?: {
    pageCount: number;
    figureCount: number;
    tableCount: number;
    referenceCount: number;
    updatedAt?: Date;
  };
  // PDF-only ingestion metadata
  sourceOrigin?: 'doi' | 'pmcid' | 'isbn' | 'url' | 'uploaded_pdf' | 'doi_import' | 'url_import' | 'unspecified';
  extractionMethod?: 'jats' | 'html' | 'pdf_text' | 'ocr' | 'mixed';
  extractionQuality?: 'good' | 'partial' | 'poor';
  pdfPageCount?: number;
  detectedLanguage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AcademicSourceSchema = new Schema<IAcademicSource>(
  {
    sourceContributionId: {
      type: Schema.Types.ObjectId,
      ref: 'SourceContribution',
      required: [true, 'sourceContributionId is required.'],
      unique: true,
      index: true,
    },
    doi: {
      type: String,
      trim: true,
      maxlength: [100, 'DOI must not exceed 100 characters.'],
    },
    normalizedDoi: {
      type: String,
      trim: true,
      index: {
        unique: true,
        sparse: true,
      },
    },
    pmcid: {
      type: String,
      trim: true,
      maxlength: [100, 'PMCID must not exceed 100 characters.'],
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
      maxlength: [500, 'URL must not exceed 500 characters.'],
    },
    normalizedUrl: {
      type: String,
      trim: true,
      index: {
        unique: true,
        sparse: true,
      },
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    license: {
      type: String,
      default: 'all-rights-reserved',
    },
    allowedUse: {
      type: String,
      enum: ['metadata_only', 'abstract_only', 'open_access_fulltext'],
      default: 'metadata_only',
    },
    verificationStatus: {
      type: String,
      enum: ['unverified', 'verified_doi', 'manual'],
      default: 'unverified',
    },
    sourceQuality: {
      type: String,
      enum: ['peer_reviewed', 'preprint', 'informal'],
      default: 'informal',
    },
    copyrightStatus: {
      type: String,
      enum: ['public_domain', 'copyrighted_with_open_access', 'paywalled'],
      default: 'paywalled',
    },
    fullTextStatus: {
      type: String,
      enum: ['none', 'available', 'imported', 'failed', 'blocked'],
      default: 'none',
    },
    fullTextUrl: {
      type: String,
      trim: true,
    },
    landingPageUrl: {
      type: String,
      trim: true,
    },
    pdfUrl: {
      type: String,
      trim: true,
    },
    xmlUrl: {
      type: String,
      trim: true,
    },
    htmlUrl: {
      type: String,
      trim: true,
    },
    oaStatus: {
      type: String,
      default: 'closed',
    },
    openAccessStatus: {
      type: String,
      default: 'unknown',
    },
    originalFile: {
      storageProvider: {
        type: String,
        enum: ['cloudinary', 'local', 'gridfs'],
      },
      originalFileName: String,
      mimeType: String,
      fileSize: Number,
      cloudinaryPublicId: String,
      cloudinarySecureUrl: String,
      cloudinaryResourceType: String,
      cloudinaryFormat: String,
      uploadedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
      uploadedAt: Date,
      fileHash: {
        type: String,
        index: true,
      },
    },
    readableInApp: {
      type: Boolean,
      default: false,
    },
    fullTextSourceType: {
      type: String,
      enum: ['pdf', 'html', 'xml', 'repository_page', 'unknown'],
      default: 'unknown',
    },
    fullTextImportError: {
      type: String,
    },
    fullTextImportedAt: {
      type: Date,
    },
    fullTextImportedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    title: {
      type: String,
      trim: true,
    },
    authors: {
      type: [String],
      default: undefined,
    },
    journal: {
      type: String,
      trim: true,
    },
    year: {
      type: Number,
    },
    abstract: {
      type: String,
      trim: true,
    },
    chunkBuildStatus: {
      type: String,
      enum: ['none', 'building', 'completed', 'failed'],
      default: 'none',
    },
    chunkBuildError: {
      type: String,
    },
    chunkBuiltAt: {
      type: Date,
    },
    chunkEmbeddingModel: {
      type: String,
    },
    chunkCount: {
      type: Number,
      default: 0,
    },
    sourceOrigin: {
      type: String,
      enum: ['doi', 'pmcid', 'isbn', 'url', 'uploaded_pdf', 'doi_import', 'url_import', 'unspecified'],
    },
    smartReaderStats: {
      pageCount: { type: Number, default: 0 },
      figureCount: { type: Number, default: 0 },
      tableCount: { type: Number, default: 0 },
      referenceCount: { type: Number, default: 0 },
      updatedAt: { type: Date }
    },
    // PDF-only ingestion metadata
    extractionMethod: {
      type: String,
      enum: ['jats', 'html', 'pdf_text', 'ocr', 'mixed'],
    },
    extractionQuality: {
      type: String,
      enum: ['good', 'partial', 'poor'],
    },
    pdfPageCount: {
      type: Number,
    },
    detectedLanguage: {
      type: String,
    },
  },
  {
    timestamps: true,
    collection: 'academic_sources',
  }
);

export default mongoose.model<IAcademicSource>('AcademicSource', AcademicSourceSchema);
