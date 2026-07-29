import mongoose from 'mongoose';

export function assertIsolatedTestDatabase(uri: string): void {
  const databaseName = databaseNameFromUri(uri);
  if (!databaseName || !/(?:^|[-_])test$/i.test(databaseName)) {
    throw new Error(
      'Integration tests require a dedicated MongoDB database whose name ends in "-test" or "_test".',
    );
  }
}

export async function connectTestDatabase(): Promise<void> {
  const uri = process.env.MONGODB_TEST_URI?.trim();
  if (!uri) {
    throw new Error('MONGODB_TEST_URI is required for database integration tests.');
  }

  assertIsolatedTestDatabase(uri);
  await mongoose.connect(uri);
}

export async function disconnectTestDatabase(): Promise<void> {
  await mongoose.disconnect();
}

function databaseNameFromUri(uri: string): string {
  try {
    return new URL(uri).pathname.replace(/^\/+/, '').split('/')[0] || '';
  } catch {
    return '';
  }
}
