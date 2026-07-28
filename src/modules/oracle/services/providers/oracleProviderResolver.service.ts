import { Types } from 'mongoose';
import { decryptCredentialKey } from './oracleCredentialCrypto.service';
import { getActiveOracleCredential } from './oracleCredential.service';
import type { OracleModelAdapter } from './oracleModel.types';
import { OllamaOracleModelAdapter } from './ollamaOracleProvider.service';
import { OpenAICompatibleOracleModelAdapter } from './openAICompatibleOracleProvider.service';

export async function resolveOracleModelAdapter(
  userId?: Types.ObjectId,
): Promise<OracleModelAdapter> {
  const userAdapter = userId ? await resolveUserAdapter(userId) : null;
  if (userAdapter) return userAdapter;
  return resolveEnvironmentAdapter();
}

async function resolveUserAdapter(userId: Types.ObjectId): Promise<OracleModelAdapter | null> {
  const credential = await getActiveOracleCredential(userId);
  if (!credential?.privateContextAcknowledged) return null;
  if (credential.provider === 'ollama') {
    return new OllamaOracleModelAdapter(credential.baseUrl, credential.modelName);
  }
  return new OpenAICompatibleOracleModelAdapter(
    credential.baseUrl,
    decryptCredentialKey(credential),
    credential.modelName,
    true,
  );
}

function resolveEnvironmentAdapter(): OracleModelAdapter {
  const provider = String(process.env.ORACLE_MODEL_PROVIDER || 'ollama').trim().toLowerCase();
  if (provider === 'ollama') return new OllamaOracleModelAdapter();
  if (provider === 'openai_compatible') return new OpenAICompatibleOracleModelAdapter();
  throw new Error('oracle_model_provider_unsupported');
}
