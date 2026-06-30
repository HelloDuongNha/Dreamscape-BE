import { fetchUrlWithSafeRedirects } from './utils/ssrfGuard';
import * as cheerio from 'cheerio';

async function run() {
  const url = 'https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2016.00332/full';
  console.log(`Fetching: ${url}`);
  try {
    const { buffer } = await fetchUrlWithSafeRedirects(url);
    const html = buffer.toString('utf-8');
    const $ = cheerio.load(html);

    console.log('--- Searching for Pubmed Abstract context ---');
    const pubmedLinks = $('a:contains("Pubmed Abstract")');
    console.log(`Found ${pubmedLinks.length} anchors containing "Pubmed Abstract"`);
    if (pubmedLinks.length > 0) {
      const firstLink = pubmedLinks.first();
      console.log('Link details:', firstLink.attr('href'));
      
      // Let's print the ancestors of this link
      console.log('Ancestors:');
      let parent = firstLink.parent();
      for (let i = 0; i < 5; i++) {
        if (!parent.length) break;
        console.log(`Parent #${i}: tag=${parent[0].tagName}, class="${parent.attr('class') || ''}", id="${parent.attr('id') || ''}"`);
        parent = parent.parent();
      }
    }
  } catch (err: any) {
    console.error('Error:', err);
  }
  process.exit(0);
}

run();
