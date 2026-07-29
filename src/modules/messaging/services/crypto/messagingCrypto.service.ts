import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'crypto';

export interface EncryptedTextEnvelope {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}

export interface MessageCryptoContext {
  recordType: 'message' | 'conversation_preview';
  recordId: string;
  conversationId: string;
  senderId: string;
}

export class MessagingCryptoError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MessagingCryptoError';
  }
}

/**
 * Validates both keyrings without encrypting data. The server and migration CLI
 * use this fail-fast boundary so missing keys cannot silently fall back to
 * plaintext persistence or an unsearchable encrypted state.
 */
export function assertMessagingSecurityConfigured(): void {
  loadKeyring('MESSAGE_ENCRYPTION_KEYS', 'MESSAGE_ENCRYPTION_ACTIVE_VERSION');
  loadKeyring('MESSAGE_SEARCH_KEYS', 'MESSAGE_SEARCH_ACTIVE_VERSION');
}

export function encryptMessageText(
  plaintext: string,
  context: MessageCryptoContext,
): EncryptedTextEnvelope {
  const keyring = loadKeyring('MESSAGE_ENCRYPTION_KEYS', 'MESSAGE_ENCRYPTION_ACTIVE_VERSION');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyring.activeKey, iv);
  cipher.setAAD(aad(context, keyring.activeVersion));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: keyring.activeVersion,
  };
}

export function decryptMessageText(
  envelope: EncryptedTextEnvelope,
  context: MessageCryptoContext,
): string {
  const keyring = loadKeyring('MESSAGE_ENCRYPTION_KEYS', 'MESSAGE_ENCRYPTION_ACTIVE_VERSION');
  const key = keyring.keys.get(envelope.keyVersion);
  if (!key) {
    throw new MessagingCryptoError(
      'message_key_version_unavailable',
      'The message encryption key version is unavailable.',
    );
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      decodeEnvelopePart(envelope.iv, 12, 'iv'),
    );
    decipher.setAAD(aad(context, envelope.keyVersion));
    decipher.setAuthTag(decodeEnvelopePart(envelope.authTag, 16, 'authentication tag'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    if (error instanceof MessagingCryptoError) throw error;
    throw new MessagingCryptoError(
      'message_authentication_failed',
      'Encrypted message authentication failed.',
    );
  }
}

export function createMessageSearchTokens(value: string): {
  tokens: string[];
  keyVersion: string;
} {
  const keyring = loadKeyring('MESSAGE_SEARCH_KEYS', 'MESSAGE_SEARCH_ACTIVE_VERSION');
  const tokens = searchNgrams(value).map(token =>
    createHmac('sha256', keyring.activeKey)
      .update(`message-search:${keyring.activeVersion}:${token}`)
      .digest('base64url'));
  return {
    tokens: [...new Set(tokens)],
    keyVersion: keyring.activeVersion,
  };
}

export function createMessageQueryTokens(
  value: string,
  keyVersion: string,
): string[] {
  const keyring = loadKeyring('MESSAGE_SEARCH_KEYS', 'MESSAGE_SEARCH_ACTIVE_VERSION');
  const key = keyring.keys.get(keyVersion);
  if (!key) return [];
  return [...new Set(searchNgrams(value).map(token =>
    createHmac('sha256', key)
      .update(`message-search:${keyVersion}:${token}`)
      .digest('base64url')))];
}

export function createAllMessageQueryTokenSets(value: string): Array<{
  keyVersion: string;
  tokens: string[];
}> {
  const keyring = loadKeyring('MESSAGE_SEARCH_KEYS', 'MESSAGE_SEARCH_ACTIVE_VERSION');
  return [...keyring.keys.keys()].map(keyVersion => ({
    keyVersion,
    tokens: createMessageQueryTokens(value, keyVersion),
  })).filter(item => item.tokens.length > 0);
}

function loadKeyring(keysVariable: string, activeVariable: string): {
  keys: Map<string, Buffer>;
  activeVersion: string;
  activeKey: Buffer;
} {
  const activeVersion = process.env[activeVariable]?.trim();
  const encodedKeyring = process.env[keysVariable]?.trim();
  if (!activeVersion || !encodedKeyring) {
    throw new MessagingCryptoError(
      'message_encryption_not_configured',
      `Messaging security configuration is missing (${keysVariable}/${activeVariable}).`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(encodedKeyring);
  } catch {
    throw new MessagingCryptoError(
      'message_encryption_config_invalid',
      `${keysVariable} must be a JSON object of base64-encoded keys.`,
    );
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new MessagingCryptoError(
      'message_encryption_config_invalid',
      `${keysVariable} must be a JSON object.`,
    );
  }

  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(parsed)) {
    if (!version.trim() || typeof encoded !== 'string') continue;
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) {
      throw new MessagingCryptoError(
        'message_encryption_config_invalid',
        `${keysVariable}.${version} must decode to exactly 32 bytes.`,
      );
    }
    keys.set(version, key);
  }
  const activeKey = keys.get(activeVersion);
  if (!activeKey) {
    throw new MessagingCryptoError(
      'message_encryption_config_invalid',
      `${activeVariable} does not identify a configured key.`,
    );
  }
  return { keys, activeVersion, activeKey };
}

function aad(context: MessageCryptoContext, keyVersion: string): Buffer {
  return Buffer.from([
    'dreamscape-message-v1',
    context.recordType,
    context.recordId,
    context.conversationId,
    context.senderId,
    keyVersion,
  ].join('|'), 'utf8');
}

function decodeEnvelopePart(value: string, expectedBytes: number, label: string): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== expectedBytes) {
    throw new MessagingCryptoError(
      'message_envelope_invalid',
      `Encrypted message ${label} is invalid.`,
    );
  }
  return decoded;
}

function searchNgrams(value: string): string[] {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/gu, 'd')
    .replace(/Đ/gu, 'D')
    .toLocaleLowerCase('vi')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) return [];
  if (normalized.length <= 3) return [normalized];

  const tokens: string[] = [];
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    tokens.push(normalized.slice(index, index + 3));
  }
  return tokens;
}
