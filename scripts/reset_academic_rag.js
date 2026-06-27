const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function resetAcademicRag() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  const args = process.argv.slice(2);
  const confirmReset = args.includes('--confirm-reset');

  console.log('================================================================');
  console.log('RESET ACADEMIC RAG & EXTRACTION V2 DATA SCRIPT');
  console.log(`Connecting to database at: ${uri}`);
  console.log(`Mode: ${confirmReset ? '🚨 LIVE DELETION' : '🔍 DRY-RUN (Audit only)'}`);
  console.log('================================================================\n');

  try {
    await mongoose.connect(uri);
    const db = mongoose.connection.db;

    // Collections to clear (using deleteMany)
    const collectionsToClear = [
      'academic_sources',
      'academic_fulltexts',
      'academic_fulltext_sections',
      'academic_chunks',
      'knowledge_rule_candidates',
      'academic_rule_extraction_runs',
      'knowledge_rule_sources'
    ];

    console.log('--- Current DB Collections Documents Count ---');
    const counts = {};
    for (const name of collectionsToClear) {
      const col = db.collection(name);
      const count = await col.countDocuments({});
      counts[name] = count;
      console.log(`  - ${name}: ${count} documents`);
    }

    // KnowledgeRule has a specific origin filter
    const rulesCol = db.collection('knowledge_rules');
    const sourceGeneratedRulesCount = await rulesCol.countDocuments({ origin: 'source_generated' });
    const totalRulesCount = await rulesCol.countDocuments({});
    console.log(`  - knowledge_rules (origin: 'source_generated'): ${sourceGeneratedRulesCount} of ${totalRulesCount} total rules`);

    // Let's audit source_contributions for dangling references
    console.log('\n--- Auditing source_contributions for dangling references ---');
    const sourcesCol = db.collection('academic_sources');
    const academicSources = await sourcesCol.find({}, { projection: { sourceContributionId: 1 } }).toArray();
    const contributionIds = academicSources
      .map(s => s.sourceContributionId)
      .filter(id => id); // filter out falsy / undefined

    let danglingContributions = [];
    if (contributionIds.length > 0) {
      const contributionsCol = db.collection('source_contributions');
      danglingContributions = await contributionsCol.find({
        reviewStatus: 'approved',
        _id: { $in: contributionIds }
      }, { projection: { _id: 1, title: 1, doi: 1 } }).toArray();
    }

    console.log(`Found approved source_contributions referencing active academic_sources: ${danglingContributions.length}`);
    if (danglingContributions.length > 0) {
      console.warn('⚠️ WARNING: Deleting academic_sources will result in approved source_contributions referencing missing sources.');
      console.log('Affected Source Contribution IDs:');
      danglingContributions.forEach(c => {
        console.log(`  - ID: ${c._id} | Title: "${c.title || 'N/A'}" | DOI: ${c.doi || 'N/A'}`);
      });
    } else {
      console.log('✅ No approved source_contributions will become dangling.');
    }

    // Protection check
    if (!confirmReset) {
      console.log('\n----------------------------------------------------------------');
      console.log('🔍 DRY-RUN SUMMARY');
      console.log('No database changes were made.');
      if (danglingContributions.length > 0) {
        console.log(`Audit warning: ${danglingContributions.length} approved contributions will have their target academic sources deleted.`);
      }
      console.log('To execute this reset and delete the documents listed above, run:');
      console.log('  node scripts/reset_academic_rag.js --confirm-reset');
      console.log('----------------------------------------------------------------');
      return;
    }

    // Live Deletion Phase
    console.log('\n================================================================');
    console.log('🚨 STARTING LIVE DELETION...');
    console.log('================================================================');

    for (const name of collectionsToClear) {
      if (counts[name] > 0) {
        console.log(`Deleting documents from '${name}'...`);
        const result = await db.collection(name).deleteMany({});
        console.log(`  - Deleted ${result.deletedCount} documents.`);
      } else {
        console.log(`Skipping '${name}' (already empty).`);
      }
    }

    if (sourceGeneratedRulesCount > 0) {
      console.log("Deleting 'source_generated' knowledge rules...");
      const result = await rulesCol.deleteMany({ origin: 'source_generated' });
      console.log(`  - Deleted ${result.deletedCount} knowledge rules.`);
    } else {
      console.log("Skipping 'source_generated' knowledge rules (none found).");
    }

    console.log('\n✅ Deletion complete. Database indexes are preserved.');

  } catch (err) {
    console.error('Fatal error during reset:', err);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
    console.log('================================================================');
  }
}

resetAcademicRag().catch(console.error);
