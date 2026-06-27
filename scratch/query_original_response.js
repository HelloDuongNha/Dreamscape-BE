const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env ') });

const AcademicSourceSchema = new mongoose.Schema({}, { strict: false });
const AcademicSource = mongoose.model('AcademicSource', AcademicSourceSchema, 'academic_sources');

// Fetch utility function copy from backend controller
function isUrlPdfLike(url) {
  return url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('type=printable') || url.toLowerCase().includes('/pdf/');
}

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  await mongoose.connect(uri);
  
  const plosOneId = '6a3429db114ad00e3c33f0d2';
  const e2eId = '6a3dfc2070d817a75983aa74';
  
  const plosOne = await AcademicSource.findById(plosOneId);
  const e2e = await AcademicSource.findById(e2eId);
  
  // Let's simulate getApprovedSourceOriginalDocument
  function getOriginalDocResponse(source) {
    let confirmedPdf = false;
    let pdfUrlToUse = '';
    let isCloudinary = false;

    // 1. Cloudinary RAW file upload check
    if (source.originalFile?.storageProvider === 'cloudinary' && source.originalFile?.cloudinarySecureUrl) {
      const mime = source.originalFile.mimeType || '';
      const name = source.originalFile.originalFileName || '';
      const format = source.originalFile.cloudinaryFormat || '';
      if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf') || format === 'pdf') {
        confirmedPdf = true;
        pdfUrlToUse = source.originalFile.cloudinarySecureUrl;
        isCloudinary = true;
      }
    }

    // 2. Verified/discovered pdfUrl check
    if (!confirmedPdf && source.pdfUrl && source.pdfUrl.trim().startsWith('http')) {
      const trimmed = source.pdfUrl.trim();
      if (isUrlPdfLike(trimmed)) {
        confirmedPdf = true;
        pdfUrlToUse = trimmed;
      }
    }

    // 3. Fallback check for url/fullTextUrl
    if (!confirmedPdf) {
      const fallbackUrl = source.fullTextUrl || source.url;
      if (fallbackUrl && fallbackUrl.trim().startsWith('http')) {
        const trimmed = fallbackUrl.trim();
        if (isUrlPdfLike(trimmed)) {
          confirmedPdf = true;
          pdfUrlToUse = trimmed;
        }
      }
    }

    if (confirmedPdf && pdfUrlToUse) {
      return {
        success: true,
        viewUrl: pdfUrlToUse,
        canEmbed: true,
        hasPdf: true,
        sourceKind: isCloudinary ? 'cloudinary' : 'verified_oa_pdf',
      };
    }
    
    return {
      success: true,
      canEmbed: false,
      hasPdf: false,
      sourceKind: 'metadata_only'
    };
  }
  
  console.log('PLOS ONE original response:', getOriginalDocResponse(plosOne));
  console.log('E2E original response:', getOriginalDocResponse(e2e));
  
  await mongoose.disconnect();
}

run().catch(console.error);
