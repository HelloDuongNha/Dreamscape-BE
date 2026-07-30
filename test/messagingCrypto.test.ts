import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import {
  createMessageQueryTokens,
  createMessageSearchTokens,
  decryptMessageText,
  encryptMessageText,
  MessagingCryptoError,
  type MessageCryptoContext,
} from '../src/modules/messaging/services/crypto/messagingCrypto.service';

const originalEnvironment = {
  encryptionKeys: process.env.MESSAGE_ENCRYPTION_KEYS,
  encryptionVersion: process.env.MESSAGE_ENCRYPTION_ACTIVE_VERSION,
  searchKeys: process.env.MESSAGE_SEARCH_KEYS,
  searchVersion: process.env.MESSAGE_SEARCH_ACTIVE_VERSION,
};

const context: MessageCryptoContext = {
  recordType: 'message',
  recordId: 'message-01',
  conversationId: 'conversation-01',
  senderId: 'user-01',
};

before(() => {
  const encryptionKey = Buffer.alloc(32, 7).toString('base64');
  const searchKey = Buffer.alloc(32, 9).toString('base64');
  process.env.MESSAGE_ENCRYPTION_KEYS = JSON.stringify({ v1: encryptionKey });
  process.env.MESSAGE_ENCRYPTION_ACTIVE_VERSION = 'v1';
  process.env.MESSAGE_SEARCH_KEYS = JSON.stringify({ s1: searchKey });
  process.env.MESSAGE_SEARCH_ACTIVE_VERSION = 's1';
});

after(() => {
  restore('MESSAGE_ENCRYPTION_KEYS', originalEnvironment.encryptionKeys);
  restore('MESSAGE_ENCRYPTION_ACTIVE_VERSION', originalEnvironment.encryptionVersion);
  restore('MESSAGE_SEARCH_KEYS', originalEnvironment.searchKeys);
  restore('MESSAGE_SEARCH_ACTIVE_VERSION', originalEnvironment.searchVersion);
});

test('message encryption round trip returns the original Unicode text', () => {
  const plaintext = 'Tôi vừa mơ thấy một cây cầu.';
  const envelope = encryptMessageText(plaintext, context);
  assert.notEqual(envelope.ciphertext, plaintext);
  assert.equal(envelope.keyVersion, 'v1');
  assert.equal(decryptMessageText(envelope, context), plaintext);
});

test('authenticated encryption rejects changed ciphertext', () => {
  const envelope = encryptMessageText('MSG-TEST-4821', context);
  const bytes = Buffer.from(envelope.ciphertext, 'base64');
  bytes[0] ^= 1;
  assert.throws(
    () => decryptMessageText({
      ...envelope,
      ciphertext: bytes.toString('base64'),
    }, context),
    (error: unknown) => error instanceof MessagingCryptoError
      && error.code === 'message_authentication_failed',
  );
});

test('authenticated encryption binds a message to its conversation context', () => {
  const envelope = encryptMessageText('context-bound message', context);
  assert.throws(
    () => decryptMessageText(envelope, {
      ...context,
      conversationId: 'another-conversation',
    }),
    (error: unknown) => error instanceof MessagingCryptoError
      && error.code === 'message_authentication_failed',
  );
});

test('message search creates repeatable keyed tokens without storing words', () => {
  const indexed = createMessageSearchTokens('Giấc mơ xanh');
  const queried = createMessageQueryTokens('giac mo xanh', indexed.keyVersion);
  assert.deepEqual(queried, indexed.tokens);
  assert.ok(indexed.tokens.length > 0);
  assert.ok(!indexed.tokens.join(' ').includes('giac'));
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
