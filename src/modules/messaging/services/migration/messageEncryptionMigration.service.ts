import Conversation from '../../models/Conversation';
import Message from '../../models/Message';
import {
  assertMessagingSecurityConfigured,
  createMessageSearchTokens,
  decryptMessageText,
  encryptMessageText,
} from '../crypto/messagingCrypto.service';

type MigrationMode = 'dry-run' | 'apply' | 'cleanup' | 'rollback';

export interface MessageEncryptionMigrationReport {
  mode: MigrationMode;
  limitPerCollection: number;
  messages: MigrationCounters;
  conversations: MigrationCounters;
  verification: MessageEncryptionVerification;
}

interface MigrationCounters {
  candidates: number;
  migrated: number;
  cleaned: number;
  rolledBack: number;
  conflicts: number;
  malformed: number;
}

interface MessageEncryptionVerification {
  plaintextMessagesRemaining: number;
  plaintextPreviewsRemaining: number;
  stagedMessages: number;
  stagedPreviews: number;
  incompleteMessageEnvelopes: number;
  incompletePreviewEnvelopes: number;
}

const MESSAGE_ENVELOPE_FIELDS = ['ciphertext', 'iv', 'authTag', 'keyVersion'] as const;
const PREVIEW_ENVELOPE_FIELDS = [
  'lastMessageCiphertext',
  'lastMessageIv',
  'lastMessageAuthTag',
  'lastMessageKeyVersion',
  'lastMessageSenderId',
] as const;

/**
 * Migrates a bounded slice on each invocation. Compare-and-set updates make
 * retries safe while dual-read remains active, so a process interruption never
 * requires inventing a second message persistence path.
 */
export async function runMessageEncryptionMigration(input: {
  mode?: MigrationMode;
  limitPerCollection?: number;
} = {}): Promise<MessageEncryptionMigrationReport> {
  assertMessagingSecurityConfigured();
  const mode = input.mode ?? 'dry-run';
  const limitPerCollection = normalizeLimit(input.limitPerCollection);
  const messages = createCounters();
  const conversations = createCounters();

  if (mode === 'rollback') {
    await rollbackConversations(limitPerCollection, conversations);
    await rollbackMessages(limitPerCollection, messages);
  } else if (mode === 'cleanup') {
    await cleanupMessages(limitPerCollection, messages);
    await cleanupConversations(limitPerCollection, conversations);
  } else {
    await migrateMessages(mode, limitPerCollection, messages);
    await migrateConversations(mode, limitPerCollection, conversations);
  }

  return {
    mode,
    limitPerCollection,
    messages,
    conversations,
    verification: await verifyMessageEncryptionMigration(),
  };
}

export async function verifyMessageEncryptionMigration(): Promise<MessageEncryptionVerification> {
  const [
    plaintextMessagesRemaining,
    plaintextPreviewsRemaining,
    stagedMessages,
    stagedPreviews,
    messageRows,
    conversationRows,
  ] = await Promise.all([
      Message.countDocuments({ content: { $exists: true } }),
      Conversation.countDocuments({ last_message: { $exists: true, $ne: '' } }),
      Message.countDocuments({
        content: { $exists: true },
        ...completeEnvelopeQuery(MESSAGE_ENVELOPE_FIELDS),
      } as any),
      Conversation.countDocuments({
        last_message: { $exists: true, $ne: '' },
        ...completeEnvelopeQuery(PREVIEW_ENVELOPE_FIELDS),
      } as any),
      Message.find(envelopePresenceQuery(MESSAGE_ENVELOPE_FIELDS))
        .select(MESSAGE_ENVELOPE_FIELDS.join(' '))
        .lean(),
      Conversation.find(envelopePresenceQuery(PREVIEW_ENVELOPE_FIELDS))
        .select(PREVIEW_ENVELOPE_FIELDS.join(' '))
        .lean(),
    ]);

  return {
    plaintextMessagesRemaining,
    plaintextPreviewsRemaining,
    stagedMessages,
    stagedPreviews,
    incompleteMessageEnvelopes: messageRows.filter(
      row => envelopeState(row, MESSAGE_ENVELOPE_FIELDS) === 'partial',
    ).length,
    incompletePreviewEnvelopes: conversationRows.filter(
      row => envelopeState(row, PREVIEW_ENVELOPE_FIELDS) === 'partial',
    ).length,
  };
}

async function migrateMessages(
  mode: Exclude<MigrationMode, 'rollback'>,
  limit: number,
  counters: MigrationCounters,
): Promise<void> {
  const messages = await Message.find({
    content: { $exists: true },
    ...absentEnvelopeQuery(MESSAGE_ENVELOPE_FIELDS),
  } as any)
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
  counters.candidates = messages.length;

  for (const message of messages) {
    const content = typeof message.content === 'string' ? message.content : '';
    const state = envelopeState(message, MESSAGE_ENVELOPE_FIELDS);
    if (!content || state !== 'absent') {
      counters.malformed += 1;
      continue;
    }

    const envelope = encryptMessageText(content, messageContext(message));
    if (mode === 'dry-run') continue;

    const search = createMessageSearchTokens(content);
    const result = await Message.updateOne(
      {
        _id: message._id,
        content,
        ...absentEnvelopeQuery(MESSAGE_ENVELOPE_FIELDS),
      },
      {
        $set: {
          ...envelope,
          searchTokens: search.tokens,
          searchKeyVersion: search.keyVersion,
        },
      },
    );
    if (result.modifiedCount === 1) counters.migrated += 1;
    else counters.conflicts += 1;
  }
}

async function migrateConversations(
  mode: Exclude<MigrationMode, 'rollback'>,
  limit: number,
  counters: MigrationCounters,
): Promise<void> {
  const conversations = await Conversation.find({
    last_message: { $exists: true, $ne: '' },
    ...absentEnvelopeQuery(PREVIEW_ENVELOPE_FIELDS),
  } as any)
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
  counters.candidates = conversations.length;

  for (const conversation of conversations) {
    const preview = String(conversation.last_message || '');
    const state = envelopeState(conversation, PREVIEW_ENVELOPE_FIELDS);
    const latestMessage = await Message.findOne({ conversationId: conversation._id })
      .sort({ timestamp: -1, _id: -1 })
      .select('senderId')
      .lean();
    const senderId = String(conversation.lastMessageSenderId || latestMessage?.senderId || '');
    if (!preview || !senderId || state !== 'absent') {
      counters.malformed += 1;
      continue;
    }

    const envelope = encryptMessageText(preview, previewContext(conversation._id, senderId));
    if (mode === 'dry-run') continue;

    const result = await Conversation.updateOne(
      {
        _id: conversation._id,
        last_message: preview,
        ...absentEnvelopeQuery(PREVIEW_ENVELOPE_FIELDS),
      },
      {
        $set: {
          lastMessageCiphertext: envelope.ciphertext,
          lastMessageIv: envelope.iv,
          lastMessageAuthTag: envelope.authTag,
          lastMessageKeyVersion: envelope.keyVersion,
          lastMessageSenderId: senderId,
        },
      },
    );
    if (result.modifiedCount === 1) counters.migrated += 1;
    else counters.conflicts += 1;
  }
}

async function cleanupMessages(limit: number, counters: MigrationCounters): Promise<void> {
  const messages = await Message.find({
    content: { $exists: true },
    ...completeEnvelopeQuery(MESSAGE_ENVELOPE_FIELDS),
  } as any)
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
  counters.candidates = messages.length;

  for (const message of messages) {
    const content = typeof message.content === 'string' ? message.content : '';
    try {
      if (!content || decryptMessageText(message as any, messageContext(message)) !== content) {
        counters.malformed += 1;
        continue;
      }
      const result = await Message.updateOne(
        {
          _id: message._id,
          content,
          ciphertext: message.ciphertext,
          keyVersion: message.keyVersion,
        },
        { $unset: { content: 1 } },
      );
      if (result.modifiedCount === 1) counters.cleaned += 1;
      else counters.conflicts += 1;
    } catch {
      counters.malformed += 1;
    }
  }
}

async function cleanupConversations(limit: number, counters: MigrationCounters): Promise<void> {
  const conversations = await Conversation.find({
    last_message: { $exists: true, $ne: '' },
    ...completeEnvelopeQuery(PREVIEW_ENVELOPE_FIELDS),
  } as any)
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
  counters.candidates = conversations.length;

  for (const conversation of conversations) {
    const preview = String(conversation.last_message || '');
    try {
      const decrypted = decryptMessageText({
        ciphertext: conversation.lastMessageCiphertext!,
        iv: conversation.lastMessageIv!,
        authTag: conversation.lastMessageAuthTag!,
        keyVersion: conversation.lastMessageKeyVersion!,
      }, previewContext(conversation._id, String(conversation.lastMessageSenderId)));
      if (!preview || decrypted !== preview) {
        counters.malformed += 1;
        continue;
      }
      const result = await Conversation.updateOne(
        {
          _id: conversation._id,
          last_message: preview,
          lastMessageCiphertext: conversation.lastMessageCiphertext,
          lastMessageKeyVersion: conversation.lastMessageKeyVersion,
        },
        { $unset: { last_message: 1 } },
      );
      if (result.modifiedCount === 1) counters.cleaned += 1;
      else counters.conflicts += 1;
    } catch {
      counters.malformed += 1;
    }
  }
}

async function rollbackMessages(limit: number, counters: MigrationCounters): Promise<void> {
  const messages = await Message.find({
    ...completeEnvelopeQuery(MESSAGE_ENVELOPE_FIELDS),
  } as any)
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
  counters.candidates = messages.length;

  for (const message of messages) {
    try {
      const content = decryptMessageText(message as any, messageContext(message));
      const existingPlaintext = typeof message.content === 'string'
        ? message.content
        : undefined;
      if (existingPlaintext !== undefined && existingPlaintext !== content) {
        counters.malformed += 1;
        continue;
      }
      const result = await Message.updateOne(
        {
          _id: message._id,
          content: existingPlaintext === undefined
            ? { $exists: false }
            : existingPlaintext,
          ciphertext: message.ciphertext,
          keyVersion: message.keyVersion,
        },
        {
          $set: { content },
          $unset: {
            ciphertext: 1,
            iv: 1,
            authTag: 1,
            keyVersion: 1,
            searchTokens: 1,
            searchKeyVersion: 1,
          },
        },
      );
      if (result.modifiedCount === 1) counters.rolledBack += 1;
      else counters.conflicts += 1;
    } catch {
      counters.malformed += 1;
    }
  }
}

async function rollbackConversations(limit: number, counters: MigrationCounters): Promise<void> {
  const conversations = await Conversation.find({
    ...completeEnvelopeQuery(PREVIEW_ENVELOPE_FIELDS),
  } as any)
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
  counters.candidates = conversations.length;

  for (const conversation of conversations) {
    try {
      const senderId = String(conversation.lastMessageSenderId);
      const preview = decryptMessageText({
        ciphertext: conversation.lastMessageCiphertext!,
        iv: conversation.lastMessageIv!,
        authTag: conversation.lastMessageAuthTag!,
        keyVersion: conversation.lastMessageKeyVersion!,
      }, previewContext(conversation._id, senderId));
      const result = await Conversation.updateOne(
        {
          _id: conversation._id,
          lastMessageCiphertext: conversation.lastMessageCiphertext,
          lastMessageKeyVersion: conversation.lastMessageKeyVersion,
        },
        {
          $set: { last_message: preview },
          $unset: {
            lastMessageCiphertext: 1,
            lastMessageIv: 1,
            lastMessageAuthTag: 1,
            lastMessageKeyVersion: 1,
            lastMessageSenderId: 1,
          },
        },
      );
      if (result.modifiedCount === 1) counters.rolledBack += 1;
      else counters.conflicts += 1;
    } catch {
      counters.malformed += 1;
    }
  }
}

function messageContext(message: any) {
  return {
    recordType: 'message' as const,
    recordId: String(message._id),
    conversationId: String(message.conversationId),
    senderId: String(message.senderId?._id ?? message.senderId),
  };
}

function previewContext(conversationId: unknown, senderId: string) {
  return {
    recordType: 'conversation_preview' as const,
    recordId: String(conversationId),
    conversationId: String(conversationId),
    senderId,
  };
}

function envelopeState(
  document: object,
  fields: readonly string[],
): 'absent' | 'partial' | 'complete' {
  const values = document as Record<string, unknown>;
  const present = fields.filter(field => Boolean(values[field])).length;
  if (present === 0) return 'absent';
  return present === fields.length ? 'complete' : 'partial';
}

function envelopePresenceQuery(fields: readonly string[]): Record<string, unknown> {
  return {
    $or: fields.map(field => ({ [field]: { $exists: true } })),
  };
}

function completeEnvelopeQuery(fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => [field, { $exists: true }]));
}

function absentEnvelopeQuery(fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => [field, { $exists: false }]));
}

function normalizeLimit(value?: number): number {
  if (!Number.isInteger(value) || Number(value) <= 0) return 500;
  return Math.min(Number(value), 10_000);
}

function createCounters(): MigrationCounters {
  return {
    candidates: 0,
    migrated: 0,
    cleaned: 0,
    rolledBack: 0,
    conflicts: 0,
    malformed: 0,
  };
}
