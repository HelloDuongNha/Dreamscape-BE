import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { DoclingExtractionResult, DoclingArtifactDescriptor } from '../../types/docling.types';
import {
  DOCLING_EXTRACTION_TIMEOUT_MS,
  DOCLING_OCR_TIMEOUT_MS,
} from '../../../../../config/pdfLimits';
import {
  getDoclingPythonBin,
  isDoclingAvailable,
} from './doclingRuntime.service';
import {
  createDoclingRunCleanup,
  createDoclingRunDirectory,
  validateDoclingArtifactPath,
} from './doclingWorkspace.service';

export interface DoclingRunResult {
  result: DoclingExtractionResult;
  artifacts: DoclingArtifactDescriptor[];
  cleanup: () => Promise<void>;
}

export class DoclingClientService {
  public static async isAvailable(): Promise<boolean> {
    return isDoclingAvailable();
  }

  public static async extractPdf(
    pdfPath: string,
    doOcr: boolean = false,
    abortSignal?: AbortSignal,
  ): Promise<DoclingRunResult> {
    const pythonBin = getDoclingPythonBin();
    const noopCleanup = async () => {};

    if (!pythonBin) {
      return {
        result: {
          success: false, title: '', pageCount: 0, items: [],
          duration: 0, ocrUsed: false, warnings: [],
          referenceQualityDegraded: false,
          errorCode: 'DOCLING_UNAVAILABLE',
          errorDetail: 'Docling Python runtime is not configured.',
        },
        artifacts: [],
        cleanup: noopCleanup,
      };
    }

    const scriptPath = path.join(__dirname, 'runtime/docling_parser.py');

    let runDir: string;
    try {
      runDir = createDoclingRunDirectory();
    } catch {
      return {
        result: {
          success: false, title: '', pageCount: 0, items: [],
          duration: 0, ocrUsed: false, warnings: [],
          referenceQualityDegraded: false,
          errorCode: 'DIR_CREATION_FAILED',
          errorDetail: 'Failed to create temporary output directory.',
        },
        artifacts: [],
        cleanup: noopCleanup,
      };
    }

    const cleanup = createDoclingRunCleanup(runDir);

    return new Promise<DoclingRunResult>((resolve) => {
      const bundledArtifactsPath = path.resolve(path.dirname(pythonBin), '..', '..', 'models');
      const configuredArtifactsPath = process.env.DOCLING_ARTIFACTS_PATH?.trim();
      const artifactsPath = configuredArtifactsPath ||
        (fs.existsSync(bundledArtifactsPath) ? bundledArtifactsPath : undefined);
      const pyProcess = spawn(
        pythonBin,
        [scriptPath, pdfPath, runDir, String(doOcr)],
        {
          env: {
            ...process.env,
            ...(artifactsPath ? { DOCLING_ARTIFACTS_PATH: artifactsPath } : {}),
          },
        },
      );
      let stdoutAccum = '';
      let stderrAccum = '';
      let timer: ReturnType<typeof setTimeout> | null = null;

      // Settled guard: only one of timeout / close / error may win
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const fail = async (errorCode: string, errorDetail: string) => {
        await cleanup();
        resolve({
          result: {
            success: false, title: '', pageCount: 0, items: [],
            duration: 0, ocrUsed: false, warnings: [],
            referenceQualityDegraded: false,
            errorCode,
            errorDetail,
          },
          artifacts: [],
          cleanup,
        });
      };

      const abortExtraction = () => {
        settle(async () => {
          if (timer) clearTimeout(timer);
          abortSignal?.removeEventListener('abort', abortExtraction);
          pyProcess.kill('SIGKILL');
          await fail('EXTRACTION_CANCELLED', 'Docling extraction was cancelled.');
        });
      };
      if (abortSignal?.aborted) {
        abortExtraction();
        return;
      }
      abortSignal?.addEventListener('abort', abortExtraction, { once: true });

      // ── Timeout ──────────────────────────────────────────────────────────────
      const extractionTimeoutMs = doOcr
        ? DOCLING_OCR_TIMEOUT_MS
        : DOCLING_EXTRACTION_TIMEOUT_MS;
      timer = setTimeout(() => {
        settle(async () => {
          pyProcess.kill('SIGKILL');
          // Await close before cleaning
          await new Promise<void>((res) => {
            pyProcess.on('close', () => res());
            // Fallback: if close never fires (already exited), resolve shortly
            setTimeout(res, 3000);
          });
          await fail('EXTRACTION_TIMEOUT', 'The Docling extraction timed out.');
        });
      }, extractionTimeoutMs);

      pyProcess.stdout.on('data', (chunk) => {
        // A 500+ page OCR book can legitimately produce more than 10 MB of
        // structured JSON. Keep a bounded but book-sized response allowance.
        if (stdoutAccum.length < 64 * 1024 * 1024) stdoutAccum += chunk.toString();
      });

      pyProcess.stderr.on('data', (chunk) => {
        if (stderrAccum.length < 100 * 1024) stderrAccum += chunk.toString();
      });

      pyProcess.on('error', () => {
        if (timer) clearTimeout(timer);
        settle(async () => {
          await fail('SPAWN_ERROR', 'Failed to start the Docling Python process.');
        });
      });

      // ── Process close ────────────────────────────────────────────────────────
      pyProcess.on('close', (code) => {
        if (timer) clearTimeout(timer);
        abortSignal?.removeEventListener('abort', abortExtraction);
        settle(async () => {
          if (code !== 0) {
            let parsedFailure: DoclingExtractionResult | null = null;
            try {
              const candidate = JSON.parse(stdoutAccum.trim()) as DoclingExtractionResult;
              if (candidate.success === false) parsedFailure = candidate;
            } catch {
              // The safe structured error is optional; stderr is logged below.
            }
            const stderrSummary = stderrAccum
              .split(/\r?\n/)
              .map(line => line.trim())
              .filter(Boolean)
              .slice(-8)
              .join(' | ')
              .slice(0, 2000);
            console.error(
              `[Docling] Extraction failed (${parsedFailure?.errorCode || 'EXTRACTION_FAILED'}).` +
              (stderrSummary ? ` ${stderrSummary}` : ''),
            );
            await cleanup();
            resolve({
              result: parsedFailure || {
                success: false, title: '', pageCount: 0, items: [],
                duration: 0, ocrUsed: doOcr, warnings: [],
                referenceQualityDegraded: false,
                errorCode: 'EXTRACTION_FAILED',
                errorDetail: 'Docling extraction process failed.',
              },
              artifacts: [],
              cleanup,
            });
            return;
          }

          // Parse output
          let parsed: DoclingExtractionResult;
          try {
            parsed = JSON.parse(stdoutAccum.trim());
          } catch {
            await fail('MALFORMED_OUTPUT', 'The extractor returned malformed JSON.');
            return;
          }

          if (!parsed.success) {
            await cleanup();
            resolve({ result: parsed, artifacts: [], cleanup });
            return;
          }

          const realRunDir = path.resolve(runDir);
          const artifacts: import('../../types/docling.types').DoclingArtifactDescriptor[] = [];

          for (const item of parsed.items) {
            if (item.type !== 'figure') continue;

            if (!item.filePath) {
              // region_only — no path expected
              artifacts.push({
                itemId: item.id,
                pageNumber: item.pageNumber,
                bbox: item.bbox,
                figureType: item.figureType ?? 'region_only',
                caption: item.caption,
              });
              continue;
            }

            const validReal = validateDoclingArtifactPath(realRunDir, item.filePath);
            if (!validReal) {
              await fail('ARTIFACT_INVALID', 'An extracted image artifact failed validation.');
              return;
            }

            artifacts.push({
              itemId: item.id,
              filePath: validReal,
              fileName: item.fileName,
              format: item.format,
              width: item.width,
              height: item.height,
              pageNumber: item.pageNumber,
              bbox: item.bbox,
              figureType: item.figureType ?? 'embedded',
              caption: item.caption,
            });
          }

          resolve({ result: parsed, artifacts, cleanup });
        });
      });
    });
  }
}
