import mongoose from 'mongoose';
import {
  isValidDoi,
  normalizeDoi,
} from '../services/source/openAccess.service';

export interface ApprovedSourceCatalogQuery {
  q: string;
  doi: string | null;
  validationError: 'invalid_doi' | null;
  page: number;
  limit: number;
}

export interface ApprovedSourceReaderQuery {
  page: number;
  limit: number;
}

export function parseApprovedSourceId(value: unknown): string | null {
  return typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)
    ? value
    : null;
}

export function parseApprovedSourceCatalogQuery(query: Record<string, unknown>): ApprovedSourceCatalogQuery {
  const q = typeof query.q === 'string' ? query.q : '';
  const rawDoi = typeof query.doi === 'string' ? query.doi.trim() : '';
  const doi = rawDoi && isValidDoi(rawDoi) ? normalizeDoi(rawDoi) : null;
  let page = Number.parseInt(String(query.page ?? ''), 10);
  let limit = Number.parseInt(String(query.limit ?? ''), 10);

  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 12;

  return {
    q: q.trim().slice(0, 100),
    doi,
    validationError: rawDoi && !doi ? 'invalid_doi' : null,
    page,
    limit: Math.min(limit, 50),
  };
}

export function parseApprovedSourceReaderQuery(query: Record<string, unknown>): ApprovedSourceReaderQuery {
  let page = Number.parseInt(String(query.page ?? '1'), 10);
  let limit = Number.parseInt(String(query.limit ?? '20'), 10);

  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 20;

  return {
    page,
    limit: Math.min(limit, 50),
  };
}
