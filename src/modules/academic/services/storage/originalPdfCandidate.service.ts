import { hasStoredOriginalPdf } from './originalPdfStorage.service';

export function isValidOriginalPdfAsset(originalFile: any): boolean {
  if (!hasStoredOriginalPdf(originalFile)) return false;
  const mime = originalFile.mimeType || '';
  const name = originalFile.originalFileName || '';
  const format = originalFile.cloudinaryFormat || '';
  return (
    mime === 'application/pdf' ||
    name.toLowerCase().endsWith('.pdf') ||
    format.toLowerCase() === 'pdf'
  );
}

// Gather lawful PDF candidates in the same priority used by the cache flow.
export function collectOriginalPdfCandidates(source: any): string[] {
  const candidates: string[] = [];
  const isCloudinaryUrl = (url: string): boolean => {
    const normalized = url.toLowerCase();
    return normalized.includes('cloudinary.com') || normalized.includes('res.cloudinary.com');
  };

  if (typeof source.pdfUrl === 'string' && source.pdfUrl.trim().startsWith('http')) {
    const pdfUrl = source.pdfUrl.trim();
    if (!isCloudinaryUrl(pdfUrl)) candidates.push(pdfUrl);
  }

  let pmcId = source.pmcid || source.normalizedPmcid || source.metadata?.pmcid || source.metadata?.pmcId;
  if (!pmcId) {
    const urls = [source.pdfUrl, source.url, source.htmlUrl, source.metadata?.url, source.metadata?.htmlUrl];
    for (const url of urls) {
      if (typeof url !== 'string') continue;
      const match = url.match(/(PMC\d+)/i);
      if (match) {
        pmcId = match[1];
        break;
      }
    }
  }

  if (pmcId) {
    const value = pmcId.trim().toUpperCase();
    const normalized = value.startsWith('PMC') ? value : `PMC${value}`;
    candidates.push(`https://pmc.ncbi.nlm.nih.gov/articles/${normalized}/pdf/`);
    candidates.push(`https://pmc.ncbi.nlm.nih.gov/articles/${normalized}/`);
  }

  const doi = source.doi || source.normalizedDoi || source.metadata?.doi;
  if (doi && doi.trim().startsWith('10.1111/')) {
    candidates.push(`https://onlinelibrary.wiley.com/doi/epdf/${doi.trim()}`);
  }

  const otherUrls = [
    source.url,
    source.htmlUrl,
    source.landingPageUrl,
    source.metadata?.url,
    source.metadata?.htmlUrl,
  ];
  for (const url of otherUrls) {
    if (typeof url !== 'string' || !url.trim().startsWith('http')) continue;
    const value = url.trim();
    if (isCloudinaryUrl(value)) continue;
    const normalized = value.toLowerCase();
    if (normalized.endsWith('.pdf') || normalized.includes('/pdf/') || normalized.includes('/pdf?')) {
      candidates.push(value);
    }
  }
  return [...new Set(candidates)];
}
