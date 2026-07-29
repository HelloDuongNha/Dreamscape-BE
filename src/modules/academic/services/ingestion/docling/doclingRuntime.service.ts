import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';

let availabilityCache: { value: boolean; expiresAt: number } | null = null;

export function getDoclingPythonBin(): string | null {
  return process.env.DOCLING_PYTHON_BIN || null;
}

export function getDoclingTempBase(): string {
  return process.env.DOCLING_TEMP_DIR || os.tmpdir();
}

// Check the configured Python runtime once per five-minute window.
export async function isDoclingAvailable(): Promise<boolean> {
  const now = Date.now();
  if (availabilityCache && now < availabilityCache.expiresAt) {
    return availabilityCache.value;
  }

  const pythonBin = getDoclingPythonBin();
  if (!pythonBin) return cacheAvailability(false, now);

  try {
    await fs.promises.access(pythonBin, fs.constants.X_OK);
  } catch {
    return cacheAvailability(false, now);
  }

  const available = await probeDoclingImport(pythonBin);
  return cacheAvailability(available, now);
}

function cacheAvailability(value: boolean, now: number): boolean {
  availabilityCache = { value, expiresAt: now + 5 * 60 * 1000 };
  return value;
}

function probeDoclingImport(pythonBin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn(pythonBin, ['-c', 'import docling']);
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      probe.kill('SIGKILL');
      finish(false);
    }, 5000);

    probe.on('error', () => finish(false));
    probe.on('close', code => finish(code === 0));
  });
}
