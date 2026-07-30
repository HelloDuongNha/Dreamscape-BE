import fs from 'fs';
import path from 'path';
import { getDoclingTempBase } from './doclingRuntime.service';

export function createDoclingRunDirectory(): string {
  const configuredTempBase = path.resolve(getDoclingTempBase());
  fs.mkdirSync(configuredTempBase, { recursive: true, mode: 0o700 });
  const realTempBase = fs.realpathSync(configuredTempBase);
  return fs.mkdtempSync(path.join(realTempBase, 'docling-'));
}

// Accept only regular image files physically contained by this run directory.
export function validateDoclingArtifactPath(runDir: string, artifactPath: string): string | null {
  let realArtifact: string;
  try {
    realArtifact = fs.realpathSync(artifactPath);
  } catch {
    return null;
  }

  let realRunDir: string;
  try {
    realRunDir = fs.realpathSync(runDir);
  } catch {
    return null;
  }
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
  const configuredTempBase = path.resolve(getDoclingTempBase());

  return async () => {
    if (cleaned) return;
    cleaned = true;

    try {
      const realTempBase = fs.realpathSync(configuredTempBase);
      const realRunDir = fs.realpathSync(runDir);
      const relativePath = path.relative(realTempBase, realRunDir);
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return;
      if (realRunDir === realTempBase || realRunDir === path.dirname(realTempBase)) return;
      await fs.promises.rm(realRunDir, { recursive: true, force: true });
    } catch {
      // The directory may already have been removed.
    }
  };
}
