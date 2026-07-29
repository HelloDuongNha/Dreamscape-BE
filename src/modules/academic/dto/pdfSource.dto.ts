export interface PdfContributionFields {
  title: string;
  authors: string[];
  year?: number;
  journal: string;
  publisher: string;
  submittedNote: string;
}

function parseAuthors(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(item => String(item).trim()).filter(Boolean);
    }
  } catch {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
  return [value.trim()];
}

export function parsePdfContributionFields(body: any): PdfContributionFields {
  const submittedNote = typeof body?.submittedNote === 'string'
    ? body.submittedNote.trim()
    : '';
  if (submittedNote.length > 1000) {
    throw new Error('Ghi chú đóng góp không được vượt quá 1000 ký tự.');
  }

  const parsedYear = Number.parseInt(String(body?.year ?? ''), 10);
  return {
    title: typeof body?.title === 'string' ? body.title.trim() : '',
    authors: parseAuthors(body?.authors),
    year: Number.isFinite(parsedYear) ? parsedYear : undefined,
    journal: typeof body?.journal === 'string' ? body.journal.trim() : '',
    publisher: typeof body?.publisher === 'string' ? body.publisher.trim() : '',
    submittedNote,
  };
}

export function parsePdfImportOptions(body: any) {
  return {
    forceReplace: body?.forceReplace === true,
    structuredFirst: body?.structuredFirst === true,
  };
}

export function parseForceCache(value: unknown): boolean {
  return value === true || value === 'true';
}
