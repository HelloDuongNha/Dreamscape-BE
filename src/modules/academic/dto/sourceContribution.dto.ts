export interface ModerationSourceQuery {
  status: 'pending' | 'approved' | 'rejected';
  page: number;
  limit: number;
}

export type SourceReviewStatus = 'approved' | 'rejected';

export type SourceReviewInput =
  | {
      valid: true;
      reviewStatus: SourceReviewStatus;
      reviewNote: string;
      reviewNoteProvided: boolean;
      title: string;
    }
  | { valid: false; message: string };

export function parseSubmissionNote(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeDocumentTitle(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFC').replace(/\s+/gu, ' ').trim()
    : '';
}

export function parseModerationSourceQuery(query: Record<string, unknown>): ModerationSourceQuery {
  const status = query.status === 'approved' || query.status === 'rejected'
    ? query.status
    : 'pending';
  let page = Number.parseInt(String(query.page ?? ''), 10);
  let limit = Number.parseInt(String(query.limit ?? ''), 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  return { status, page, limit: Math.min(limit, 50) };
}

export function parseSourceReviewInput(body: any): SourceReviewInput {
  if (body?.reviewStatus !== 'approved' && body?.reviewStatus !== 'rejected') {
    return {
      valid: false,
      message: 'Invalid review status. Only "approved" or "rejected" are allowed.',
    };
  }

  const reviewNote = typeof body.reviewNote === 'string' ? body.reviewNote.trim() : '';
  if (reviewNote.length > 1000) {
    return { valid: false, message: 'Review note must not exceed 1000 characters.' };
  }

  const title = normalizeDocumentTitle(body.title);
  if (body.title !== undefined && (title.length < 3 || title.length > 300)) {
    return {
      valid: false,
      message: 'Document title must contain between 3 and 300 characters.',
    };
  }

  return {
    valid: true,
    reviewStatus: body.reviewStatus,
    reviewNote,
    reviewNoteProvided: body.reviewNote !== undefined,
    title,
  };
}
