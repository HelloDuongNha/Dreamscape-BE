import { CacheAttemptSummary } from '../../dto/originalPdfAsset.dto';
import { fetchUrlWithSafeRedirects } from '../../../../infrastructure/security/ssrfGuard';

type CandidateFetchResult =
  | { ok: true; buffer: Buffer; contentType: string }
  | { ok: false; attempt: CacheAttemptSummary };

function isBlockedPublisher(url: string): boolean {
  const normalized = url.toLowerCase();
  return (
    (
      normalized.includes('wiley.com') ||
      normalized.includes('elsevier.com') ||
      normalized.includes('sciencedirect.com') ||
      normalized.includes('springer.com')
    ) &&
    !normalized.includes('pmc.ncbi.nlm.nih.gov')
  );
}

function classifyFetchFailure(error: any): string {
  const message = String(error?.message || '');
  return (
    message.includes('403') ||
    message.includes('401') ||
    message.includes('429') ||
    message.toLowerCase().includes('forbidden') ||
    message.toLowerCase().includes('access denied')
  ) ? 'publisher_blocked' : 'fetch_failed';
}

function classifyNonPdf(buffer: Buffer): CacheAttemptSummary['reason'] {
  const body = buffer.toString('utf-8').substring(0, 2000);
  if (body.includes('recaptcha') || body.includes('g-recaptcha')) return 'recaptcha_challenge_page';
  if (body.includes('Wiley Online Library') || body.includes('cookie') || body.includes('Access Denied')) {
    return 'publisher_blocked';
  }
  if (body.includes('preparing') || body.includes('download')) return 'preparing_download_page';
  return 'html_not_pdf';
}

async function discoverPmcPdf(url: string): Promise<CandidateFetchResult | string> {
  try {
    const page = await fetchUrlWithSafeRedirects(url, false);
    const html = page.buffer.toString('utf-8');
    if (html.includes('recaptcha') || html.includes('g-recaptcha') || page.contentType.includes('recaptcha')) {
      return {
        ok: false,
        attempt: { url, status: 'failed', contentType: page.contentType, reason: 'recaptcha_challenge_page' },
      };
    }
    const match = html.match(/\/articles\/PMC\d+\/pdf\/[^"'>\s]+/i)?.[0];
    return match
      ? `https://pmc.ncbi.nlm.nih.gov${match}`
      : { ok: false, attempt: { url, status: 'failed', contentType: page.contentType, reason: 'html_not_pdf' } };
  } catch {
    return { ok: false, attempt: { url, status: 'failed', reason: 'fetch_failed' } };
  }
}

// Resolve landing pages and return only bytes verified as a PDF.
export async function fetchOriginalPdfCandidate(url: string): Promise<CandidateFetchResult> {
  let targetUrl = url;
  if (url.includes('pmc.ncbi.nlm.nih.gov/articles/') && !url.includes('/pdf/') && url.endsWith('/')) {
    const discovered = await discoverPmcPdf(url);
    if (typeof discovered !== 'string') return discovered;
    targetUrl = discovered;
  }

  if (isBlockedPublisher(targetUrl)) {
    return { ok: false, attempt: { url: targetUrl, status: 'failed', reason: 'publisher_blocked' } };
  }

  let response;
  try {
    response = await fetchUrlWithSafeRedirects(targetUrl, false);
  } catch (error) {
    return {
      ok: false,
      attempt: { url: targetUrl, status: 'failed', reason: classifyFetchFailure(error) },
    };
  }

  const isPdfType =
    response.contentType.includes('application/pdf') ||
    response.contentType.includes('application/x-pdf');
  const hasPdfMagic = response.buffer.slice(0, 4).toString('ascii') === '%PDF';
  if (!isPdfType && !hasPdfMagic) {
    return {
      ok: false,
      attempt: {
        url: targetUrl,
        status: 'failed',
        contentType: response.contentType,
        reason: classifyNonPdf(response.buffer),
      },
    };
  }
  return { ok: true, buffer: response.buffer, contentType: response.contentType };
}
