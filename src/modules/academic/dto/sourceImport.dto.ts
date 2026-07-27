import mongoose from 'mongoose';

export interface SourceImportResolverInput {
  doi?: string;
  pmcid?: string;
  url?: string;
  isbn?: string;
  uploadedFileRef?: {
    storageProvider: 'cloudinary';
    cloudinaryPublicId: string;
    cloudinarySecureUrl: string;
    cloudinaryResourceType: 'image' | 'raw' | 'video';
    cloudinaryFormat?: string;
    originalFileName?: string;
    mimeType?: string;
    fileSize?: number;
  };
}

export interface SourceImportResolverResult {
  sourceType: 'doi' | 'pmcid' | 'web_url' | 'pdf_url' | 'pdf_upload' | 'isbn';
  title?: string;
  authors: string[];
  year?: number;
  journal?: string;
  publisher?: string;
  doi?: string;
  pmcid?: string;
  normalizedPmcid?: string;
  isbn?: string;
  sourceUrl?: string;
  pdfUrl?: string;
  htmlUrl?: string;
  xmlUrl?: string;
  openAccessStatus: 'hybrid' | 'gold' | 'green' | 'bronze' | 'open' | 'closed' | 'restricted' | 'unknown';
  license?: string;
  allowedUse: 'metadata_only' | 'abstract_only' | 'open_access_fulltext';
  fullTextAvailable: boolean;
  metadataProvider: string;
  originalFile?: {
    storageProvider: 'cloudinary';
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    cloudinaryPublicId: string;
    cloudinarySecureUrl: string;
    cloudinaryResourceType: 'image' | 'raw' | 'video';
    cloudinaryFormat?: string;
    uploadedBy?: mongoose.Types.ObjectId;
    uploadedAt?: Date;
  };
  warnings: string[];
}
