import '../src/config/env';
import { MongoClient } from 'mongodb';
import {
  type DomainDatabaseNames,
  runDomainDatabaseMigration,
} from '../src/infrastructure/database/domainMigration.service';

async function run(): Promise<void> {
  const uri = requiredEnv('MONGODB_URI');
  const source = databaseNameFromUri(uri);
  const names: DomainDatabaseNames = {
    source,
    core: process.env.MONGODB_CORE_DB?.trim() || 'dreamscape_core',
    knowledge: process.env.MONGODB_KNOWLEDGE_DB?.trim() || 'dreamscape_knowledge',
    operations: process.env.MONGODB_OPERATIONS_DB?.trim() || 'dreamscape_operations',
  };
  const mode = readMode(process.argv);
  assertCopyRunsBeforeCutover(mode);
  const backupDatabase = readArgument(process.argv, '--backup-db');
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const report = await runDomainDatabaseMigration({
      client,
      names,
      mode,
      backupDatabase,
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.close();
  }
}

function readMode(args: string[]): 'inventory' | 'backup' | 'copy' | 'verify' {
  const value = readArgument(args, '--mode') || 'inventory';
  if (value === 'inventory' || value === 'backup' || value === 'copy' || value === 'verify') {
    return value;
  }
  throw new Error('--mode must be inventory, backup, copy, or verify.');
}

function assertCopyRunsBeforeCutover(mode: 'inventory' | 'backup' | 'copy' | 'verify'): void {
  if (mode !== 'copy') return;
  if (process.env.MONGODB_DOMAIN_ROUTING_ENABLED?.trim().toLowerCase() !== 'true') return;
  throw new Error(
    'Copy refused because domain routing is active. Stop the backend and disable '
    + 'MONGODB_DOMAIN_ROUTING_ENABLED before any legacy-to-domain resynchronization.',
  );
}

function readArgument(args: string[], name: string): string | undefined {
  return args.find(argument => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function databaseNameFromUri(uri: string): string {
  const databaseName = new URL(uri).pathname.replace(/^\/+/, '').split('/')[0];
  if (!databaseName) throw new Error('MONGODB_URI must include the legacy database name.');
  return databaseName;
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : 'Domain database migration failed.');
  process.exitCode = 1;
});
