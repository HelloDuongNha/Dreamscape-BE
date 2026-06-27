import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ISourceContribution extends Document {
  submittedBy: Types.ObjectId;
  doi?: string;
  normalizedDoi?: string;
  url?: string;
  normalizedUrl?: string;
  submittedNote?: string;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  reviewNote?: string;
  metadata: Record<string, any>;
  license: string;
  allowedUse: 'metadata_only' | 'abstract_only' | 'open_access_fulltext';
  verificationStatus: 'unverified' | 'verified_doi' | 'manual';
  sourceQuality: 'peer_reviewed' | 'preprint' | 'informal';
  copyrightStatus: 'public_domain' | 'copyrighted_with_open_access' | 'paywalled';
  duplicateOf?: Types.ObjectId;
  fullTextStatus: 'none' | 'available' | 'imported' | 'failed' | 'blocked';
  fullTextUrl?: string;
  oaStatus: string;
  openAccessStatus?: string;
  readableInApp: boolean;
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
  fullTextSourceType: 'pdf' | 'html' | 'xml' | 'repository_page' | 'unknown';
  landingPageUrl?: string;
  pdfUrl?: string;
  xmlUrl?: string;
  htmlUrl?: string;
  title?: string;
  authors?: string[];
  year?: number;
  journal?: string;
  publisher?: string;
  sourceOrigin?: 'uploaded_pdf' | 'doi_import' | 'url_import' | 'unspecified';
  createdAt: Date;
  updatedAt: Date;
}

const SourceContributionSchema = new Schema<ISourceContribution>(
  {
    submittedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'submittedBy (User ID) is required.'],
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
      index: true,
    },
    url: {
      type: String,
      trim: true,
      maxlength: [500, 'URL must not exceed 500 characters.'],
    },
    normalizedUrl: {
      type: String,
      trim: true,
      index: true,
    },
    submittedNote: {
      type: String,
      trim: true,
      maxlength: [1000, 'Submission note must not exceed 1000 characters.'],
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
      maxlength: [1000, 'Review note must not exceed 1000 characters.'],
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
    duplicateOf: {
      type: Schema.Types.ObjectId,
      ref: 'SourceContribution',
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
    title: {
      type: String,
      trim: true,
    },
    authors: {
      type: [String],
    },
    journal: {
      type: String,
      trim: true,
    },
    year: {
      type: Number,
    },
    publisher: {
      type: String,
      trim: true,
    },
    sourceOrigin: {
      type: String,
      enum: ['uploaded_pdf', 'doi_import', 'url_import', 'unspecified'],
      default: 'unspecified',
    },
  },
  {
    timestamps: true,
    collection: 'source_contributions',
  }
);

// Unique compound filters or indexes can be added if needed, but since we reject duplicate
// normalizedDoi and normalizedUrl at the controller level with clean user responses,
// simple indexes on these fields are sufficient.

export default mongoose.model<ISourceContribution>('SourceContribution', SourceContributionSchema);
