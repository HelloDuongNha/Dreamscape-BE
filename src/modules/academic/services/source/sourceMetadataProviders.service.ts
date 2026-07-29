const USER_AGENT = 'DreamScapeAcademicBot/1.0 (mailto:dreamscape.app.service@gmail.com)';

export async function fetchCrossrefMetadata(doi: string): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal },
    );
    clearTimeout(timeoutId);
    if (response.status === 404) return { success: false, errorType: 'not_found' };
    if (!response.ok) return { success: false, errorType: 'network_error' };

    const data = await response.json() as any;
    if (data.status !== 'ok' || !data.message) {
      return { success: false, errorType: 'not_found' };
    }

    const message = data.message;
    const title = Array.isArray(message.title) && message.title.length > 0
      ? message.title[0]
      : message.title || 'Không có tiêu đề';
    const authors = Array.isArray(message.author)
      ? message.author
          .map((author: any) => `${author.given || ''} ${author.family || ''}`.trim())
          .filter(Boolean)
      : [];
    let year: number | null = null;
    if (message.published?.['date-parts']?.[0]) {
      year = message.published['date-parts'][0][0] || null;
    } else if (message.created?.['date-parts']?.[0]) {
      year = message.created['date-parts'][0][0] || null;
    }
    const journal = Array.isArray(message['container-title']) && message['container-title'].length > 0
      ? message['container-title'][0]
      : message['container-title'] || '';

    return {
      success: true,
      metadata: {
        title,
        authors,
        year,
        journal,
        publisher: message.publisher || '',
        doi: message.DOI || doi,
        url: message.URL || `https://doi.org/${doi}`,
      },
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    console.error('Error querying Crossref API:', error.message || error);
    return {
      success: false,
      errorType: error.name === 'AbortError' ? 'timeout' : 'network_error',
    };
  }
}

export async function fetchEuropePmcMetadata(pmcid: string): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(pmcid)}&format=json&resultType=core`,
      { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal },
    );
    clearTimeout(timeoutId);
    if (!response.ok) return null;

    const data = await response.json() as any;
    const result = data?.hitCount > 0 ? data.resultList?.result?.[0] : null;
    if (!result) return null;
    return {
      title: result.title || 'Không có tiêu đề',
      authors: Array.isArray(result.authorList?.author)
        ? result.authorList.author
            .map((author: any) => `${author.firstName || ''} ${author.lastName || ''}`.trim())
            .filter(Boolean)
        : [],
      year: result.journalInfo?.yearOfPublication
        || (result.pubYear ? parseInt(result.pubYear, 10) : undefined),
      journal: result.journalInfo?.journal?.title || '',
      publisher: 'PMC',
      pmcid: result.pmcid || pmcid,
      doi: result.doi || undefined,
      abstract: result.abstractText || undefined,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    console.warn('[EuropePMC] Failed to fetch PMC metadata:', error.message || error);
    return null;
  }
}

function parsePublicationYear(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/\b\d{4}\b/);
  return match ? parseInt(match[0], 10) : undefined;
}

export async function fetchIsbnMetadata(isbn: string): Promise<any> {
  const cleanIsbn = isbn.replace(/[^0-9Xx]/g, '').trim();
  if (!cleanIsbn) return null;

  try {
    const response = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(cleanIsbn)}`,
    );
    if (response.ok) {
      const data = await response.json() as any;
      const info = data.items?.[0]?.volumeInfo;
      if (info) {
        return {
          title: info.title || '',
          authors: Array.isArray(info.authors) ? info.authors : [],
          year: parsePublicationYear(info.publishedDate),
          publisher: info.publisher || '',
          isbn: cleanIsbn,
          metadataProvider: 'google_books',
        };
      }
    }
  } catch (error: any) {
    console.warn('[Google Books API] Failed to fetch metadata:', error.message || error);
  }

  try {
    const response = await fetch(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(cleanIsbn)}&format=json&jscmd=data`,
    );
    if (response.ok) {
      const data = await response.json() as any;
      const info = data[`ISBN:${cleanIsbn}`];
      if (info) {
        return {
          title: info.title || '',
          authors: Array.isArray(info.authors)
            ? info.authors.map((author: any) => author.name)
            : [],
          year: parsePublicationYear(info.publish_date),
          publisher: info.publishers?.[0]?.name || '',
          isbn: cleanIsbn,
          metadataProvider: 'open_library',
        };
      }
    }
  } catch (error: any) {
    console.warn('[Open Library API] Failed to fetch metadata:', error.message || error);
  }
  return null;
}
