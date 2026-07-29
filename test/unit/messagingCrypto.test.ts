import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
  MessagingCryptoError,
  createAllMessageQueryTokenSets,
  createMessageSearchTokens,
  decryptMessageText,
  encryptMessageText,
} from '../../src/modules/messaging/services/messagingCrypto.service';

const context = {
  recordType: 'message' as const,
  recordId: 'message-1',
  conversationId: 'conversation-1',
  senderId: 'sender-1',
};

beforeEach(() => {
  process.env.MESSAGE_ENCRYPTION_ACTIVE_VERSION = 'v2';
  process.env.MESSAGE_ENCRYPTION_KEYS = JSON.stringify({
    v1: Buffer.alloc(32, 1).toString('base64'),
    v2: Buffer.alloc(32, 2).toString('base64'),
  });
  process.env.MESSAGE_SEARCH_ACTIVE_VERSION = 's2';
  process.env.MESSAGE_SEARCH_KEYS = JSON.stringify({
    s1: Buffer.alloc(32, 3).toString('base64'),
    s2: Buffer.alloc(32, 4).toString('base64'),
  });
});

test('AES-GCM uses a fresh IV and decrypts with the envelope key version', () => {
  const first = encryptMessageText('same private message', context);
  const second = encryptMessageText('same private message', context);

  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(first.keyVersion, 'v2');
  assert.equal(decryptMessageText(first, context), 'same private message');
  assert.equal(decryptMessageText(second, context), 'same private message');
});

test('tampering and AAD substitution fail authenticated decryption', () => {
  const envelope = encryptMessageText('private message', context);
  const tampered = {
    ...envelope,
    ciphertext: Buffer.from('tampered').toString('base64'),
  };

  assert.throws(
    () => decryptMessageText(tampered, context),
    (error: unknown) =>
      error instanceof MessagingCryptoError
      && error.code === 'message_authentication_failed',
  );
  assert.throws(
    () => decryptMessageText(envelope, { ...context, conversationId: 'another-conversation' }),
    (error: unknown) =>
      error instanceof MessagingCryptoError
      && error.code === 'message_authentication_failed',
  );
});

test('missing key versions and invalid configuration fail closed', () => {
  const envelope = encryptMessageText('private message', context);
  process.env.MESSAGE_ENCRYPTION_ACTIVE_VERSION = 'v1';
  process.env.MESSAGE_ENCRYPTION_KEYS = JSON.stringify({
    v1: Buffer.alloc(32, 1).toString('base64'),
  });

  assert.throws(
    () => decryptMessageText(envelope, context),
    (error: unknown) =>
      error instanceof MessagingCryptoError
      && error.code === 'message_key_version_unavailable',
  );
  delete process.env.MESSAGE_ENCRYPTION_KEYS;
  assert.throws(
    () => encryptMessageText('private message', context),
    (error: unknown) =>
      error instanceof MessagingCryptoError
      && error.code === 'message_encryption_not_configured',
  );
});

test('old key versions remain decryptable while new writes use the active version', () => {
  process.env.MESSAGE_ENCRYPTION_ACTIVE_VERSION = 'v1';
  const oldEnvelope = encryptMessageText('message before rotation', context);
  process.env.MESSAGE_ENCRYPTION_ACTIVE_VERSION = 'v2';
  const newEnvelope = encryptMessageText('message after rotation', context);

  assert.equal(oldEnvelope.keyVersion, 'v1');
  assert.equal(newEnvelope.keyVersion, 'v2');
  assert.equal(decryptMessageText(oldEnvelope, context), 'message before rotation');
  assert.equal(decryptMessageText(newEnvelope, context), 'message after rotation');
});

test('blind search tokens are deterministic, accent-folded and versioned', () => {
  const accented = createMessageSearchTokens('Giấc mơ sáng');
  const unaccented = createMessageSearchTokens('giac mo sang');
  assert.deepEqual(accented, unaccented);
  assert.equal(accented.keyVersion, 's2');

  const querySets = createAllMessageQueryTokenSets('giấc mơ');
  assert.deepEqual(querySets.map(item => item.keyVersion).sort(), ['s1', 's2']);
  assert.ok(querySets.every(item => item.tokens.length > 0));
});
