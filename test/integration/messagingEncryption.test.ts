import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import mongoose, { Types } from 'mongoose';
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

before(async () => {
  if (!databaseConfigured) return;
  configureTestKeys();
  await connectTestDatabase();
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
