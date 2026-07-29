import { createHash } from 'crypto';
import {
  BSON,
  type Collection,
  type CreateIndexesOptions,
  type IndexSpecification,
  type MongoClient,
  type Document,
} from 'mongodb';
import {
  classifiedCollections,
  DATABASE_DOMAIN_COLLECTIONS,
  domainForCollection,
  LEGACY_COLLECTIONS,
  RETIRED_COLLECTIONS,
  type DatabaseDomain,
} from './domainManifest';

export interface DomainDatabaseNames {
  source: string;
  core: string;
  knowledge: string;
  operations: string;
}

export interface CollectionInventory {
  collection: string;
  domain: DatabaseDomain | 'legacy' | 'retired' | 'unclassified';
  documents: number;
}

export interface DatabaseInventory {
  sourceDatabase: string;
  targets: Omit<DomainDatabaseNames, 'source'>;
  collections: CollectionInventory[];
}

export interface CollectionVerification {
  collection: string;
  sourceCount: number;
  targetCount: number;
  sourceDigest: string;
  targetDigest: string;
  valid: boolean;
}

export interface DomainMigrationReport {
  mode: 'inventory' | 'backup' | 'copy' | 'verify';
  inventory: DatabaseInventory;
  backupDatabase?: string;
  verification?: Record<DatabaseDomain, CollectionVerification[]>;
}

export async function runDomainDatabaseMigration(input: {
  client: MongoClient;
  names: DomainDatabaseNames;
  mode: DomainMigrationReport['mode'];
  backupDatabase?: string;
}): Promise<DomainMigrationReport> {
  assertSafeDatabaseNames(input.names);
  const inventory = await inspectDomainDatabase(input.client, input.names);
  assertInventoryCanMigrate(inventory);

  if (input.mode === 'inventory') {
    return { mode: input.mode, inventory };
  }

  if (input.mode === 'backup') {
    const backupDatabase = requiredBackupName(input.backupDatabase, input.names);
    await copyWholeDatabase(input.client, input.names.source, backupDatabase);
    await verifyWholeDatabase(input.client, input.names.source, backupDatabase);
    return { mode: input.mode, inventory, backupDatabase };
  }

  if (input.mode === 'copy') {
    await copyDomains(input.client, input.names);
  }

  const verification = await verifyDomains(input.client, input.names);
  assertVerificationPassed(verification);
  return { mode: input.mode, inventory, verification };
}

export async function inspectDomainDatabase(
  client: MongoClient,
  names: DomainDatabaseNames,
): Promise<DatabaseInventory> {
  const source = client.db(names.source);
  const listed = await source.listCollections({}, { nameOnly: true }).toArray();
  const known = classifiedCollections();
  const collections: CollectionInventory[] = [];

  for (const item of listed.sort((left, right) => left.name.localeCompare(right.name))) {
    const documents = await source.collection(item.name).estimatedDocumentCount();
    const domain = domainForCollection(item.name)
      ?? (LEGACY_COLLECTIONS.includes(item.name as never)
        ? 'legacy'
        : RETIRED_COLLECTIONS.includes(item.name as never) ? 'retired' : 'unclassified');
    collections.push({
      collection: item.name,
      domain: known.has(item.name) ? domain : 'unclassified',
      documents,
    });
  }

  return {
    sourceDatabase: names.source,
    targets: {
      core: names.core,
      knowledge: names.knowledge,
      operations: names.operations,
    },
    collections,
  };
}

function assertInventoryCanMigrate(inventory: DatabaseInventory): void {
  const unknown = inventory.collections.filter(item => item.domain === 'unclassified');
  if (unknown.length) {
    throw new Error(
      `Migration stopped: unclassified collections found (${unknown.map(item => item.collection).join(', ')}).`,
    );
  }

  const populatedLegacy = inventory.collections.filter(
    item => item.domain === 'legacy' && item.documents > 0,
  );
  if (populatedLegacy.length) {
    throw new Error(
      `Migration stopped: legacy collections contain data (${populatedLegacy
        .map(item => `${item.collection}:${item.documents}`)
        .join(', ')}). Classify them explicitly before copying.`,
    );
  }
}

async function copyWholeDatabase(
  client: MongoClient,
  sourceName: string,
  targetName: string,
): Promise<void> {
  const target = client.db(targetName);
  const existing = await target.listCollections({}, { nameOnly: true }).toArray();
  if (existing.length) {
    throw new Error(`Backup database ${targetName} already contains collections.`);
  }

  const sourceCollections = await client
    .db(sourceName)
    .listCollections({}, { nameOnly: true })
    .toArray();
  for (const { name } of sourceCollections) {
    await copyCollection(client, sourceName, targetName, name);
  }
}

async function copyDomains(client: MongoClient, names: DomainDatabaseNames): Promise<void> {
  for (const domain of Object.keys(DATABASE_DOMAIN_COLLECTIONS) as DatabaseDomain[]) {
    const targetName = names[domain];
    for (const collectionName of DATABASE_DOMAIN_COLLECTIONS[domain]) {
      if (!await collectionExists(client, names.source, collectionName)) continue;
      await copyCollection(client, names.source, targetName, collectionName);
    }
  }
}

async function copyCollection(
  client: MongoClient,
  sourceName: string,
  targetName: string,
  collectionName: string,
): Promise<void> {
  const source = client.db(sourceName).collection(collectionName);
  const targetDb = client.db(targetName);
  if (!await collectionExists(client, targetName, collectionName)) {
    await targetDb.createCollection(collectionName);
  }
  const target = targetDb.collection(collectionName);

  const cursor = source.find({}, { sort: { _id: 1 }, batchSize: 250 });
  let batch: Document[] = [];
  for await (const document of cursor) {
    batch.push(document);
    if (batch.length === 250) {
      await upsertDocuments(target, batch);
      batch = [];
    }
  }
  if (batch.length) await upsertDocuments(target, batch);
  await copyIndexes(source, target);
}

async function upsertDocuments(target: Collection, documents: Document[]): Promise<void> {
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

async function copyIndexes(source: Collection, target: Collection): Promise<void> {
  const indexes = await source.indexes();
  for (const index of indexes) {
    if (index.name === '_id_') continue;
    const options = copyIndexOptions(index);
    await target.createIndex(index.key as IndexSpecification, options);
  }
}

function copyIndexOptions(index: Document): CreateIndexesOptions {
  const allowed = [
    'name',
    'unique',
    'sparse',
    'expireAfterSeconds',
    'partialFilterExpression',
    'collation',
    'hidden',
  ] as const;
  const options: CreateIndexesOptions = {};
  for (const key of allowed) {
    if (index[key] !== undefined) (options as Record<string, unknown>)[key] = index[key];
  }
  return options;
}

async function verifyWholeDatabase(
  client: MongoClient,
  sourceName: string,
  targetName: string,
): Promise<void> {
  const sourceCollections = await client
    .db(sourceName)
    .listCollections({}, { nameOnly: true })
    .toArray();
  for (const { name } of sourceCollections) {
    const result = await verifyCollection(client, sourceName, targetName, name);
    if (!result.valid) {
      throw new Error(`Backup verification failed for ${name}.`);
    }
  }
}

async function verifyDomains(
  client: MongoClient,
  names: DomainDatabaseNames,
): Promise<Record<DatabaseDomain, CollectionVerification[]>> {
  const result: Record<DatabaseDomain, CollectionVerification[]> = {
    core: [],
    knowledge: [],
    operations: [],
  };
  for (const domain of Object.keys(DATABASE_DOMAIN_COLLECTIONS) as DatabaseDomain[]) {
    for (const collectionName of DATABASE_DOMAIN_COLLECTIONS[domain]) {
      if (!await collectionExists(client, names.source, collectionName)) continue;
      result[domain].push(
        await verifyCollection(client, names.source, names[domain], collectionName),
      );
    }
  }
  return result;
}

async function verifyCollection(
  client: MongoClient,
  sourceName: string,
  targetName: string,
  collectionName: string,
): Promise<CollectionVerification> {
  const source = client.db(sourceName).collection(collectionName);
  const target = client.db(targetName).collection(collectionName);
  const [sourceCount, targetCount, sourceDigest, targetDigest] = await Promise.all([
    source.countDocuments(),
    target.countDocuments(),
    collectionDigest(source),
    collectionDigest(target),
  ]);
  return {
    collection: collectionName,
    sourceCount,
    targetCount,
    sourceDigest,
    targetDigest,
    valid: sourceCount === targetCount && sourceDigest === targetDigest,
  };
}

async function collectionDigest(collection: Collection): Promise<string> {
  const hash = createHash('sha256');
  const cursor = collection.find({}, { sort: { _id: 1 }, batchSize: 250 });
  for await (const document of cursor) {
    hash.update(BSON.EJSON.stringify(document, { relaxed: false }));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function assertVerificationPassed(
  verification: Record<DatabaseDomain, CollectionVerification[]>,
): void {
  const failed = Object.values(verification).flat().filter(item => !item.valid);
  if (failed.length) {
    throw new Error(
      `Domain verification failed (${failed.map(item => item.collection).join(', ')}). Legacy data was not changed.`,
    );
  }
}

function assertSafeDatabaseNames(names: DomainDatabaseNames): void {
  const values = Object.values(names);
  if (values.some(value => !value.trim())) {
    throw new Error('Every source and target database name is required.');
  }
  if (new Set(values).size !== values.length) {
    throw new Error('Source, core, knowledge, and operations database names must be distinct.');
  }
}

function requiredBackupName(
  backupDatabase: string | undefined,
  names: DomainDatabaseNames,
): string {
  const value = backupDatabase?.trim();
  if (!value) throw new Error('--backup-db is required in backup mode.');
  if (Object.values(names).includes(value)) {
    throw new Error('Backup database must be distinct from source and domain databases.');
  }
  return value;
}

async function collectionExists(
  client: MongoClient,
  databaseName: string,
  collectionName: string,
): Promise<boolean> {
  const rows = await client
    .db(databaseName)
    .listCollections({ name: collectionName }, { nameOnly: true })
    .toArray();
  return rows.length > 0;
}
