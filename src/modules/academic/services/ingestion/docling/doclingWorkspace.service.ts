import fs from 'fs';
import path from 'path';
import { getDoclingTempBase } from './doclingRuntime.service';

export function createDoclingRunDirectory(): string {
  return fs.mkdtempSync(path.join(getDoclingTempBase(), 'docling-'));
}

// Accept only regular image files physically contained by this run directory.
export function validateDoclingArtifactPath(runDir: string, artifactPath: string): string | null {
  let realArtifact: string;
  try {
    realArtifact = fs.realpathSync(artifactPath);
  } catch {
    return null;
  }

  const realRunDir = path.resolve(runDir);
  const relativePath = path.relative(realRunDir, realArtifact);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;

  try {
    const linkInfo = fs.lstatSync(artifactPath);
    const fileInfo = fs.statSync(realArtifact);
    if (linkInfo.isSymbolicLink() || !fileInfo.isFile() || fileInfo.size === 0) return null;
  } catch {
    return null;
  }

  const extension = path.extname(realArtifact).toLowerCase();
  return ['.png', '.jpg', '.jpeg'].includes(extension) ? realArtifact : null;
}

// Cleanup is idempotent and refuses to remove the configured temp root.
export function createDoclingRunCleanup(runDir: string): () => Promise<void> {
  let cleaned = false;
  const tempBase = path.resolve(getDoclingTempBase());

  return async () => {
    if (cleaned) return;
    cleaned = true;

    try {
      const realRunDir = fs.realpathSync(runDir);
      const relativePath = path.relative(tempBase, realRunDir);
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return;
      if (realRunDir === tempBase || realRunDir === path.dirname(tempBase)) return;
      await fs.promises.rm(realRunDir, { recursive: true, force: true });
    } catch {
      // The directory may already have been removed.
    }
  };
}
