import { fetchUrlWithSafeRedirects } from '../../../../../infrastructure/security/ssrfGuard';
import { resolvePmcArchiveImages } from './pmcImageArchive.service';

export interface ReaderPmcContext {
  resolvedPmcid?: string;
  imageMap?: Map<string, string>;
  archivePublicIds: string[];
  publicIdByUrl: Map<string, string>;
  candidateSource: any;
}

async function resolvePmcid(source: any): Promise<string | undefined> {
  if (source.pmcid) return source.pmcid;
  if (!source.doi) return undefined;

  try {
    console.log(`[PMC Resolver] Resolving PMCID for DOI: ${source.doi}`);
    const url = `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${encodeURIComponent(source.doi)}&format=json&tool=dreamscape&email=admin@dreamscape.io`;
    const response = await fetch(url);
    if (!response.ok) return undefined;

    const data = await response.json() as any;
    const pmcid = data.records?.[0]?.pmcid;
    if (!pmcid) return undefined;

    console.log(`[PMC Resolver] Resolved PMCID: ${pmcid} for DOI: ${source.doi}`);
    const normalizedPmcid = pmcid.toUpperCase();
    const model = source.constructor;
    const duplicate = model?.exists
      ? await model.exists({ _id: { $ne: source._id }, normalizedPmcid })
      : null;
    if (!duplicate) {
      source.pmcid = pmcid;
      source.normalizedPmcid = normalizedPmcid;
    } else {
      console.warn('[PMC Resolver] Resolved PMCID belongs to another source; using it transiently without persisting it.');
    }
    return normalizedPmcid;
  } catch (error: any) {
    console.warn(`[PMC Resolver] PMCID conversion failed for DOI ${source.doi}:`, error.message);
    return undefined;
  }
}

async function fetchPmcImageMap(
  pmcid: string,
  archivePublicIds: string[],
  publicIdByUrl: Map<string, string>,
): Promise<Map<string, string>> {
  const imageMap = new Map<string, string>();
  const cleanId = pmcid.toUpperCase().startsWith('PMC') ? pmcid : `PMC${pmcid}`;

  try {
    console.log(`[PMC Image Resolver] Fetching PMC page for image mapping: ${cleanId}`);
    const response = await fetchUrlWithSafeRedirects(
      `https://pmc.ncbi.nlm.nih.gov/articles/${cleanId}/`,
    );
    if (response?.buffer) {
      const html = response.buffer.toString('utf8');
      const pattern = /(?:https?:)?\/\/cdn\.ncbi\.nlm\.nih\.gov\/pmc\/blobs\/[^\s"'`>]+/gi;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(html)) !== null) {
        const fullUrl = match[0].startsWith('//') ? `https:${match[0]}` : match[0];
        const filename = fullUrl.split('/').pop();
        if (!filename) continue;
        imageMap.set(filename.toLowerCase(), fullUrl);
        imageMap.set(filename.replace(/\.[a-zA-Z0-9]+$/, '').toLowerCase(), fullUrl);
      }
      console.log(`[PMC Image Resolver] Resolved ${imageMap.size} image mappings from PMC page.`);
    }
  } catch (error: any) {
    console.warn(`[PMC Image Resolver] Failed to resolve image mappings for ${pmcid}: ${error.message}`);
  }

  try {
    const archive = await resolvePmcArchiveImages(pmcid);
    archive.imageMap.forEach((ownedUrl, key) => imageMap.set(key, ownedUrl));
    archive.publicIdByUrl.forEach((publicId, url) => publicIdByUrl.set(url, publicId));
    archivePublicIds.push(...archive.uploadedPublicIds);
    console.log(`[PMC Image Resolver] Merged ${archive.uploadedPublicIds.length} owned archive images from Europe PMC.`);
  } catch (error: any) {
    console.warn(`[PMC Image Resolver] Europe PMC archive recovery failed for ${pmcid}: ${error.message}. Using available page mappings.`);
  }

  return imageMap;
}

export async function prepareReaderPmcContext(source: any): Promise<ReaderPmcContext> {
  const resolvedPmcid = await resolvePmcid(source);
  const archivePublicIds: string[] = [];
  const publicIdByUrl = new Map<string, string>();
  const imageMap = resolvedPmcid
    ? await fetchPmcImageMap(resolvedPmcid, archivePublicIds, publicIdByUrl)
    : undefined;
  const candidateSource = resolvedPmcid && !source.pmcid
    ? { ...(typeof source.toObject === 'function' ? source.toObject() : source), pmcid: resolvedPmcid }
    : source;

  return {
    resolvedPmcid,
    imageMap,
    archivePublicIds,
    publicIdByUrl,
    candidateSource,
  };
}
