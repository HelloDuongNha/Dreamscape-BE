import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { DoclingExtractionResult } from './types/docling.types';
import { DoclingArtifactDescriptor } from './doclingAdapter.service';

// ─── Internal run result returned by extractPdf ───────────────────────────────
export interface DoclingRunResult {
  result: DoclingExtractionResult;
  /** Verified artifact descriptors, empty on failure */
  artifacts: DoclingArtifactDescriptor[];
  /**
   * Idempotent cleanup: removes the exact run directory created by this
   * invocation. Safe to call multiple times. Never deletes outside the
   * configured temp base or another run's directory.
   */
  cleanup: () => Promise<void>;
}

export class DoclingClientService {
  private static getPythonBin(): string | null {
    return process.env.DOCLING_PYTHON_BIN || null;
  }

  private static getTempBase(): string {
    return process.env.DOCLING_TEMP_DIR || os.tmpdir();
  }

  // ─── Availability check ──────────────────────────────────────────────────────
  /**
   * Returns true only when DOCLING_PYTHON_BIN points to an executable that can
   * import the pinned docling package at runtime.
   */
  private static availabilityCache: { val: boolean; exp: number } | null = null;

  public static async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (this.availabilityCache && now < this.availabilityCache.exp) {
      return this.availabilityCache.val;
    }

    const pythonBin = this.getPythonBin();
    if (!pythonBin) {
      this.availabilityCache = { val: false, exp: now + 5 * 60 * 1000 };
      return false;
    }
    try {
      await fs.promises.access(pythonBin, fs.constants.X_OK);
    } catch {
      this.availabilityCache = { val: false, exp: now + 5 * 60 * 1000 };
      return false;
    }

    const result = await new Promise<boolean>((resolve) => {
      const probe = spawn(pythonBin, ['-c', 'import docling']);
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          probe.kill('SIGKILL');
          resolve(false);
        }
      }, 5000); // 5 seconds bounded timeout

      probe.on('error', () => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      probe.on('close', (code) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          resolve(code === 0);
        }
      });
    });

    this.availabilityCache = { val: result, exp: now + 5 * 60 * 1000 };
    return result;
  }

  // ─── Path containment helpers ─────────────────────────────────────────────────
  /**
   * Validates that realArtifactPath is strictly inside realRunDir.
   * Rejects: escape via '..', absolute relative path, empty relative path,
   * symbolic links, prefix-collision attacks.
   */
  private static validateArtifactPath(realRunDir: string, artifactPath: string): string | null {
    // Resolve real path of artifact — this resolves symlinks
    let realArtifact: string;
    try {
      realArtifact = fs.realpathSync(artifactPath);
    } catch {
      return null; // path does not exist or cannot be resolved
    }

    const rel = path.relative(realRunDir, realArtifact);

    // Reject if empty (same as parent), starts with '..', or is absolute
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;

    // Reject symbolic links (realpathSync already resolved them; check lstat)
    try {
      const lstat = fs.lstatSync(artifactPath);
      if (lstat.isSymbolicLink()) return null;
    } catch {
      return null;
    }

    // Must be a regular non-empty file
    try {
      const stat = fs.statSync(realArtifact);
      if (!stat.isFile() || stat.size === 0) return null;
    } catch {
      return null;
    }

    // Must have a supported extension
    const ext = path.extname(realArtifact).toLowerCase();
    if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') return null;

    return realArtifact;
  }

  // ─── Cleanup factory ──────────────────────────────────────────────────────────
  /**
   * Returns an idempotent cleanup function bound to exactRunDir.
   * Will refuse to delete the temp base itself, its parent, or any path that
   * is no longer inside the configured temp base.
   */
  private static makeCleanup(exactRunDir: string): () => Promise<void> {
    let cleaned = false;
    const tempBase = path.resolve(this.getTempBase());

    return async () => {
      if (cleaned) return;
      cleaned = true;

      try {
        const realDir = fs.realpathSync(exactRunDir);
        const relToBase = path.relative(tempBase, realDir);

        // Refuse if the captured dir escapes the temp base or equals it
        if (!relToBase || relToBase.startsWith('..') || path.isAbsolute(relToBase)) return;
        if (realDir === tempBase || realDir === path.dirname(tempBase)) return;

        await fs.promises.rm(realDir, { recursive: true, force: true });
      } catch {
        // Directory may already be gone — ignore
      }
    };
  }

  // ─── PDF extraction ───────────────────────────────────────────────────────────
  public static async extractPdf(
    pdfPath: string,
    doOcr: boolean = false,
  ): Promise<DoclingRunResult> {
    const pythonBin = this.getPythonBin();
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

    const scriptPath = path.join(__dirname, '../../utils/python/docling_parser.py');

    let runDir: string;
    try {
      const tempBase = this.getTempBase();
      runDir = fs.mkdtempSync(path.join(tempBase, 'docling-'));
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

    const cleanup = this.makeCleanup(runDir);

    return new Promise<DoclingRunResult>((resolve) => {
      const pyProcess = spawn(pythonBin, [scriptPath, pdfPath, runDir, String(doOcr)]);
      let stdoutAccum = '';
      let stderrAccum = '';

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

      // ── Timeout ──────────────────────────────────────────────────────────────
      const timer = setTimeout(() => {
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
      }, 120000);

      pyProcess.stdout.on('data', (chunk) => {
        if (stdoutAccum.length < 10 * 1024 * 1024) stdoutAccum += chunk.toString();
      });

      pyProcess.stderr.on('data', (chunk) => {
        if (stderrAccum.length < 100 * 1024) stderrAccum += chunk.toString();
      });

      pyProcess.on('error', () => {
        clearTimeout(timer);
        settle(async () => {
          await fail('SPAWN_ERROR', 'Failed to start the Docling Python process.');
        });
      });

      // ── Process close ────────────────────────────────────────────────────────
      pyProcess.on('close', (code) => {
        clearTimeout(timer);
        settle(async () => {
          if (code !== 0) {
            await fail('EXTRACTION_FAILED', 'Docling extraction process failed.');
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

          // Validate all artifact paths
          const realRunDir = path.resolve(runDir);
          const artifacts: import('./doclingAdapter.service').DoclingArtifactDescriptor[] = [];

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

            const validReal = this.validateArtifactPath(realRunDir, item.filePath);
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
