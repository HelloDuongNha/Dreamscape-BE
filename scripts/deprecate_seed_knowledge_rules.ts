import mongoose from 'mongoose';
import dotenv from 'dotenv';
import KnowledgeRule from '../src/models/KnowledgeRule';
import { logger } from '../src/utils/logger';

dotenv.config();

async function run() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dreamscape';
  try {
    logger.info('Connecting to database...');
    await mongoose.connect(mongoUri);

    logger.info('Deprecating seed knowledge rules...');
    
    // Find count of seed rules to deactivate
    const seedCount = await KnowledgeRule.countDocuments({ origin: 'seed' });
    
    // Deactivate seed rules
    const updateResult = await KnowledgeRule.updateMany(
      { origin: 'seed' },
      { $set: { isActive: false } }
    );
    
    // Count manual or source_generated rules
    const preservedCount = await KnowledgeRule.countDocuments({
      origin: { $in: ['manual', 'source_generated'] }
    });

    logger.info(`Deactivation completed:`);
    logger.info(`- Seed rules deactivated: ${updateResult.modifiedCount} (out of ${seedCount} total seed rules)`);
    logger.info(`- Manual and source_generated rules preserved: ${preservedCount}`);

  } catch (err: any) {
    logger.error('Failed to deprecate seed knowledge rules:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    logger.info('Database connection closed.');
  }
}

run().catch((err) => {
  console.error('Unhandled fatal error in deprecation script:', err);
  process.exit(1);
});
