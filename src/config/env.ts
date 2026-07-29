import dotenv from 'dotenv';
import path from 'path';

dotenv.config({
  path: path.resolve(process.cwd(), '.env'),
});

/**
 * Reads configuration without embedding a credential or environment-specific
 * fallback in source code. Missing values fail at the feature boundary that
 * needs them, so deployments cannot silently run with a placeholder secret.
 */
export function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required in the environment.`);
  }
  return value;
}

export function requireEnvironmentSecret(name: string, minimumLength = 32): string {
  const value = requireEnvironmentVariable(name);
  if (value.length < minimumLength) {
    throw new Error(`${name} must contain at least ${minimumLength} characters.`);
  }
  return value;
}
