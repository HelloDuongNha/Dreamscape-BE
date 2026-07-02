import { FullTextCandidate } from './types';
import { isValidHttpUrl } from '../../utils/ssrfGuard';

export function collectCandidates(source: any): FullTextCandidate[] {
  const candidates: FullTextCandidate[] = [];

  // Check if it is an uploaded PDF (priority 1.0 confidence)
  const originalFile = source.originalFile;
  if (originalFile && originalFile.storageProvider === 'cloudinary' && originalFile.cloudinarySecureUrl) {
    candidates.push({
      sourceType: 'uploaded_pdf',
      url: originalFile.cloudinarySecureUrl,
      contentType: 'pdf',
      confidence: 1.0,
      reason: 'Tệp PDF tải lên bởi người dùng'
    });
    // For uploaded PDF, we can try it as a candidate but do not skip other candidate URL crawling as fallbacks
  }

  // PMCID EuropePMC Support
  if (source.pmcid) {
    const pmcid = source.pmcid.toUpperCase();
    candidates.push({
      sourceType: 'jats_xml',
      url: `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`,
      contentType: 'xml',
      confidence: 1.0,
      reason: 'PMC JATS XML từ EuropePMC API'
    });
    candidates.push({
      sourceType: 'pmc_html',
      url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
      contentType: 'html',
      confidence: 0.95,
      reason: 'Đường dẫn NCBI PMC HTML chính thức'
    });
    candidates.push({
      sourceType: 'publisher_html',
      url: `https://europepmc.org/articles/${pmcid}`,
      contentType: 'html',
      confidence: 0.9,
      reason: 'PMC HTML từ EuropePMC'
    });
    candidates.push({
      sourceType: 'pdf',
      url: `https://europepmc.org/articles/${pmcid}?pdf=render`,
      contentType: 'pdf',
      confidence: 0.8,
      reason: 'PMC PDF từ EuropePMC'
    });
  }

  // Derive official Frontiers publisher XML/HTML endpoints if applicable
  if (source.doi && source.doi.startsWith('10.3389/')) {
    const referenceUrl = source.pdfUrl || source.url || '';
    // Match Frontiers standard URL patterns: /journals/:journal/articles/:doi/pdf or /articles/:doi/pdf
    const match = referenceUrl.match(/https:\/\/www\.frontiersin\.org\/(journals\/[^\/]+\/articles|articles)\/(10\.3389\/[^\/]+)/);
    
    // Fallback parsing journal slug from Doi if possible (e.g. fpsyg.2016.00332 -> fpsyg)
    let journal = 'psychology'; // default fallback journal
    const journalMatch = source.doi.match(/^10\.3389\/([a-z]+)\./);
    if (journalMatch) {
      journal = journalMatch[1];
    } else if (match && match[1].startsWith('journals/')) {
      journal = match[1].split('/')[1];
    }

    const doiPart = source.doi;

    candidates.push({
      sourceType: 'jats_xml',
      url: `https://www.frontiersin.org/journals/${journal}/articles/${doiPart}/xml`,
      contentType: 'xml',
      confidence: 1.0,
      reason: 'Đường dẫn Frontiers JATS XML suy diễn'
    });
    candidates.push({
      sourceType: 'publisher_html',
      url: `https://www.frontiersin.org/journals/${journal}/articles/${doiPart}/full`,
      contentType: 'html',
      confidence: 0.9,
      reason: 'Đường dẫn Frontiers HTML full text suy diễn'
    });
    candidates.push({
      sourceType: 'pdf',
      url: `https://www.frontiersin.org/journals/${journal}/articles/${doiPart}/pdf`,
      contentType: 'pdf',
      confidence: 0.8,
      reason: 'Đường dẫn Frontiers PDF suy diễn'
    });
    candidates.push({
      sourceType: 'publisher_html',
      url: `https://www.frontiersin.org/articles/${doiPart}/full`,
      contentType: 'html',
      confidence: 0.7,
      reason: 'Đường dẫn Frontiers HTML cũ'
    });
  }

  // PLOS Heuristics
  if (source.doi && source.doi.startsWith('10.1371/')) {
    candidates.push({
      sourceType: 'jats_xml',
      url: `https://journals.plos.org/plosone/article/file?id=${source.doi}&type=manuscript`,
      contentType: 'xml',
      confidence: 1.0,
      reason: 'PLOS JATS XML từ Nhà xuất bản'
    });
    candidates.push({
      sourceType: 'publisher_html',
      url: `https://journals.plos.org/plosone/article?id=${source.doi}`,
      contentType: 'html',
      confidence: 0.9,
      reason: 'PLOS Landing Page HTML'
    });
  }

  // MDPI Heuristics
  if (source.doi && source.doi.startsWith('10.3390/')) {
    candidates.push({
      sourceType: 'publisher_html',
      url: `https://www.mdpi.com/${source.doi}`,
      contentType: 'html',
      confidence: 1.0,
      reason: 'Đường dẫn MDPI Landing Page'
    });
  }

  // Priority A: Discovered JATS XML (from xmlUrl)
  if (source.xmlUrl && isValidHttpUrl(source.xmlUrl)) {
    candidates.push({
      sourceType: 'jats_xml',
      url: source.xmlUrl,
      contentType: 'xml',
      confidence: 1.0,
      reason: 'Đường dẫn JATS XML chính thức'
    });
  }

  // Priority B: Publisher HTML/web links
  if (source.htmlUrl && isValidHttpUrl(source.htmlUrl)) {
    candidates.push({
      sourceType: 'publisher_html',
      url: source.htmlUrl,
      contentType: 'html',
      confidence: 0.9,
      reason: 'Đường dẫn HTML nhà xuất bản chính thức'
    });
  }
  if (source.sourceUrl && isValidHttpUrl(source.sourceUrl)) {
    candidates.push({
      sourceType: 'publisher_html',
      url: source.sourceUrl,
      contentType: 'html',
      confidence: 0.85,
      reason: 'Đường dẫn liên kết nguồn bài viết'
    });
  }
  if (source.url && isValidHttpUrl(source.url)) {
    candidates.push({
      sourceType: 'generic_html',
      url: source.url,
      contentType: 'html',
      confidence: 0.75,
      reason: 'Đường dẫn liên kết URL chung'
    });
  }

  // Priority C: Verified Open Access PDF (from pdfUrl)
  if (source.pdfUrl && isValidHttpUrl(source.pdfUrl)) {
    candidates.push({
      sourceType: 'pdf',
      url: source.pdfUrl,
      contentType: 'pdf',
      confidence: 0.5,
      reason: 'Tài liệu PDF Open Access chính thức'
    });
  }

  // Deduplicate candidates by URL
  const seenUrls = new Set<string>();
  const uniqueCandidates: FullTextCandidate[] = [];
  for (const c of candidates) {
    if (!seenUrls.has(c.url)) {
      seenUrls.add(c.url);
      uniqueCandidates.push(c);
    }
  }

  // Sort candidates by confidence descending
  return uniqueCandidates.sort((a, b) => b.confidence - a.confidence);
}
