import mongoose from 'mongoose';
import { resolveSourceImport } from './services/sourceImportResolver.service';
import { collectCandidates } from './services/academic/candidateCollector.service';
import { fetchUrlWithSafeRedirects } from './utils/ssrfGuard';

async function run() {
  const doi = '10.1016/j.concog.2024.103651';
  console.log(`Diagnosing Elsevier DOI: ${doi}`);

  const resolved = await resolveSourceImport({ doi }, new mongoose.Types.ObjectId());
  console.log('Resolved details:', JSON.stringify(resolved, null, 2));

  const dummySource = {
    doi: resolved.doi,
    url: resolved.sourceUrl,
    pdfUrl: resolved.pdfUrl,
    htmlUrl: resolved.htmlUrl,
    title: resolved.title,
    journal: resolved.journal,
    publisher: resolved.publisher
  };

  const candidates = collectCandidates(dummySource);
  console.log(`Collected ${candidates.length} candidates:`);
  candidates.forEach((c, idx) => {
    console.log(`Candidate #${idx}: sourceType=${c.sourceType}, url=${c.url}, contentType=${c.contentType}`);
  });

  for (const cand of candidates) {
    try {
      console.log(`\nFetching candidate: ${cand.url}`);
      const res = await fetchUrlWithSafeRedirects(cand.url);
      console.log(`Fetch success! content-type=${res.contentType}, buffer size=${res.buffer.length}`);
    } catch (err: any) {
      console.error(`Fetch failed for ${cand.url}:`, err.message);
    }
  }

  process.exit(0);
}

run().catch(console.error);
