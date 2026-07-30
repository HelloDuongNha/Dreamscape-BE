import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DOCLING_EXTRACTION_TIMEOUT_MS, DOCLING_OCR_TIMEOUT_MS } from '../../../../../config/pdfLimits';
import { DoclingArtifactDescriptor, DoclingExtractionResult } from '../../types/docling.types';
import type { PdfTextLayerProbeResult } from '../pdf/pdfTextLayerProbe.service';
import type { RawPdfParserOutput } from '../pdf/legacy/PdfParser';
import {
  createDoclingRunCleanup,
  createDoclingRunDirectory,
  validateDoclingArtifactPath,
} from './doclingWorkspace.service';

interface RemoteArtifact extends Omit<DoclingArtifactDescriptor, 'filePath'> {
  artifactId?: string;
}

interface RemoteExtractionResponse {
  result: DoclingExtractionResult;
  artifacts: RemoteArtifact[];
}

interface RemotePdfInspectionResponse {
  probe: PdfTextLayerProbeResult;
  parsedPdf?: RawPdfParserOutput;
}

export interface RemoteDoclingRunResult {
  result: DoclingExtractionResult;
  artifacts: DoclingArtifactDescriptor[];
  cleanup: () => Promise<void>;
}

export function hasRemoteDoclingConfiguration(): boolean {
  return Boolean(getRemoteUrl() && getRemoteToken());
}

export async function probeRemoteDocling(): Promise<boolean> {
  const url = getRemoteUrl();
  const token = getRemoteToken();
  if (!url || !token) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${url}/health`, {
      headers: {
        authorization: `Bearer ${token}`,
        'ngrok-skip-browser-warning': 'true',
      },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function inspectPdfRemotely(
  pdfPath: string,
  abortSignal?: AbortSignal,
): Promise<RemotePdfInspectionResponse> {
  const url = getRemoteUrl();
  const token = getRemoteToken();
  if (!url || !token) throw new Error('Remote Docling worker is not configured.');

  const controller = new AbortController();
  const abort = () => controller.abort();
  abortSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 90_000);

  try {
    const fileSize = (await fs.promises.stat(pdfPath)).size;
    const response = await fetch(`${url}/inspect`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/pdf',
        'content-length': String(fileSize),
        'ngrok-skip-browser-warning': 'true',
      },
      body: fs.createReadStream(pdfPath) as any,
      signal: controller.signal,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const payload = await response.json().catch(() => null) as (
      RemotePdfInspectionResponse & { detail?: string; error?: string }
    ) | null;
    if (!response.ok || !payload?.probe) {
      throw new Error(
        payload?.detail
        || payload?.error
        || `Remote PDF inspection returned HTTP ${response.status}.`,
      );
    }
    return payload;
  } finally {
    clearTimeout(timer);
    abortSignal?.removeEventListener('abort', abort);
  }
}

export async function extractPdfRemotely(
  pdfPath: string,
  doOcr: boolean,
  abortSignal?: AbortSignal,
): Promise<RemoteDoclingRunResult> {
  const url = getRemoteUrl();
  const token = getRemoteToken();
  if (!url || !token) return unavailableResult();

  const runDir = createDoclingRunDirectory();
  const localCleanup = createDoclingRunCleanup(runDir);
  let cleanupCompleted = false;
  const cleanup = async () => {
    if (cleanupCompleted) return;
    cleanupCompleted = true;
    await localCleanup();
    await requestRemoteRunCleanup(url, token, requestId);
  };
  const controller = new AbortController();
  const requestId = crypto.randomUUID();
  const abort = () => {
    controller.abort();
    void requestRemoteCancellation(url, token, requestId);
  };
  abortSignal?.addEventListener('abort', abort, { once: true });
  const timeoutMs = doOcr ? DOCLING_OCR_TIMEOUT_MS : DOCLING_EXTRACTION_TIMEOUT_MS;
  const timer = setTimeout(abort, timeoutMs);

  try {
    const fileSize = (await fs.promises.stat(pdfPath)).size;
    const response = await fetch(`${url}/extract`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/pdf',
        'content-length': String(fileSize),
        'ngrok-skip-browser-warning': 'true',
        'x-docling-ocr': doOcr ? 'true' : 'false',
        'x-docling-request-id': requestId,
      },
      body: fs.createReadStream(pdfPath) as any,
      signal: controller.signal,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    if (!response.ok) {
      return failureResult(
        cleanup,
        'DOCLING_REMOTE_FAILED',
        `Remote Docling worker returned HTTP ${response.status}.`,
      );
    }

    const payload = await response.json() as RemoteExtractionResponse;
    if (!payload?.result || !Array.isArray(payload.artifacts)) {
      return failureResult(cleanup, 'MALFORMED_OUTPUT', 'Remote Docling response is invalid.');
    }
    if (!payload.result.success) {
      await cleanup();
      return { result: payload.result, artifacts: [], cleanup };
    }

    const artifacts = await materializeArtifacts(
      runDir,
      payload.artifacts,
      url,
      token,
      requestId,
      controller.signal,
    );
    const pathsByItem = new Map(
      artifacts.filter(item => item.filePath).map(item => [item.itemId, item.filePath]),
    );
    for (const item of payload.result.items) {
      const localPath = pathsByItem.get(item.id);
      if (localPath) item.filePath = localPath;
      else delete item.filePath;
    }
    return { result: payload.result, artifacts, cleanup };
  } catch (error) {
    const cancelled = abortSignal?.aborted;
    return failureResult(
      cleanup,
      cancelled ? 'EXTRACTION_CANCELLED' : 'DOCLING_REMOTE_UNAVAILABLE',
      cancelled
        ? 'Docling extraction was cancelled.'
        : error instanceof Error ? error.message : 'Remote Docling worker is unavailable.',
    );
  } finally {
    clearTimeout(timer);
    abortSignal?.removeEventListener('abort', abort);
  }
}

async function requestRemoteCancellation(
  url: string,
  token: string,
  requestId: string,
): Promise<void> {
  try {
    await fetch(`${url}/extract/${encodeURIComponent(requestId)}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
        'ngrok-skip-browser-warning': 'true',
      },
    });
  } catch {
    // The original extraction still settles locally through its aborted fetch.
  }
}

async function materializeArtifacts(
  runDir: string,
  remoteArtifacts: RemoteArtifact[],
  url: string,
  token: string,
  requestId: string,
  signal: AbortSignal,
): Promise<DoclingArtifactDescriptor[]> {
  const artifacts: DoclingArtifactDescriptor[] = [];
  for (const remote of remoteArtifacts) {
    if (!remote.artifactId) {
      artifacts.push({ ...remote });
      continue;
    }

    const extension = safeExtension(remote.fileName, remote.format);
    const fileName = `${safeItemId(remote.itemId)}${extension}`;
    const filePath = path.join(runDir, fileName);
    const response = await fetch(
      `${url}/artifacts/${encodeURIComponent(requestId)}/${encodeURIComponent(remote.artifactId)}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          'ngrok-skip-browser-warning': 'true',
        },
        signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Remote Docling artifact returned HTTP ${response.status}.`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.promises.writeFile(filePath, buffer, { mode: 0o600 });
    const validatedPath = validateDoclingArtifactPath(path.resolve(runDir), filePath);
    if (!validatedPath) throw new Error('Remote Docling artifact path is invalid.');
    const { artifactId: _artifactId, ...descriptor } = remote;
    artifacts.push({ ...descriptor, fileName, filePath: validatedPath });
  }
  return artifacts;
}

async function requestRemoteRunCleanup(
  url: string,
  token: string,
  requestId: string,
): Promise<void> {
  try {
    await fetch(`${url}/runs/${encodeURIComponent(requestId)}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
        'ngrok-skip-browser-warning': 'true',
      },
    });
  } catch {
    // Worker TTL cleanup remains the final safety net.
  }
}

function safeItemId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'artifact';
}

function safeExtension(fileName?: string, format?: string): string {
  const candidate = path.extname(fileName || '').toLowerCase();
  if (/^\.[a-z0-9]{1,5}$/.test(candidate)) return candidate;
  const safeFormat = (format || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `.${safeFormat || 'png'}`;
}

function getRemoteUrl(): string | null {
  const value = process.env.DOCLING_WORKER_URL?.trim().replace(/\/+$/, '');
  return value || null;
}

function getRemoteToken(): string | null {
  return process.env.DOCLING_WORKER_TOKEN?.trim() || null;
}

function unavailableResult(): RemoteDoclingRunResult {
  const cleanup = async () => {};
  return {
    result: failure('DOCLING_UNAVAILABLE', 'Remote Docling worker is not configured.'),
    artifacts: [],
    cleanup,
  };
}

async function failureResult(
  cleanup: () => Promise<void>,
  code: string,
  detail: string,
): Promise<RemoteDoclingRunResult> {
  await cleanup();
  return { result: failure(code, detail), artifacts: [], cleanup };
}

function failure(errorCode: string, errorDetail: string): DoclingExtractionResult {
  return {
    success: false,
    title: '',
    pageCount: 0,
    items: [],
    duration: 0,
    ocrUsed: false,
    warnings: [],
    referenceQualityDegraded: false,
    errorCode,
    errorDetail,
  };
}
