import type { OracleCredentialProvider } from '../models/OracleModelCredential';
import type { OracleCredentialInput } from '../services/providers/oracleCredential.service';
import { OracleContractError } from '../services/oracle.types';

export function parseOracleCredentialBody(
  body: Record<string, unknown> | undefined,
): OracleCredentialInput {
  const provider = body?.provider;
  if (provider !== 'ollama' && provider !== 'openai_compatible') {
    throw new OracleContractError('oracle_invalid_request', 'Unsupported model provider.');
  }
  return {
    provider: provider as OracleCredentialProvider,
    label: String(body?.label || ''),
    baseUrl: String(body?.baseUrl || ''),
    modelName: String(body?.modelName || ''),
    apiKey: String(body?.apiKey || ''),
    privateContextAcknowledged: body?.privateContextAcknowledged === true,
  };
}
