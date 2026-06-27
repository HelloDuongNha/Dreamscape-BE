const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '../.env');
dotenv.config({ path: envPath });

// Register ts-node on the fly
require('ts-node').register({
  project: path.join(__dirname, '../tsconfig.json'),
  transpileOnly: true
});

const AcademicSource = require('../src/models/AcademicSource').default;
const AcademicFullText = require('../src/models/AcademicFullText').default;
const AcademicFullTextSection = require('../src/models/AcademicFullTextSection').default;
const AcademicChunk = require('../src/models/AcademicChunk').default;
const PendingKnowledgeRule = require('../src/models/PendingKnowledgeRule').default;
const VerifiedKnowledgeRule = require('../src/models/VerifiedKnowledgeRule').default;
const KnowledgeRuleEvidence = require('../src/models/KnowledgeRuleEvidence').default;

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);

  try {
    console.log('Starting mock/test data cleanup...');

    // 1. Find the fake AcademicSources to delete
    const fakeSources = await AcademicSource.find({
      $or: [
        { title: "Validation Test Source Book" },
        { doi: /^10\.1234\// }
      ]
    });
    const fakeSourceIds = fakeSources.map(s => s._id);

    console.log(`Found ${fakeSources.length} fake sources to delete.`);

    // 2. AcademicSource deletion
    const deletedSources = await AcademicSource.deleteMany({
      _id: { $in: fakeSourceIds }
    });

    // 3. Delete fulltext, sections, chunks linked to these sources
    const deletedFullTexts = await AcademicFullText.deleteMany({
      academicSourceId: { $in: fakeSourceIds }
    });
    const deletedSections = await AcademicFullTextSection.deleteMany({
      academicSourceId: { $in: fakeSourceIds }
    });
    const deletedChunks = await AcademicChunk.deleteMany({
      academicSourceId: { $in: fakeSourceIds }
    });

    // 4. Delete candidates starting with d_test_ or linked to Validation Test Source Book
    const deletedCandidates = await PendingKnowledgeRule.deleteMany({
      $or: [
        { proposedRuleId: /^d_test_/ },
        { sourceTitle: "Validation Test Source Book" },
        { academicSourceId: { $in: fakeSourceIds } }
      ]
    });

    // 5. Delete VerifiedKnowledgeRule and KnowledgeRuleEvidence linked to d_test_*
    const deletedRules = await VerifiedKnowledgeRule.deleteMany({
      _id: /^d_test_/
    });
    const deletedLinks = await KnowledgeRuleEvidence.deleteMany({
      $or: [
        { ruleId: /^d_test_/ },
        { sourceId: { $in: fakeSourceIds } }
      ]
    });

    console.log('\n--- Cleanup Summary ---');
    console.log(`deleted sources count: ${deletedSources.deletedCount}`);
    console.log(`deleted fulltexts count: ${deletedFullTexts.deletedCount}`);
    console.log(`deleted sections count: ${deletedSections.deletedCount}`);
    console.log(`deleted chunks count: ${deletedChunks.deletedCount}`);
    console.log(`deleted candidates count: ${deletedCandidates.deletedCount}`);
    console.log(`deleted rules count: ${deletedRules.deletedCount}`);
    console.log(`deleted links count: ${deletedLinks.deletedCount}`);
    console.log('-----------------------\n');

    process.exit(0);
  } catch (err) {
    console.error('Error cleaning up mock/test data:', err);
    process.exit(1);
  }
}

run();
