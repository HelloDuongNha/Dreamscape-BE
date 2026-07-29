import { hasStoredOriginalPdf } from '../storage/originalPdfStorage.service';

export function mapSourceOriginAndUrls(doc: any) {
  if (!doc) return doc;

  const source = doc.toObject ? doc.toObject() : { ...doc };
  source.isbn = source.isbn || source.metadata?.isbn || '';

  if (!hasStoredOriginalPdf(source.originalFile)) {
    source.originalFile = undefined;
    source.contributionType = source.doi ? 'doi' : 'metadata';
    source.sourceType = source.doi ? 'doi' : 'metadata';
    source.sourceOrigin = source.sourceOrigin || (source.doi ? 'doi_import' : 'unspecified');
    return source;
  }

  const originalFile = { ...source.originalFile };
  originalFile.cloudinarySecureUrl = originalFile.cloudinarySecureUrl || '';
  originalFile.secureUrl = originalFile.cloudinarySecureUrl || '';
  originalFile.url = originalFile.cloudinarySecureUrl || '';
  originalFile.originalFilename = originalFile.originalFileName || '';
  originalFile.originalFileName = originalFile.originalFileName || '';
  originalFile.bytes = originalFile.fileSize || 0;
  originalFile.size = originalFile.fileSize || 0;
  originalFile.fileSize = originalFile.fileSize || 0;
  originalFile.mimeType = originalFile.mimeType || '';
  originalFile.fileHash = originalFile.fileHash || '';
  originalFile.sha256 = originalFile.fileHash || '';

  source.originalFile = originalFile;
  source.pdfUrl = source.pdfUrl || originalFile.cloudinarySecureUrl || '';
  source.fullTextUrl = source.fullTextUrl || originalFile.cloudinarySecureUrl || '';
  source.fileHash = source.fileHash || originalFile.fileHash || '';
  source.contributionType = source.doi ? 'doi' : 'pdf_upload';
  source.sourceType = source.doi ? 'doi' : 'pdf_upload';
  source.sourceOrigin = 'uploaded_pdf';

  return source;
}
