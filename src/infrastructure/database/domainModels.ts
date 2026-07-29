import mongoose, {
  type Connection,
  type Document,
  type Model,
  type Schema,
} from 'mongoose';
import type { DatabaseDomain } from './domainManifest';

const DEFAULT_DATABASE_NAMES: Record<DatabaseDomain, string> = {
  core: 'dreamscape_core',
  knowledge: 'dreamscape_knowledge',
  operations: 'dreamscape_operations',
};

export function domainRoutingEnabled(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  return process.env.MONGODB_DOMAIN_ROUTING_ENABLED?.trim().toLowerCase() === 'true';
}

export function domainDatabaseName(domain: DatabaseDomain): string {
  const key = `MONGODB_${domain.toUpperCase()}_DB`;
  return process.env[key]?.trim() || DEFAULT_DATABASE_NAMES[domain];
}

export function connectionForDomain(domain: DatabaseDomain): Connection {
  if (!domainRoutingEnabled() || domain === 'core') return mongoose.connection;
  return mongoose.connection.useDb(domainDatabaseName(domain), { useCache: true });
}

export function modelForDomain<T extends Document>(
  domain: DatabaseDomain,
  name: string,
  schema: Schema<T>,
): Model<T> {
  const connection = connectionForDomain(domain);
  return (connection.models[name] as Model<T> | undefined)
    ?? connection.model<T>(name, schema);
}

export async function waitForDomainConnections(): Promise<void> {
  if (!domainRoutingEnabled()) return;
  await Promise.all([
    connectionForDomain('knowledge').asPromise(),
    connectionForDomain('operations').asPromise(),
  ]);
}
