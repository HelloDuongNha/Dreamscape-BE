import { collectCandidates } from './candidateCollector.service';
import { isUrlSafe } from '../../../infrastructure/security/ssrfGuard';

export interface ResolverCandidateDiagnostic {
  sourceType: string;
  url: string;
  confidence: number;
  reason: string;
  fetchStatus?: number;
  contentType?: string;
  contentLength?: number;
  accepted: boolean;
  rejectionReason?: string;
}

export interface ResolverDiagnosticReport {
  input: string;
  normalizedInput: string;
  inputType: 'doi' | 'pmcid' | 'url' | 'uploaded_pdf';
  metadataStatus: 'resolved' | 'metadata_only' | 'failed';
  candidates: ResolverCandidateDiagnostic[];
  failurePoint?: string;
  recommendedAction?: string;
}

export async function buildResolverReport(
  rawInput: string,
  result: any
): Promise<ResolverDiagnosticReport> {
  const input = rawInput.trim();
  let inputType: 'doi' | 'pmcid' | 'url' | 'uploaded_pdf' = 'url';
  let normalizedInput = input;

  if (/^PMC\d+$/i.test(input)) {
    inputType = 'pmcid';
    normalizedInput = input.toUpperCase();
  } else if (/^10\.\d+\//.test(input) || input.includes('doi.org/')) {
    inputType = 'doi';
    normalizedInput = input.toLowerCase().replace(/^(https?:\/\/)?(www\.)?(dx\.)?doi\.org\//, '').replace(/^doi:/, '').trim();
  }

  // Map metadata status
  let metadataStatus: 'resolved' | 'metadata_only' | 'failed' = 'failed';
  if (result && result.title) {
    if (result.allowedUse === 'open_access_fulltext' || result.fullTextAvailable) {
      metadataStatus = 'resolved';
    } else {
      metadataStatus = 'metadata_only';
    }
  }

  const mockSource = {
    doi: result.doi || (inputType === 'doi' ? normalizedInput : undefined),
    pmcid: result.pmcid || (inputType === 'pmcid' ? normalizedInput : undefined),
    title: result.title || '',
    publisher: result.publisher || '',
    journal: result.journal || '',
    url: result.sourceUrl || result.url || '',
    pdfUrl: result.pdfUrl || '',
    htmlUrl: result.htmlUrl || '',
    xmlUrl: result.xmlUrl || ''
  };

  const candidates = collectCandidates(mockSource);
  const diagCandidates: ResolverCandidateDiagnostic[] = [];

  for (const cand of candidates) {
    let accepted = false;
    let rejectionReason: string | undefined;
    let fetchStatus: number | undefined;
    let contentType: string | undefined;
    let contentLength: number | undefined;

    // Direct SSRF safe fetch check
    try {
      const safe = await isUrlSafe(cand.url);
      if (!safe) {
        rejectionReason = 'ssrf_blocked';
      } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second diagnostic timeout
        
        const response = await fetch(cand.url, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': 'DreamScapeAcademicBot/1.0 (mailto:dreamscape.app.service@gmail.com; polite fetch)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        fetchStatus = response.status;
        contentType = response.headers.get('content-type') || undefined;
        const lengthHeader = response.headers.get('content-length');
        if (lengthHeader) contentLength = parseInt(lengthHeader, 10);

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          accepted = true;
        } else if (response.status === 403 || response.status === 401) {
          rejectionReason = 'blocked_by_publisher';
        } else if (!response.ok) {
          rejectionReason = 'not_found';
        } else {
          accepted = true;
        }
      }
    } catch (err: any) {
      rejectionReason = err.name === 'AbortError' ? 'timeout' : 'network_error';
    }

    diagCandidates.push({
      sourceType: cand.sourceType,
      url: cand.url,
      confidence: cand.confidence,
      reason: cand.reason,
      fetchStatus,
      contentType,
      contentLength,
      accepted,
      rejectionReason
    });
  }

  let failurePoint: string | undefined;
  let recommendedAction: string | undefined;

  if (metadataStatus === 'failed') {
    failurePoint = 'metadata_resolver_failed';
    recommendedAction = 'check_doi_registry_or_pmc_api';
  } else if (candidates.length === 0) {
    failurePoint = 'candidate_collector_failed';
    recommendedAction = 'provide_direct_pdf_upload_or_manual_url';
  } else if (!diagCandidates.some(c => c.accepted)) {
    failurePoint = 'candidate_fetch_failed';
    const isBlocked = diagCandidates.some(c => c.rejectionReason === 'blocked_by_publisher');
    recommendedAction = isBlocked ? 'metadata_only_blocked' : 'check_urls_connectivity';
  }

  return {
    input,
    normalizedInput,
    inputType,
    metadataStatus,
    candidates: diagCandidates,
    failurePoint,
    recommendedAction
  };
}
