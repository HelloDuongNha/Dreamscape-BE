import crypto from 'node:crypto';
import type { IOracleModelCredential } from '../../models/OracleModelCredential';
import { OracleContractError } from '../oracle.types';
import { requireEnvironmentSecret } from '../../../../config/env';

export function encryptCredentialKey(value: string): {
  encryptedKey: string;
  encryptionIv: string;
  encryptionTag: string;
} {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    encryptedKey: encrypted.toString('base64'),
    encryptionIv: iv.toString('base64'),
    encryptionTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptCredentialKey(credential: IOracleModelCredential): string {
  if (!credential.encryptedKey || !credential.encryptionIv || !credential.encryptionTag) return '';
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(credential.encryptionIv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(credential.encryptionTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(credential.encryptedKey, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function encryptionKey(): Buffer {
  let secret: string;
  try {
    secret = requireEnvironmentSecret('ORACLE_CREDENTIAL_ENCRYPTION_KEY');
  } catch {
    throw new OracleContractError(
      'oracle_persistence_failed',
      'Oracle credential encryption is not configured.',
    );
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}
