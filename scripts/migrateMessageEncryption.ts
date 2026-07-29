import '../src/config/env';
import mongoose from 'mongoose';
import connectDB from '../src/config/db';
import {
  runMessageEncryptionMigration,
} from '../src/modules/messaging/services/migration/messageEncryptionMigration.service';

async function run(): Promise<void> {
  const rollback = process.argv.includes('--rollback');
  const cleanup = process.argv.includes('--cleanup');
  const apply = process.argv.includes('--apply');
  if (rollback && cleanup) {
    throw new Error('--rollback and --cleanup are mutually exclusive.');
  }
  if (rollback && !apply) {
    throw new Error('--rollback requires --apply.');
  }
  if (cleanup && !apply) {
    throw new Error('--cleanup requires --apply.');
  }
  if (rollback && !process.argv.includes('--confirm-plaintext-rollback')) {
    throw new Error(
      'Rollback restores plaintext. Add --confirm-plaintext-rollback to acknowledge this risk.',
    );
  }

  await connectDB();
  const report = await runMessageEncryptionMigration({
    mode: rollback ? 'rollback' : cleanup ? 'cleanup' : apply ? 'apply' : 'dry-run',
    limitPerCollection: readLimit(process.argv),
  });
  console.log(JSON.stringify(report, null, 2));

  if (
    report.messages.malformed > 0
    || report.conversations.malformed > 0
    || report.verification.incompleteMessageEnvelopes > 0
    || report.verification.incompletePreviewEnvelopes > 0
  ) {
    process.exitCode = 2;
  }
}

function readLimit(args: string[]): number | undefined {
  const value = args.find(argument => argument.startsWith('--limit='))?.split('=')[1];
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

run()
  .catch(error => {
    console.error(error instanceof Error ? error.message : 'Message migration failed.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
