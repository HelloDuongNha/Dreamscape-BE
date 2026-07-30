import '../src/config/env';
import { createHash } from 'crypto';
import {
  BSON,
  type Collection,
  type Document,
  type IndexSpecification,
  MongoClient,
} from 'mongodb';
import {
  DATABASE_DOMAIN_COLLECTIONS,
  type DatabaseDomain,
} from '../src/infrastructure/database/domainManifest';

const MOVED_DOMAINS = ['knowledge', 'operations'] as const;
const RETIRED_CORE_COLLECTIONS = ['user_dream_profiles'] as const;

interface MigrationContext {
  client: MongoClient;
  coreName: string;
  knowledgeName: string;
  operationsName: string;
  backupName: string;
  dropBackupOnSuccess: boolean;
}

async function run(): Promise<void> {
  const context = await prepareMigration();
  try {
    await createVerifiedBackup(context);
    await assertNoConflictingIds(context);
    await copyMisroutedCollections(context);
    await verifyCopiesAndSourceSnapshot(context);
    await cleanCore(context);
    await verifyFinalState(context);
    if (context.dropBackupOnSuccess) {
      await context.client.db(context.backupName).dropDatabase();
    }
    console.log(JSON.stringify(await buildReport(context), null, 2));
  } catch (error) {
    console.error(`Domain migration stopped. Backup kept at ${context.backupName}.`);
    throw error;
  } finally {
    await context.client.close();
  }
}

async function prepareMigration(): Promise<MigrationContext> {
  if (!process.argv.includes('--confirm-backend-stopped')) {
    throw new Error('Pass --confirm-backend-stopped only after local and deployed backends are stopped.');
  }

  const uri = requiredEnv('MONGODB_URI');
  const coreName = process.env.MONGODB_CORE_DB?.trim() || 'dreamscape_core';
  const knowledgeName = process.env.MONGODB_KNOWLEDGE_DB?.trim() || 'dreamscape_knowledge';
  const operationsName = process.env.MONGODB_OPERATIONS_DB?.trim() || 'dreamscape_operations';
  const backupName = requiredArgument('--backup-db');
  if (new Set([coreName, knowledgeName, operationsName, backupName]).size !== 4) {
    throw new Error('Core, knowledge, operations, and backup database names must be distinct.');
  }

  const client = new MongoClient(uri);
  await client.connect();
  return {
    client,
    coreName,
    knowledgeName,
    operationsName,
    backupName,
    dropBackupOnSuccess: process.argv.includes('--drop-backup-on-success'),
  };
}

async function createVerifiedBackup(context: MigrationContext): Promise<void> {
  const backup = context.client.db(context.backupName);
  if (await backup.listCollections({}, { nameOnly: true }).hasNext()) {
    throw new Error(`Backup database ${context.backupName} is not empty.`);
  }

  const core = context.client.db(context.coreName);
  for (const name of [...movedCollections(), ...RETIRED_CORE_COLLECTIONS]) {
    await copyCollection(core.collection(name), backup.collection(backupName('core', name)));
    await assertCollectionsEqual(
      core.collection(name),
      backup.collection(backupName('core', name)),
    );
  }

  for (const domain of MOVED_DOMAINS) {
    const target = context.client.db(databaseName(context, domain));
    for (const name of DATABASE_DOMAIN_COLLECTIONS[domain]) {
      await copyCollection(
        target.collection(name),
        backup.collection(backupName(domain, name)),
      );
      await assertCollectionsEqual(
        target.collection(name),
        backup.collection(backupName(domain, name)),
      );
    }
  }
}

async function assertNoConflictingIds(context: MigrationContext): Promise<void> {
  const core = context.client.db(context.coreName);
  for (const domain of MOVED_DOMAINS) {
    const target = context.client.db(databaseName(context, domain));
    for (const name of DATABASE_DOMAIN_COLLECTIONS[domain]) {
      const sourceDocuments = await core.collection(name).find({}).toArray();
      if (!sourceDocuments.length) continue;
      const targetDocuments = await target.collection(name).find({
        _id: { $in: sourceDocuments.map(document => document._id) },
      }).toArray();
      const targetById = new Map(
        targetDocuments.map(document => [String(document._id), document]),
      );
      for (const document of sourceDocuments) {
        const existing = targetById.get(String(document._id));
        if (existing && digestDocuments([document]) !== digestDocuments([existing])) {
          throw new Error(`${name} has conflicting data for _id ${String(document._id)}.`);
        }
      }
    }
  }
}

async function copyMisroutedCollections(context: MigrationContext): Promise<void> {
  const core = context.client.db(context.coreName);
  for (const domain of MOVED_DOMAINS) {
    const target = context.client.db(databaseName(context, domain));
    for (const name of DATABASE_DOMAIN_COLLECTIONS[domain]) {
      await copyCollection(core.collection(name), target.collection(name));
    }
  }
}

async function verifyCopiesAndSourceSnapshot(context: MigrationContext): Promise<void> {
  const core = context.client.db(context.coreName);
  const backup = context.client.db(context.backupName);
  for (const domain of MOVED_DOMAINS) {
    const target = context.client.db(databaseName(context, domain));
    for (const name of DATABASE_DOMAIN_COLLECTIONS[domain]) {
      const sourceBackup = backup.collection(backupName('core', name));
      const sourceIds = await readIds(sourceBackup);
      await assertCollectionsEqual(sourceBackup, core.collection(name));
      await assertCollectionsEqual(sourceBackup, target.collection(name), sourceIds);

      const targetBackup = backup.collection(backupName(domain, name));
      const targetIds = await readIds(targetBackup);
      await assertCollectionsEqual(targetBackup, target.collection(name), targetIds);
    }
  }

  for (const name of RETIRED_CORE_COLLECTIONS) {
    await assertCollectionsEqual(
      backup.collection(backupName('core', name)),
      core.collection(name),
    );
  }
}

async function cleanCore(context: MigrationContext): Promise<void> {
  const core = context.client.db(context.coreName);
  const backup = context.client.db(context.backupName);
  for (const name of [...movedCollections(), ...RETIRED_CORE_COLLECTIONS]) {
    const collection = core.collection(name);
    const ids = await readIds(backup.collection(backupName('core', name)));
    if (ids.length) await collection.deleteMany({ _id: { $in: ids } });
    if (await collection.countDocuments() === 0 && await collectionExists(collection)) {
      await collection.drop();
    }
  }
}

async function verifyFinalState(context: MigrationContext): Promise<void> {
  const core = context.client.db(context.coreName);
  const backup = context.client.db(context.backupName);

  for (const name of [...movedCollections(), ...RETIRED_CORE_COLLECTIONS]) {
    if (await collectionExists(core.collection(name))) {
      throw new Error(`${name} still exists in ${context.coreName}.`);
    }
  }

  for (const domain of MOVED_DOMAINS) {
    const target = context.client.db(databaseName(context, domain));
    for (const name of DATABASE_DOMAIN_COLLECTIONS[domain]) {
      const sourceBackup = backup.collection(backupName('core', name));
      await assertCollectionsEqual(
        sourceBackup,
        target.collection(name),
        await readIds(sourceBackup),
      );
      const targetBackup = backup.collection(backupName(domain, name));
      await assertCollectionsEqual(
        targetBackup,
        target.collection(name),
        await readIds(targetBackup),
      );
    }
  }
}

async function buildReport(context: MigrationContext) {
  const report: Record<string, Record<string, number>> = {};
  for (const domain of ['core', ...MOVED_DOMAINS] as const) {
    const db = context.client.db(
      domain === 'core' ? context.coreName : databaseName(context, domain),
    );
    report[domain] = {};
    const names = domain === 'core'
      ? DATABASE_DOMAIN_COLLECTIONS.core
      : DATABASE_DOMAIN_COLLECTIONS[domain];
    for (const name of names) {
      if (await collectionExists(db.collection(name))) {
        report[domain][name] = await db.collection(name).countDocuments();
      }
    }
  }
  return {
    status: 'completed',
    backupDatabase: context.dropBackupOnSuccess ? 'verified-and-removed' : context.backupName,
    collections: report,
  };
}

async function copyCollection(source: Collection, target: Collection): Promise<void> {
  const documents = await source.find({}).sort({ _id: 1 }).toArray();
  await ensureCollectionExists(target);
  if (documents.length) {
    await target.bulkWrite(
      documents.map(document => ({
        replaceOne: {
          filter: { _id: document._id },
          replacement: document,
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  await copyIndexes(source, target);
}

async function copyIndexes(source: Collection, target: Collection): Promise<void> {
  if (!await collectionExists(source)) return;
  for (const index of await source.indexes()) {
    if (index.name === '_id_') continue;
    const options: Record<string, unknown> = { name: index.name };
    for (const key of [
      'unique',
      'sparse',
      'expireAfterSeconds',
      'partialFilterExpression',
      'collation',
      'hidden',
    ] as const) {
      if (index[key] !== undefined && index[key] !== null) options[key] = index[key];
    }
    await target.createIndex(index.key as IndexSpecification, options);
  }
}

async function assertCollectionsEqual(
  expected: Collection,
  actual: Collection,
  ids?: unknown[],
): Promise<void> {
  const filter = ids ? { _id: { $in: ids } } : {};
  const [expectedDocuments, actualDocuments] = await Promise.all([
    expected.find(filter).sort({ _id: 1 }).toArray(),
    actual.find(filter).sort({ _id: 1 }).toArray(),
  ]);
  if (
    expectedDocuments.length !== actualDocuments.length
    || digestDocuments(expectedDocuments) !== digestDocuments(actualDocuments)
  ) {
    throw new Error(
      `${expected.collectionName} verification failed against ${actual.collectionName}.`,
    );
  }
}

function digestDocuments(documents: Document[]): string {
  const hash = createHash('sha256');
  for (const document of documents) {
    hash.update(BSON.EJSON.stringify(document, { relaxed: false }));
    hash.update('\n');
  }
  return hash.digest('hex');
}

async function readIds(collection: Collection): Promise<unknown[]> {
  return (await collection.find({}, { projection: { _id: 1 } }).toArray())
    .map(document => document._id);
}

async function ensureCollectionExists(collection: Collection): Promise<void> {
  if (!await collectionExists(collection)) {
    await collection.db.createCollection(collection.collectionName);
  }
}

async function collectionExists(collection: Collection): Promise<boolean> {
  return collection.db
    .listCollections({ name: collection.collectionName }, { nameOnly: true })
    .hasNext();
}

function movedCollections(): string[] {
  return MOVED_DOMAINS.flatMap(domain => [...DATABASE_DOMAIN_COLLECTIONS[domain]]);
}

function databaseName(
  context: MigrationContext,
  domain: Extract<DatabaseDomain, 'knowledge' | 'operations'>,
): string {
  return domain === 'knowledge' ? context.knowledgeName : context.operationsName;
}

function backupName(domain: 'core' | typeof MOVED_DOMAINS[number], name: string): string {
  return `${domain}__${name}`;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredArgument(name: string): string {
  const prefix = `${name}=`;
  const value = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : 'Domain migration failed.');
  process.exitCode = 1;
});
