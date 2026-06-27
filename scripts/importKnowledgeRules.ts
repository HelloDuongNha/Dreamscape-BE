import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import VerifiedKnowledgeRule from '../src/models/VerifiedKnowledgeRule';
import { logger } from '../src/utils/logger';

// Load environment variables
dotenv.config();

const SEED_FILE_PATH = path.join(__dirname, '../src/data/knowledgeRules.seed.json');

async function importRules() {
  logger.info('Initializing Knowledge Base seed injection...');
  logger.warn('WARNING: This imports legacy seed rules for development/reference only. Seed rules are not the live Component D source of truth.');

  // 1. Production Purge Guard
  const isProduction = process.env.NODE_ENV === 'production';
  const hasOverride = process.env.SEED_CONFIRM === 'true';

  if (isProduction && !hasOverride) {
    const errorMsg = 'FATAL: Cannot run seeding script in production environment without SEED_CONFIRM=true override flag.';
    logger.error(errorMsg, new Error('Production environment block'));
    process.exit(1);
  }

  // 2. Read and parse JSON
  let rawData: string;
  try {
    rawData = fs.readFileSync(SEED_FILE_PATH, 'utf-8');
  } catch (err: any) {
    logger.error(`Failed to read seed file from path: ${SEED_FILE_PATH}`, err);
    process.exit(1);
  }

  let rules: any[];
  try {
    rules = JSON.parse(rawData);
  } catch (err: any) {
    logger.error('Failed to parse seed file JSON content.', err);
    process.exit(1);
  }

  if (!Array.isArray(rules)) {
    const errorMsg = 'Seed file must contain an array of rules.';
    logger.error(errorMsg, new Error('Invalid JSON structure'));
    process.exit(1);
  }

  // Enums for validation
  const allowedGroups = ['sleep_context', 'dream_psychology', 'personality_knowledge', 'cultural_limitation'];
  const allowedClaimStrengths = [
    'association_not_causation',
    'possible_contributing_factor',
    'interpretive_framework',
    'hypothesis_not_diagnosis',
    'epistemic_boundary_rule',
  ];
  const allowedReliabilityLevels = ['scientific_established', 'scientific_limited', 'cultural_symbolic'];

  // 3. Strict Quality Validation Loop
  for (const rule of rules) {
    const ruleId = rule._id || 'unknown';

    // confidenceCap validation
    if (typeof rule.confidenceCap !== 'number' || rule.confidenceCap < 0.0 || rule.confidenceCap > 1.0) {
      throw new Error(
        `Validation Error on rule '${ruleId}': confidenceCap must be a strict float between 0.0 and 1.0. Found: ${rule.confidenceCap}`
      );
    }

    // isActive validation
    if (typeof rule.isActive !== 'boolean') {
      throw new Error(
        `Validation Error on rule '${ruleId}': isActive must be a strict boolean. Found: ${typeof rule.isActive}`
      );
    }

    // group validation
    if (!allowedGroups.includes(rule.group)) {
      throw new Error(
        `Validation Error on rule '${ruleId}': group must belong strictly to ${JSON.stringify(
          allowedGroups
        )}. Found: '${rule.group}'`
      );
    }

    // claimStrength validation
    if (!allowedClaimStrengths.includes(rule.claimStrength)) {
      throw new Error(
        `Validation Error on rule '${ruleId}': claimStrength must belong strictly to ${JSON.stringify(
          allowedClaimStrengths
        )}. Found: '${rule.claimStrength}'`
      );
    }

    // reliabilityLevel validation
    if (!allowedReliabilityLevels.includes(rule.reliabilityLevel)) {
      throw new Error(
        `Validation Error on rule '${ruleId}': reliabilityLevel must belong strictly to ${JSON.stringify(
          allowedReliabilityLevels
        )}. Found: '${rule.reliabilityLevel}'`
      );
    }

    // inputRequired validation
    if (!rule.inputRequired || typeof rule.inputRequired !== 'object' || Array.isArray(rule.inputRequired)) {
      throw new Error(`Validation Error on rule '${ruleId}': inputRequired must be a valid, non-null object.`);
    }
    if (!('field' in rule.inputRequired)) {
      throw new Error(`Validation Error on rule '${ruleId}': inputRequired must contain at least the 'field' key.`);
    }

    // source validation
    if (!rule.source || typeof rule.source !== 'object' || Array.isArray(rule.source)) {
      throw new Error(`Validation Error on rule '${ruleId}': source must be a valid object.`);
    }
    const requiredSourceKeys = [
      'author',
      'year',
      'title',
      'type',
      'url',
      'doi',
      'verificationStatus',
      'sourceQuality',
    ];
    for (const key of requiredSourceKeys) {
      if (!(key in rule.source)) {
        throw new Error(`Validation Error on rule '${ruleId}': source object is missing the required sub-key: '${key}'`);
      }
    }

    // scoring validation
    if (rule.scoring !== undefined) {
      if (typeof rule.scoring !== 'object' || rule.scoring === null) {
        throw new Error(`Validation Error on rule '${ruleId}': scoring must be a valid, non-null object.`);
      }
      if (typeof rule.scoring.enabled !== 'boolean') {
        throw new Error(`Validation Error on rule '${ruleId}': scoring.enabled must be a strict boolean.`);
      }
      if (typeof rule.scoring.scoreImpact !== 'number') {
        throw new Error(`Validation Error on rule '${ruleId}': scoring.scoreImpact must be a strict number.`);
      }
      if (typeof rule.scoring.scoreType !== 'string') {
        throw new Error(`Validation Error on rule '${ruleId}': scoring.scoreType must be a strict string.`);
      }
      if (typeof rule.scoring.reason !== 'string') {
        throw new Error(`Validation Error on rule '${ruleId}': scoring.reason must be a strict string.`);
      }
    }
  }

  logger.info('Strict quality validation checks passed successfully for all 16 rules.');

  // 4. Database Connection & Injection
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dreamscape';
  try {
    await mongoose.connect(mongoUri);
    logger.info('Database connection established successfully.');

    const seedIds = rules.map(r => r._id);
    const existingRules = await VerifiedKnowledgeRule.find({ _id: { $in: seedIds } }).lean();
    const existingMap = new Map(existingRules.map(r => [r._id, r]));

    const bulkOps: any[] = [];
    let skippedCount = 0;
    let insertedCount = 0;
    let updatedCount = 0;

    for (const rule of rules) {
      const existing = existingMap.get(rule._id);
      if (!existing) {
        // Rule does not exist -> insert with origin = "seed"
        bulkOps.push({
          insertOne: {
            document: {
              ...rule,
              origin: 'seed',
              ruleVersion: rule.ruleVersion || 1,
              sourceEvidenceStatus: rule.sourceEvidenceStatus || 'unlinked'
            }
          }
        });
        insertedCount++;
      } else {
        const origin = existing.origin;
        if (origin === 'seed' || origin === undefined || origin === null) {
          // Exists and origin is seed or missing/undefined -> update and set origin = "seed"
          bulkOps.push({
            updateOne: {
              filter: { _id: rule._id },
              update: {
                $set: {
                  ...rule,
                  origin: 'seed',
                  ruleVersion: existing.ruleVersion || rule.ruleVersion || 1,
                  sourceEvidenceStatus: existing.sourceEvidenceStatus || rule.sourceEvidenceStatus || 'unlinked'
                }
              }
            }
          });
          updatedCount++;
        } else {
          // Exists and origin is manual or source_generated -> do not overwrite
          logger.info(`Skipping seed upsert for rule '${rule._id}' because its origin is '${origin}'.`);
          skippedCount++;
        }
      }
    }

    if (bulkOps.length > 0) {
      const bulkRes = await VerifiedKnowledgeRule.bulkWrite(bulkOps);
      logger.info(`Bulk operations completed: created ${insertedCount} new rules, updated ${updatedCount} rules, skipped ${skippedCount} protected rules.`);
    } else {
      logger.info(`No updates needed. Skipped all ${skippedCount} rules.`);
    }

    // Re-verify and sync indexes
    await VerifiedKnowledgeRule.syncIndexes();
    logger.info('Successfully verified and built single and compound indexes.');

  } catch (err: any) {
    logger.error('Failed to complete seed ingestion or database operation.', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    logger.info('Database connection closed.');
  }
}

importRules().catch((err) => {
  console.error('Unhandled fatal error in ingestion process:', err);
  process.exit(1);
});
