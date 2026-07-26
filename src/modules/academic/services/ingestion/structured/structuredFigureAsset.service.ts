import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fetchUrlWithSafeRedirects } from '../../../infrastructure/security/ssrfGuard';
import { uploadDocumentImage } from '../../../storage/cloudinaryStorage.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FigureMaterializeResult {
  cloudinarySecureUrl: string;
  cloudinaryPublicId: string;
}

/**
 * Per-import-run deduplication: maps source URL → owned Cloudinary result.
 * Create once per importSmartReaderForSource call and pass to every
 * materializeStructuredFigure invocation.
 */
export type FigureMaterializeCache = Map<string, FigureMaterializeResult | null>;

export function createFigureMaterializeCache(): FigureMaterializeCache {
  return new Map();
}

// ─── Byte-level image validation ──────────────────────────────────────────────

function isSvgContent(buffer: Buffer): boolean {
  const head = buffer.toString('utf8', 0, Math.min(buffer.length, 512)).trim().toLowerCase();
  return (
    head.includes('<svg') &&
    !head.includes('<html') &&
    !head.includes('<body') &&
    !head.includes('<!doctype html')
  );
}

function isSupportedImageBuffer(buffer: Buffer, contentType: string): boolean {
  if (!buffer || buffer.length < 4) return false;

  // PNG: 89 50 4e 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
  // JPEG: ff d8 ff
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  // GIF87a / GIF89a
  if (buffer.length >= 6) {
    const sig6 = buffer.toString('ascii', 0, 6);
    if (sig6 === 'GIF89a' || sig6 === 'GIF87a') return true;
  }
  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) return true;

  // SVG: accept text/xml, application/xml, application/octet-stream, or absent content-type
  const ct = contentType.toLowerCase();
  if (
    ct.includes('svg') ||
    ct === 'application/xml' ||
    ct === 'text/xml' ||
    ct === 'text/plain' ||
    ct === 'application/octet-stream' ||
    ct === ''
  ) {
    if (isSvgContent(buffer)) return true;
  }

  return false;
}

function rejectHtmlOrJsonResponse(buffer: Buffer, contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('html') || ct.includes('json')) {
    // SVG served as application/xml is allowed through
    if ((ct.includes('xml') || ct.includes('svg')) && isSvgContent(buffer)) return false;
    return true;
  }
  return false;
}

function deriveExtensionFromMagicBytes(buffer: Buffer, contentType: string): string {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return '.png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return '.jpg';
  if (buffer.length >= 6) {
    const sig6 = buffer.toString('ascii', 0, 6);
    if (sig6 === 'GIF89a' || sig6 === 'GIF87a') return '.gif';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  if (isSvgContent(buffer)) return '.svg';
  // Content-Type fallback (only used when magic bytes are inconclusive)
  const ct = contentType.toLowerCase();
  if (ct.includes('png')) return '.png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  if (ct.includes('gif')) return '.gif';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('svg')) return '.svg';
  return ''; // no known extension — caller rejects
}

// ─── Core materializer ────────────────────────────────────────────────────────

const MAX_FIGURE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Downloads a verified external figure URL through the SSRF-safe redirect path,
 * validates supported image bytes, writes a secure temp file, uploads to
 * Cloudinary academic_assets, and returns the owned secure URL + public ID.
 *
 * Deduplicates by source URL within the same import run via `cache`.
 * Unconditionally removes all temp files in success and failure.
 *
 * Does NOT:
 * - access MongoDB
 * - persist reader chunks
 * - select parsers
 * - mutate SourceContribution or AcademicSource
 * - log image buffers or secrets
 */
export async function materializeStructuredFigure(
  sourceUrl: string,
  cache: FigureMaterializeCache,
  publicIdPrefix: string
): Promise<FigureMaterializeResult | null> {
  const trimmed = (sourceUrl || '').trim();
  if (!trimmed) return null;

  // Deduplication: return cached result (including cached null for already-failed URLs)
  if (cache.has(trimmed)) {
    return cache.get(trimmed) ?? null;
  }

  let tempPath = '';
  try {
    // 1. SSRF-safe download
    const res = await fetchUrlWithSafeRedirects(trimmed);
    if (!res || !res.buffer || res.buffer.length === 0) {
      cache.set(trimmed, null);
      return null;
    }

    const contentType = (res.contentType || '').toLowerCase();
    const buffer: Buffer = res.buffer;

    // 2. Reject HTML error pages and JSON responses
    if (rejectHtmlOrJsonResponse(buffer, contentType)) {
      cache.set(trimmed, null);
      return null;
    }

    // 3. Byte-level image validation
    if (!isSupportedImageBuffer(buffer, contentType)) {
      cache.set(trimmed, null);
      return null;
    }

    // 4. Size guard
    if (buffer.length > MAX_FIGURE_BYTES) {
      cache.set(trimmed, null);
      return null;
    }

    // 5. Derive safe extension from magic bytes (not from URL suffix or Content-Type alone)
    const ext = deriveExtensionFromMagicBytes(buffer, contentType);
    if (!ext) {
      // Unknown binary format — not browser-safe; retain caption-only fallback
      cache.set(trimmed, null);
      return null;
    }

    // 6. Write secure temp file (mode 0600, random name, OS tmpdir)
    const uniqueId = crypto.randomUUID();
    tempPath = path.join(os.tmpdir(), `structured-fig-${uniqueId}${ext}`);
    fs.writeFileSync(tempPath, buffer, { mode: 0o600 });

    // 7. Upload to Cloudinary via existing uploadDocumentImage
    const publicId = `${publicIdPrefix}/${uniqueId}`;
    const uploaded = await uploadDocumentImage(tempPath, publicId);

    const result: FigureMaterializeResult = {
      cloudinarySecureUrl: uploaded.secure_url,
      cloudinaryPublicId: uploaded.public_id,
    };

    cache.set(trimmed, result);
    return result;

  } catch {
    // Any failure (SSRF block, network, Cloudinary) → caption-only fallback
    cache.set(trimmed, null);
    return null;
  } finally {
    // Unconditional temp cleanup — both success and failure paths
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch { /* ignore cleanup errors */ }
    }
  }
}
