import mongoose from 'mongoose';
import dotenv from 'dotenv';
import VerifiedKnowledgeRule from '../src/models/VerifiedKnowledgeRule';
import { logger } from '../src/utils/logger';

dotenv.config();

async function run() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dreamscape';
  try {
    logger.warn('==================================================');
    logger.warn('DEV ONLY: reactivating seed rules for testing.');
    logger.warn('==================================================');
    
    logger.info('Connecting to database...');
    await mongoose.connect(mongoUri);

    logger.info('Reactivating seed knowledge rules...');
    
    // Activate seed rules
    const updateResult = await VerifiedKnowledgeRule.updateMany(
      { origin: 'seed' },
      { $set: { isActive: true } }
    );
    
    logger.info(`Reactivation completed:`);
    logger.info(`- Seed rules reactivated: ${updateResult.modifiedCount}`);

  } catch (err: any) {
    logger.error('Failed to reactivate seed knowledge rules:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    logger.info('Database connection closed.');
  }
}

run().catch((err) => {
  console.error('Unhandled fatal error in reactivation script:', err);
  process.exit(1);
});
