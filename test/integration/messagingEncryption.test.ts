import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before, beforeEach } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose, { Types } from 'mongoose';
import { io as createSocketClient, type Socket as ClientSocket } from 'socket.io-client';
import app from '../../src/app';
import { initSocket } from '../../src/config/socket';
import Conversation from '../../src/modules/messaging/models/Conversation';
import Message from '../../src/modules/messaging/models/Message';
import User from '../../src/modules/identity/models/User';
import {
  markConversationSeenByParticipant,
  markMessageDeliveredByRecipient,
} from '../../src/modules/messaging/services/conversationAuthorization.service';
import {
  persistEncryptedMessage,
  presentMessage,
} from '../../src/modules/messaging/services/messagePersistence.service';
import {
  runMessageEncryptionMigration,
} from '../../src/modules/messaging/services/messageEncryptionMigration.service';
import { searchMessaging } from '../../src/modules/messaging/services/messagingSearch.service';
import { connectTestDatabase, disconnectTestDatabase } from '../support/testDatabase';

const databaseConfigured = Boolean(process.env.MONGODB_TEST_URI);
if (databaseConfigured) {
  const messagingDatabaseUri = new URL(process.env.MONGODB_TEST_URI!);
  messagingDatabaseUri.pathname = '/dreamscape_messaging_test';
  process.env.MONGODB_TEST_URI = messagingDatabaseUri.toString();
}

let server: http.Server;
let socketServer: ReturnType<typeof initSocket>;
let baseUrl = '';

before(async () => {
  if (!databaseConfigured) return;
  configureTestKeys();
  process.env.JWT_SECRET = 'messaging-integration-jwt-secret';
  await connectTestDatabase();
  server = http.createServer(app);
  socketServer = initSocket(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Messaging test server did not bind.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  if (!databaseConfigured) return;
  await Promise.all([
    User.deleteMany({}),
    Conversation.deleteMany({}),
    Message.deleteMany({}),
  ]);
});

after(async () => {
  if (!databaseConfigured) return;
  await Promise.all([
    User.deleteMany({}),
    Conversation.deleteMany({}),
    Message.deleteMany({}),
  ]);
  await new Promise<void>(resolve => socketServer.close(() => resolve()));
  if (server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
  await disconnectTestDatabase();
});

test('new messages and conversation previews persist no plaintext and remain searchable', { skip: !databaseConfigured }, async () => {
  const { sender, recipient, conversation } = await createConversationFixture();
  const secretText = 'Giấc mơ riêng tư ở nhà ga';

  const result = await persistEncryptedMessage({
    conversationId: conversation._id as Types.ObjectId,
    senderId: sender._id as Types.ObjectId,
    content: secretText,
  });

  const rawMessage = await mongoose.connection.collection('messages').findOne({ _id: result._id });
  const rawConversation = await mongoose.connection.collection('conversations').findOne({
    _id: conversation._id,
  });
  assert.equal(rawMessage?.content, undefined);
  assert.notEqual(rawMessage?.ciphertext, secretText);
  assert.equal(rawConversation?.last_message, '');
  assert.notEqual(rawConversation?.lastMessageCiphertext, secretText);
  assert.equal(presentMessage(rawMessage).content, secretText);

  const search = await searchMessaging(recipient._id as Types.ObjectId, 'giac mo rieng');
  assert.equal(search.messages.length, 1);
  assert.equal(search.messages[0].message.content, secretText);
});

test('delivery and seen transitions reject senders and non-participants', { skip: !databaseConfigured }, async () => {
  const { sender, recipient, conversation } = await createConversationFixture();
  const outsider = await User.create({
    username: '@message_outsider',
    display_name: 'Message Outsider',
    email: 'message-outsider@example.test',
    password: 'CurrentPass9',
  });
  const message = await persistEncryptedMessage({
    conversationId: conversation._id as Types.ObjectId,
    senderId: sender._id as Types.ObjectId,
    content: 'Private receipt state',
  });

  assert.equal(await markMessageDeliveredByRecipient(String(message._id), String(sender._id)), null);
  assert.equal(await markMessageDeliveredByRecipient(String(message._id), String(outsider._id)), null);
  assert.equal((await Message.findById(message._id))!.status, 'sent');

  const delivered = await markMessageDeliveredByRecipient(String(message._id), String(recipient._id));
  assert.equal(delivered?.status, 'delivered');
  assert.equal(await markConversationSeenByParticipant(String(conversation._id), String(outsider._id)), null);
  const seen = await markConversationSeenByParticipant(
    String(conversation._id),
    String(recipient._id),
  );
  assert.equal(seen?.modifiedCount, 1);
  assert.equal((await Message.findById(message._id))!.status, 'seen');
});

test('dual-read compatibility presents legacy plaintext during migration', { skip: !databaseConfigured }, async () => {
  const { sender, conversation } = await createConversationFixture();
  const legacy = await Message.create({
    conversationId: conversation._id,
    senderId: sender._id,
    content: 'legacy plaintext awaiting migration',
    timestamp: new Date(),
  });

  assert.equal(
    presentMessage(legacy.toObject()).content,
    'legacy plaintext awaiting migration',
  );
});

test('migration is dry-run safe, idempotent, verifiable, and explicitly reversible', { skip: !databaseConfigured }, async () => {
  const { sender, conversation } = await createConversationFixture();
  const legacyText = 'legacy private message for reversible migration';
  await Message.create({
    conversationId: conversation._id,
    senderId: sender._id,
    content: legacyText,
    timestamp: new Date(),
  });
  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { last_message: legacyText } },
  );

  const dryRun = await runMessageEncryptionMigration({ mode: 'dry-run' });
  assert.equal(dryRun.messages.candidates, 1);
  assert.equal(dryRun.messages.migrated, 0);
  assert.equal((await Message.findOne({ conversationId: conversation._id }))!.content, legacyText);

  const applied = await runMessageEncryptionMigration({ mode: 'apply' });
  assert.equal(applied.messages.migrated, 1);
  assert.equal(applied.conversations.migrated, 1);
  assert.equal(applied.verification.stagedMessages, 1);
  assert.equal(applied.verification.stagedPreviews, 1);
  const stagedMessage = await mongoose.connection.collection('messages').findOne({
    conversationId: conversation._id,
  });
  assert.equal(stagedMessage?.content, legacyText);

  const stagedRollback = await runMessageEncryptionMigration({ mode: 'rollback' });
  assert.equal(stagedRollback.messages.rolledBack, 1);
  assert.equal(stagedRollback.conversations.rolledBack, 1);
  const restaged = await runMessageEncryptionMigration({ mode: 'apply' });
  assert.equal(restaged.messages.migrated, 1);
  assert.equal(restaged.conversations.migrated, 1);

  const cleaned = await runMessageEncryptionMigration({ mode: 'cleanup' });
  assert.equal(cleaned.messages.cleaned, 1);
  assert.equal(cleaned.conversations.cleaned, 1);
  assert.deepEqual(applied.verification, {
    plaintextMessagesRemaining: 1,
    plaintextPreviewsRemaining: 1,
    stagedMessages: 1,
    stagedPreviews: 1,
    incompleteMessageEnvelopes: 0,
    incompletePreviewEnvelopes: 0,
  });
  assert.deepEqual(cleaned.verification, {
    plaintextMessagesRemaining: 0,
    plaintextPreviewsRemaining: 0,
    stagedMessages: 0,
    stagedPreviews: 0,
    incompleteMessageEnvelopes: 0,
    incompletePreviewEnvelopes: 0,
  });

  const repeated = await runMessageEncryptionMigration({ mode: 'cleanup' });
  assert.equal(repeated.messages.candidates, 0);
  assert.equal(repeated.conversations.candidates, 0);

  const rolledBack = await runMessageEncryptionMigration({ mode: 'rollback' });
  assert.equal(rolledBack.messages.rolledBack, 1);
  assert.equal(rolledBack.conversations.rolledBack, 1);
  const rawMessage = await mongoose.connection.collection('messages').findOne({
    conversationId: conversation._id,
  });
  assert.equal(rawMessage?.content, legacyText);
  assert.equal(rawMessage?.ciphertext, undefined);
});

test('HTTP history decrypts only after conversation membership is verified', { skip: !databaseConfigured }, async () => {
  const fixture = await createTransportFixture();
  const secretText = 'HTTP-only participant message';
  await persistEncryptedMessage({
    conversationId: fixture.conversation._id as Types.ObjectId,
    senderId: fixture.sender._id as Types.ObjectId,
    content: secretText,
  });

  const participantResponse = await requestJson(
    `/api/conversations/messages/${fixture.conversation._id}`,
    tokenFor(fixture.recipient._id, fixture.recipientSessionId),
  );
  assert.equal(participantResponse.status, 200);
  assert.equal(participantResponse.body.data.length, 1);
  assert.equal(participantResponse.body.data[0].content, secretText);

  const outsiderResponse = await requestJson(
    `/api/conversations/messages/${fixture.conversation._id}`,
    tokenFor(fixture.outsider._id, fixture.outsiderSessionId),
  );
  assert.equal(outsiderResponse.status, 403);
  assert.equal(outsiderResponse.body.data, undefined);
});

test('Socket.IO handshake, send, delivery and seen events preserve authorization and ciphertext', { skip: !databaseConfigured }, async () => {
  const fixture = await createTransportFixture();
  const clients: ClientSocket[] = [];
  const secretText = 'Socket transport private message';

  try {
    const rejected = createSocketClient(baseUrl, {
      auth: { token: 'invalid-token' },
      autoConnect: false,
      transports: ['websocket'],
    });
    clients.push(rejected);
    const rejectedError = waitForEvent<Error>(rejected, 'connect_error');
    rejected.connect();
    assert.match((await rejectedError).message, /Unauthorized/);

    const sender = await connectSocket(
      tokenFor(fixture.sender._id, fixture.senderSessionId),
    );
    const recipient = await connectSocket(
      tokenFor(fixture.recipient._id, fixture.recipientSessionId),
    );
    const outsider = await connectSocket(
      tokenFor(fixture.outsider._id, fixture.outsiderSessionId),
    );
    clients.push(sender, recipient, outsider);

    const deniedJoin = waitForEvent<{ code: string }>(outsider, 'error_message');
    outsider.emit('join_room', { conversationId: String(fixture.conversation._id) });
    assert.equal((await deniedJoin).code, 'conversation_access_denied');

    const senderMessage = waitForEvent<any>(sender, 'receive_message');
    const recipientMessage = waitForEvent<any>(recipient, 'receive_message');
    sender.emit('send_message', {
      conversationId: String(fixture.conversation._id),
      content: secretText,
      tempId: 'transport-temp-id',
    });

    const [senderPayload, recipientPayload] = await Promise.all([
      senderMessage,
      recipientMessage,
    ]);
    assert.equal(senderPayload.content, secretText);
    assert.equal(senderPayload.tempId, 'transport-temp-id');
    assert.equal(recipientPayload.content, secretText);
    assert.equal(recipientPayload.tempId, undefined);

    const raw = await mongoose.connection.collection('messages').findOne({
      _id: new Types.ObjectId(String(senderPayload._id)),
    });
    assert.equal(raw?.content, undefined);
    assert.notEqual(raw?.ciphertext, secretText);

    const delivered = waitForEvent<any>(sender, 'message_status_updated');
    recipient.emit('message_delivered', { messageId: String(senderPayload._id) });
    assert.equal((await delivered).status, 'delivered');

    const seen = waitForEvent<any>(sender, 'message_status_updated');
    recipient.emit('mark_as_seen', { conversationId: String(fixture.conversation._id) });
    assert.equal((await seen).status, 'seen');
    assert.equal((await Message.findById(senderPayload._id))!.status, 'seen');
  } finally {
    clients.forEach(client => client.disconnect());
  }
});

async function createConversationFixture() {
  const sender = await User.create({
    username: '@message_sender',
    display_name: 'Message Sender',
    email: 'message-sender@example.test',
    password: 'CurrentPass9',
  });
  const recipient = await User.create({
    username: '@message_recipient',
    display_name: 'Message Recipient',
    email: 'message-recipient@example.test',
    password: 'CurrentPass9',
  });
  const conversation = await Conversation.create({
    participant_ids: [sender._id, recipient._id],
    last_message: '',
    updated_at: new Date(),
  });
  return { sender, recipient, conversation };
}

async function createTransportFixture() {
  const senderSessionId = new Types.ObjectId();
  const recipientSessionId = new Types.ObjectId();
  const outsiderSessionId = new Types.ObjectId();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const [sender, recipient, outsider] = await Promise.all([
    User.create({
      username: '@transport_sender',
      display_name: 'Transport Sender',
      email: 'transport-sender@example.test',
      password: 'MessagePass9',
      sessions: [{ _id: senderSessionId, authenticatedAt: now, lastActive: now }],
      loginHistory: [today],
    }),
    User.create({
      username: '@transport_recipient',
      display_name: 'Transport Recipient',
      email: 'transport-recipient@example.test',
      password: 'MessagePass9',
      sessions: [{ _id: recipientSessionId, authenticatedAt: now, lastActive: now }],
      loginHistory: [today],
    }),
    User.create({
      username: '@transport_outsider',
      display_name: 'Transport Outsider',
      email: 'transport-outsider@example.test',
      password: 'MessagePass9',
      sessions: [{ _id: outsiderSessionId, authenticatedAt: now, lastActive: now }],
      loginHistory: [today],
    }),
  ]);
  const conversation = await Conversation.create({
    participant_ids: [sender._id, recipient._id],
    last_message: '',
    updated_at: now,
  });
  return {
    sender,
    recipient,
    outsider,
    conversation,
    senderSessionId,
    recipientSessionId,
    outsiderSessionId,
  };
}

function tokenFor(userId: unknown, sessionId: Types.ObjectId): string {
  return jwt.sign(
    { id: String(userId), sessionId: String(sessionId) },
    process.env.JWT_SECRET!,
    { expiresIn: '5m' },
  );
}

async function requestJson(
  path: string,
  token: string,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function connectSocket(token: string): Promise<ClientSocket> {
  const client = createSocketClient(baseUrl, {
    auth: { token },
    autoConnect: false,
    transports: ['websocket'],
  });
  const connected = waitForEvent<void>(client, 'connect');
  client.connect();
  await connected;
  return client;
}

function waitForEvent<T>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 3_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for Socket.IO event: ${event}`));
    }, timeoutMs);
    const onEvent = (value: T) => {
      clearTimeout(timer);
      resolve(value);
    };
    socket.once(event, onEvent);
  });
}

function configureTestKeys(): void {
  process.env.MESSAGE_ENCRYPTION_ACTIVE_VERSION = 'v1';
  process.env.MESSAGE_ENCRYPTION_KEYS = JSON.stringify({
    v1: Buffer.alloc(32, 11).toString('base64'),
  });
  process.env.MESSAGE_SEARCH_ACTIVE_VERSION = 's1';
  process.env.MESSAGE_SEARCH_KEYS = JSON.stringify({
    s1: Buffer.alloc(32, 12).toString('base64'),
  });
}
