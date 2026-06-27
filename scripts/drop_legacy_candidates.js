const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { default: KnowledgeRuleCandidate } = require('../dist/models/KnowledgeRuleCandidate');

async function checkAndDrop() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  const args = process.argv.slice(2);
  const confirmDrop = args.includes('--confirm-drop');

  console.log('================================================================');
  console.log('LEGACY CANDIDATES COLLECTION AUDIT & DROP SCRIPT');
  console.log(`Connecting to: ${uri}`);
  console.log(`Mode: ${confirmDrop ? '🚨 LIVE DROP' : '🔍 DRY-RUN (Audit only)'}`);
  console.log('================================================================\n');

  try {
    await mongoose.connect(uri);
    const db = mongoose.connection.db;

    // 1. Audit active candidate model collection name
    const activeModelCollectionName = KnowledgeRuleCandidate.collection.name;
    console.log(`Active KnowledgeRuleCandidate model points to collection: '${activeModelCollectionName}'`);
    if (activeModelCollectionName === 'knowledge_rule_candidates') {
      console.log('✅ Active model target collection verified: correct.');
    } else {
      console.warn(`⚠️ Warning: Active model targets unexpected collection name: '${activeModelCollectionName}'`);
    }

    // 2. Audit if knowledgerulecandidates (legacy) exists and is empty
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    const legacyExists = collectionNames.includes('knowledgerulecandidates');
    console.log(`Legacy collection 'knowledgerulecandidates' exists in DB: ${legacyExists ? 'YES' : 'NO'}`);

    if (legacyExists) {
      const legacyCount = await db.collection('knowledgerulecandidates').countDocuments({});
      console.log(`Documents count in legacy 'knowledgerulecandidates': ${legacyCount}`);

      if (legacyCount > 0) {
        console.warn('⚠️ WARNING: Legacy collection is NOT empty! Proceeding to drop will delete data.');
      } else {
        console.log('✅ Legacy collection is verified empty.');
      }

      if (confirmDrop) {
        if (legacyCount > 0) {
          console.error('❌ Refusing to drop: Legacy collection has documents. Clean them up manually first.');
        } else {
          console.log("\nDropping legacy collection 'knowledgerulecandidates'...");
          await db.collection('knowledgerulecandidates').drop();
          console.log("✅ Collection dropped successfully.");
        }
      } else {
        console.log('\n[Dry-run] To drop this empty legacy collection, run with: node scripts/drop_legacy_candidates.js --confirm-drop');
      }
    } else {
      console.log("\nLegacy collection 'knowledgerulecandidates' does not exist. Nothing to clean up.");
    }

  } catch (err) {
    console.error('Error during audit & drop:', err);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
    console.log('================================================================');
  }
}

checkAndDrop().catch(console.error);
