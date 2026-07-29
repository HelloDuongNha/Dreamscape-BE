import { Types } from 'mongoose';
import OracleModelCredential, {
  type IOracleModelCredential,
  type OracleCredentialProvider,
} from '../../models/OracleModelCredential';
import { OracleContractError } from '../oracle.types';
import {
  decryptCredentialKey,
  encryptCredentialKey,
} from './oracleCredentialCrypto.service';

export interface OracleCredentialInput {
  provider: OracleCredentialProvider;
  label: string;
  baseUrl: string;
  modelName: string;
  apiKey?: string;
  privateContextAcknowledged: boolean;
}

function normalizeUrl(raw: string, provider: OracleCredentialProvider): string {
  const fallback = provider === 'ollama' ? 'http://127.0.0.1:11434' : '';
  let parsed: URL;
  try {
    parsed = new URL((raw || fallback).trim());
  } catch {
    throw new OracleContractError('oracle_invalid_request', 'Invalid model endpoint.');
  }
  if (parsed.username || parsed.password) {
    throw new OracleContractError('oracle_invalid_request', 'Credentials must not be embedded in a URL.');
  }
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(provider === 'ollama' && localHost && parsed.protocol === 'http:')) {
    throw new OracleContractError('oracle_invalid_request', 'Model endpoint must use HTTPS.');
  }
  return parsed.toString().replace(/\/+$/u, '');
}

function keyHint(apiKey: string): string {
  if (!apiKey) return '';
  const start = apiKey.slice(0, Math.min(5, apiKey.length));
  const end = apiKey.length > 4 ? apiKey.slice(-4) : '';
  return `${start}…${end}`;
}

export async function saveOracleCredential(
  userId: Types.ObjectId,
  input: OracleCredentialInput,
): Promise<IOracleModelCredential> {
  const provider = input.provider;
  const apiKey = String(input.apiKey || '').trim();
  if (!['openai_compatible', 'ollama'].includes(provider)) {
    throw new OracleContractError('oracle_invalid_request', 'Unsupported model provider.');
  }
  if (provider === 'openai_compatible' && !apiKey) {
    throw new OracleContractError('oracle_invalid_request', 'An API key is required.');
  }
  if (!input.privateContextAcknowledged) {
    throw new OracleContractError('oracle_invalid_request', 'Private-context consent is required.');
  }
  const secretFields = apiKey ? encryptCredentialKey(apiKey) : {};
  const credential = await OracleModelCredential.create({
    userId,
    provider,
    label: input.label.trim() || (provider === 'ollama' ? 'Ollama' : 'API model'),
    baseUrl: normalizeUrl(input.baseUrl, provider),
    modelName: input.modelName.trim(),
    keyHint: keyHint(apiKey),
    ...secretFields,
    privateContextAcknowledged: true,
    active: false,
    status: 'unchecked',
  });
  return credential;
}

export function publicCredential(credential: IOracleModelCredential | Record<string, any>) {
  return {
    _id: String(credential._id),
    provider: credential.provider,
    label: credential.label,
    baseUrl: credential.baseUrl,
    modelName: credential.modelName,
    keyHint: credential.keyHint || '',
    active: Boolean(credential.active),
    status: credential.status,
    lastCheckedAt: credential.lastCheckedAt || null,
    lastErrorCode: credential.lastErrorCode || null,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  };
}

export async function verifyOracleCredential(
  userId: Types.ObjectId,
  credentialId: Types.ObjectId,
): Promise<IOracleModelCredential> {
  const credential = await OracleModelCredential.findOne({ _id: credentialId, userId })
    .select('+encryptedKey +encryptionIv +encryptionTag');
  if (!credential) throw new OracleContractError('oracle_not_found', 'Credential not found.');
  const apiKey = decryptCredentialKey(credential);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const url = credential.provider === 'ollama'
      ? `${credential.baseUrl}/api/tags`
      : `${credential.baseUrl}/models`;
    const response = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    credential.status = 'active';
    credential.lastErrorCode = undefined;
  } catch (error) {
    credential.status = 'failed';
    credential.lastErrorCode = error instanceof Error && error.name === 'AbortError'
      ? 'connection_timeout'
      : 'connection_failed';
  } finally {
    clearTimeout(timeout);
  }
  credential.lastCheckedAt = new Date();
  await credential.save();
  return credential;
}

export async function activateOracleCredential(
  userId: Types.ObjectId,
  credentialId: Types.ObjectId,
): Promise<IOracleModelCredential> {
  const credential = await OracleModelCredential.findOne({ _id: credentialId, userId });
  if (!credential) throw new OracleContractError('oracle_not_found', 'Credential not found.');
  if (credential.status !== 'active') {
    throw new OracleContractError('oracle_invalid_request', 'Test the connection before activating it.');
  }
  await OracleModelCredential.updateMany({ userId, active: true }, { $set: { active: false } });
  credential.active = true;
  await credential.save();
  return credential;
}

export async function getActiveOracleCredential(userId: Types.ObjectId) {
  return OracleModelCredential.findOne({ userId, active: true, status: 'active' })
    .select('+encryptedKey +encryptionIv +encryptionTag');
}

export async function listOracleCredentialRecords(userId: Types.ObjectId) {
  return OracleModelCredential.find({ userId }).sort({ updatedAt: -1 }).lean();
}

export async function deleteOracleCredentialRecord(
  userId: Types.ObjectId,
  credentialId: Types.ObjectId,
): Promise<void> {
  const result = await OracleModelCredential.deleteOne({ _id: credentialId, userId });
  if (!result.deletedCount) throw new OracleContractError('oracle_not_found', 'Credential not found.');
}

export { decryptCredentialKey };
