import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAcademicSource extends Document {
  doi?: string;
  normalizedDoi?: string;
  url?: string;
  normalizedUrl?: string;
  license: string;
  allowedUse: string;
  readableInApp: boolean;
  pdfUrl?: string;
  title: string;
  authors: string[];
  journal?: string;
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
  chunkBuildStatus: string;
  chunkEmbeddingModel?: string;
}

const AcademicSourceSchema = new Schema<IAcademicSource>(
  {
    doi: {
      type: String,
      trim: true,
    },
    normalizedDoi: {
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
      index: {
        unique: true,
        sparse: true,
      },
    },
    license: {
      type: String,
      required: true,
    },
    allowedUse: {
      type: String,
      required: true,
    },
    readableInApp: {
      type: Boolean,
      required: true,
      default: false,
    },
    pdfUrl: {
      type: String,
      trim: true,
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
    journal: {
      type: String,
      trim: true,
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
    chunkBuildStatus: {
      type: String,
      required: true,
      default: 'none',
    },
    chunkEmbeddingModel: {
      type: String,
    },
  },
  {
    timestamps: true,
    collection: 'academic_sources',
  }
);

export default mongoose.model<IAcademicSource>('AcademicSource', AcademicSourceSchema);
