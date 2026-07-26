export interface UnpaywallResult {
  success: boolean;
  isEmailMissing?: boolean;
  data?: {
    is_oa: boolean;
    license?: string;
    oa_status?: string;
    url_for_pdf?: string;
    url?: string;
    host_type?: string;
    pdfUrl?: string;
    landingPageUrl?: string;
    htmlUrl?: string;
    xmlUrl?: string;
  };
}

/**
 * Normalizes DOI to a clean lowercase format.
 * Handles:
 * - http/https URL formats (dx.doi.org or doi.org)
 * - doi: prefixes
 * - leading/trailing spaces
 * - uppercase/lowercase
 */
export function normalizeDoi(doi: string): string {
  if (!doi) return '';
  let clean = doi.trim().toLowerCase();
  // Strip https?://(www\.)?doi.org/ or https?://(www\.)?dx.doi.org/
  clean = clean.replace(/^(https?:\/\/)?(www\.)?(dx\.)?doi\.org\//, '');
  // Strip doi: prefix
  clean = clean.replace(/^doi:/, '');
  return clean.trim();
}

/**
 * Helper to query Unpaywall API for Open Access status and location metadata.
 */
export async function fetchUnpaywallMetadata(doi: string): Promise<UnpaywallResult> {
  const email = process.env.UNPAYWALL_EMAIL || process.env.OPENALEX_EMAIL;
  if (!email) {
    console.warn('[Unpaywall] UNPAYWALL_EMAIL / OPENALEX_EMAIL environment variable is missing. Open-Access check skipped.');
    return { success: false, isEmailMissing: true };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second timeout

  try {
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;
    const response = await fetch(url, { signal: controller.signal });

    clearTimeout(timeoutId);

    if (response.status === 404) {
      return { success: false };
    }

    if (!response.ok) {
      return { success: false };
    }

    const data = await response.json() as any;
    if (data) {
      let license = '';
      let url_for_pdf = '';
      let url_loc = '';
      let host_type = '';
      let pdfUrl = '';
      let landingPageUrl = '';
      let htmlUrl = '';
      let xmlUrl = '';

      if (data.best_oa_location) {
        license = data.best_oa_location.license || '';
        url_for_pdf = data.best_oa_location.url_for_pdf || '';
        url_loc = data.best_oa_location.url || '';
        host_type = data.best_oa_location.host_type || '';
      }

      if (Array.isArray(data.oa_locations)) {
        for (const loc of data.oa_locations) {
          if (!loc) continue;
          if (loc.url_for_pdf && !pdfUrl) {
            pdfUrl = loc.url_for_pdf;
          }
          if (loc.url_for_landing_page && !landingPageUrl) {
            landingPageUrl = loc.url_for_landing_page;
          } else if (loc.url && !landingPageUrl && loc.url !== loc.url_for_pdf) {
            landingPageUrl = loc.url;
          }

          const locUrl = loc.url || '';
          if (locUrl) {
            if (locUrl.includes('ncbi.nlm.nih.gov/pmc/articles/PMC') && !htmlUrl) {
              htmlUrl = locUrl;
            } else if (loc.host_type === 'publisher' && !locUrl.toLowerCase().endsWith('.pdf') && !htmlUrl) {
              htmlUrl = locUrl;
            }
            if (locUrl.toLowerCase().endsWith('.xml') && !xmlUrl) {
              xmlUrl = locUrl;
            }
          }
        }
      }

      pdfUrl = pdfUrl || url_for_pdf;
      landingPageUrl = landingPageUrl || url_loc || url_for_pdf;

      return {
        success: true,
        data: {
          is_oa: !!data.is_oa,
          license: license || undefined,
          oa_status: data.oa_status || undefined,
          url_for_pdf: url_for_pdf || undefined,
          url: url_loc || undefined,
          host_type: host_type || undefined,
          pdfUrl: pdfUrl || undefined,
          landingPageUrl: landingPageUrl || undefined,
          htmlUrl: htmlUrl || undefined,
          xmlUrl: xmlUrl || undefined
        }
      };
    }
    return { success: false };
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn('[Unpaywall] Error or timeout querying Unpaywall API:', err.message || err);
    return { success: false };
  }
}
