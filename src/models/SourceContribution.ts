import mongoose, { Document, Schema, Types } from 'mongoose';

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
  license: string;
  allowedUse: string;
  title: string;
  authors: string[];
  year?: number;
  originalFile?: {
    storageProvider?: 'cloudinary' | 'local' | 'gridfs';
    originalFileName?: string;
    mimeType?: string;
    fileSize?: number;
    cloudinaryPublicId?: string;
    cloudinarySecureUrl?: string;
    cloudinaryResourceType?: 'image' | 'raw' | 'video';
    cloudinaryFormat?: string;
    uploadedBy?: Types.ObjectId;
    uploadedAt?: Date;
    fileHash?: string;
  };
  fullTextStatus?: 'none' | 'importing' | 'imported' | 'failed' | 'available';
  pdfUrl?: string;
  htmlUrl?: string;
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
      required: true,
    },
    allowedUse: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    authors: {
      type: [String],
      required: true,
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
  },
  {
    timestamps: true,
    collection: 'source_contributions',
  }
);

export default mongoose.model<ISourceContribution>('SourceContribution', SourceContributionSchema);
