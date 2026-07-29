import '../src/config/env';
import { createHash } from 'crypto';
import {
  BSON,
  type Collection,
  type Document,
  type IndexSpecification,
  MongoClient,
} from 'mongodb';
import { ORACLE_RUN_EVENT_RETENTION_MS } from '../src/config/oracleConfig';

const OPERATIONAL_COLLECTIONS = ['oracleruns', 'oraclerunevents'] as const;
const RETIRED_FEEDBACK_COLLECTION = 'oraclerulefeedbacks';
const THREAD_COLLECTION = 'oraclethreads';

interface MigrationContext {
  client: MongoClient;
  coreName: string;
  operationsName: string;
  backupName: string;
  dropBackupOnSuccess: boolean;
}

async function run(): Promise<void> {
  const context = await prepareMigration();
  try {
    await createVerifiedBackup(context);
    await copyOperationalCollections(context);
    await verifyOperationalCopies(context);
    await cleanCoreOracleData(context);
    await applyOperationalRetention(context);
    await verifyFinalState(context);
    if (context.dropBackupOnSuccess) {
      await context.client.db(context.backupName).dropDatabase();
    }
    printCompletion(context);
  } catch (error) {
    console.error(
      `Oracle domain migration stopped. Backup kept at ${context.backupName}.`,
    );
    throw error;
  } finally {
    await context.client.close();
  }
}

async function prepareMigration(): Promise<MigrationContext> {
  const uri = requiredEnv('MONGODB_URI');
  const coreName = process.env.MONGODB_CORE_DB?.trim() || 'dreamscape_core';
  const operationsName = process.env.MONGODB_OPERATIONS_DB?.trim() || 'dreamscape_operations';
  const backupName = requiredArgument('--backup-db');
  const dropBackupOnSuccess = process.argv.includes('--drop-backup-on-success');
  if (!process.argv.includes('--confirm-backend-stopped')) {
    throw new Error('Pass --confirm-backend-stopped after stopping the backend.');
  }
  if (new Set([coreName, operationsName, backupName]).size !== 3) {
    throw new Error('Core, operations, and backup database names must be different.');
  }

  const client = new MongoClient(uri);
  await client.connect();
  return { client, coreName, operationsName, backupName, dropBackupOnSuccess };
}

async function createVerifiedBackup(context: MigrationContext): Promise<void> {
  const backupDb = context.client.db(context.backupName);
  const existing = await backupDb.listCollections({}, { nameOnly: true }).toArray();
  if (existing.length) {
    throw new Error(`Backup database ${context.backupName} is not empty.`);
  }

  const core = context.client.db(context.coreName);
  for (const name of [
    ...OPERATIONAL_COLLECTIONS,
    THREAD_COLLECTION,
    RETIRED_FEEDBACK_COLLECTION,
  ]) {
    await copyCollection(core.collection(name), backupDb.collection(name));
    await assertCollectionsEqual(core.collection(name), backupDb.collection(name));
  }
}

async function copyOperationalCollections(context: MigrationContext): Promise<void> {
  const core = context.client.db(context.coreName);
  const operations = context.client.db(context.operationsName);
  for (const name of OPERATIONAL_COLLECTIONS) {
    await copyCollection(core.collection(name), operations.collection(name));
  }
}

async function verifyOperationalCopies(context: MigrationContext): Promise<void> {
  const core = context.client.db(context.coreName);
  const operations = context.client.db(context.operationsName);
  for (const name of OPERATIONAL_COLLECTIONS) {
    const source = core.collection(name);
    const ids = await readIds(source);
    await assertCollectionsEqual(source, operations.collection(name), ids);
  }
}

async function cleanCoreOracleData(context: MigrationContext): Promise<void> {
  const core = context.client.db(context.coreName);
  for (const name of OPERATIONAL_COLLECTIONS) {
    const collection = core.collection(name);
    const ids = await readIds(collection);
    if (ids.length) await collection.deleteMany({ _id: { $in: ids } });
  }

  await core.collection(THREAD_COLLECTION).updateMany(
    { attachedDreamIds: { $exists: true } },
    { $unset: { attachedDreamIds: '' } },
  );
  await core.collection(RETIRED_FEEDBACK_COLLECTION).deleteMany({});
}

async function applyOperationalRetention(context: MigrationContext): Promise<void> {
  const events = context.client.db(context.operationsName).collection('oraclerunevents');
  const withoutExpiry = events.find({ expiresAt: { $exists: false } });
  const updates: Array<{
    updateOne: {
      filter: { _id: unknown };
      update: { $set: { expiresAt: Date } };
    };
  }> = [];

  for await (const event of withoutExpiry) {
    const createdAt = event.createdAt instanceof Date ? event.createdAt : new Date();
    updates.push({
      updateOne: {
        filter: { _id: event._id },
        update: {
          $set: {
            expiresAt: new Date(createdAt.getTime() + ORACLE_RUN_EVENT_RETENTION_MS),
          },
        },
      },
    });
  }
  if (updates.length) await events.bulkWrite(updates, { ordered: false });
}

async function verifyFinalState(context: MigrationContext): Promise<void> {
  const core = context.client.db(context.coreName);
  const operations = context.client.db(context.operationsName);
  const backup = context.client.db(context.backupName);

  for (const name of OPERATIONAL_COLLECTIONS) {
    const sourceCount = await core.collection(name).countDocuments();
    if (sourceCount !== 0) throw new Error(`${name} still contains ${sourceCount} core records.`);

    const backupIds = await readIds(backup.collection(name));
    await assertCollectionsEqual(
      backup.collection(name),
      operations.collection(name),
      backupIds,
      name === 'oraclerunevents' ? ['expiresAt'] : [],
    );
  }

  const attachedCount = await core
    .collection(THREAD_COLLECTION)
    .countDocuments({ attachedDreamIds: { $exists: true } });
  if (attachedCount !== 0) throw new Error('attachedDreamIds cleanup did not finish.');

  const retiredCount = await core.collection(RETIRED_FEEDBACK_COLLECTION).countDocuments();
  if (retiredCount !== 0) throw new Error('Retired Oracle feedback still exists in core.');
}

async function copyCollection(source: Collection, target: Collection): Promise<void> {
  const documents = await source.find({}).sort({ _id: 1 }).toArray();
  if (documents.length) {
    await target.bulkWrite(
      documents.map((document) => ({
        replaceOne: {
          filter: { _id: document._id },
          replacement: document,
          upsert: true,
        },
      })),
      { ordered: false },
    );
  } else {
    await ensureCollectionExists(target);
  }
  await copyIndexes(source, target);
}

async function ensureCollectionExists(collection: Collection): Promise<void> {
  const exists = await collection.db
    .listCollections({ name: collection.collectionName }, { nameOnly: true })
    .hasNext();
  if (!exists) await collection.db.createCollection(collection.collectionName);
}

async function copyIndexes(source: Collection, target: Collection): Promise<void> {
  if (!await collectionExists(source)) return;
  const indexes = await source.indexes();
  for (const index of indexes) {
    if (index.name === '_id_') continue;
    const options: Record<string, unknown> = { name: index.name };
    for (const key of [
      'unique',
      'sparse',
      'expireAfterSeconds',
      'partialFilterExpression',
    ] as const) {
      if (index[key] !== undefined && index[key] !== null) {
        options[key] = index[key];
      }
    }
    await target.createIndex(index.key as IndexSpecification, options);
  }
}

async function assertCollectionsEqual(
  expected: Collection,
  actual: Collection,
  ids?: unknown[],
  ignoredFields: string[] = [],
): Promise<void> {
  const filter = ids ? { _id: { $in: ids } } : {};
  const [expectedDocuments, actualDocuments] = await Promise.all([
    expected.find(filter).sort({ _id: 1 }).toArray(),
    actual.find(filter).sort({ _id: 1 }).toArray(),
  ]);
  if (expectedDocuments.length !== actualDocuments.length) {
    throw new Error(
      `${expected.collectionName} verification count mismatch: `
      + `${expectedDocuments.length} != ${actualDocuments.length}.`,
    );
  }
  const expectedDigest = digestDocuments(expectedDocuments, ignoredFields);
  const actualDigest = digestDocuments(actualDocuments, ignoredFields);
  if (expectedDigest !== actualDigest) {
    throw new Error(`${expected.collectionName} verification digest mismatch.`);
  }
}

function digestDocuments(documents: Document[], ignoredFields: string[]): string {
  const hash = createHash('sha256');
  for (const document of documents) {
    const comparable = { ...document };
    for (const field of ignoredFields) delete comparable[field];
    hash.update(BSON.serialize(comparable));
  }
  return hash.digest('hex');
}

async function readIds(collection: Collection): Promise<unknown[]> {
  return (await collection.find({}, { projection: { _id: 1 } }).toArray())
    .map((document) => document._id);
}

async function collectionExists(collection: Collection): Promise<boolean> {
  return collection.db
    .listCollections({ name: collection.collectionName }, { nameOnly: true })
    .hasNext();
}

function requiredArgument(name: string): string {
  const value = process.argv.find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .trim();
  if (!value) throw new Error(`${name}=<database> is required.`);
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function printCompletion(context: MigrationContext): void {
  console.log(JSON.stringify({
    success: true,
    core: context.coreName,
    operations: context.operationsName,
    retiredCollection: RETIRED_FEEDBACK_COLLECTION,
    removedThreadField: 'attachedDreamIds',
    backup: context.dropBackupOnSuccess ? 'deleted-after-verification' : context.backupName,
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Oracle domain migration failed.');
  process.exitCode = 1;
});
