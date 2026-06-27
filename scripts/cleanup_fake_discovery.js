const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  console.log('Connecting to MongoDB at:', uri);
  await mongoose.connect(uri);

  const db = mongoose.connection.db;
  if (!db) {
    console.error('Failed to retrieve database connection.');
    process.exit(1);
  }

  try {
    // 1. Drop discovery_runs collection if it exists
    console.log('Checking for discovery_runs collection...');
    const collections = await db.listCollections({ name: 'discovery_runs' }).toArray();
    if (collections.length > 0) {
      await db.dropCollection('discovery_runs');
      console.log('Dropped discovery_runs collection.');
    } else {
      console.log('discovery_runs collection does not exist.');
    }

    // 2. Find and delete fake academic sources starting with 10.1234/
    console.log('Finding fake academic sources...');
    const fakeSources = await db.collection('academic_sources')
      .find({ $or: [{ doi: /^10\.1234\// }, { normalizedDoi: /^10\.1234\// }] })
      .toArray();
    const fakeSourceIds = fakeSources.map(s => s._id);
    const fakeSourceContIds = fakeSources.map(s => s.sourceContributionId).filter(Boolean);

    if (fakeSources.length > 0) {
      console.log(`Found ${fakeSources.length} fake academic sources. Cleaning up related records...`);
      
      // Delete AcademicFullText
      const ftRes = await db.collection('academic_fulltexts').deleteMany({
        $or: [
          { academicSourceId: { $in: fakeSourceIds } },
          { doi: /^10\.1234\// }
        ]
      });
      console.log(`Deleted ${ftRes.deletedCount} fulltext documents.`);

      // Delete AcademicFullTextSection
      const ftsRes = await db.collection('academic_fulltext_sections').deleteMany({
        academicSourceId: { $in: fakeSourceIds }
      });
      console.log(`Deleted ${ftsRes.deletedCount} fulltext section documents.`);

      // Delete AcademicChunk
      const chunkRes = await db.collection('academic_chunks').deleteMany({
        $or: [
          { academicSourceId: { $in: fakeSourceIds } },
          { doi: /^10\.1234\// }
        ]
      });
      console.log(`Deleted ${chunkRes.deletedCount} chunk documents.`);

      // Delete AcademicSource
      const srcRes = await db.collection('academic_sources').deleteMany({
        _id: { $in: fakeSourceIds }
      });
      console.log(`Deleted ${srcRes.deletedCount} academic source documents.`);
    } else {
      console.log('No fake academic sources found.');
    }

    // 3. Find and delete fake source contributions
    console.log('Finding and deleting fake source contributions...');
    const contribRes = await db.collection('source_contributions').deleteMany({
      $or: [
        { doi: /^10\.1234\// },
        { normalizedDoi: /^10\.1234\// },
        { _id: { $in: fakeSourceContIds } },
        { "discovery.discoveredBy": "auto_knowledge_builder" }
      ]
    });
    console.log(`Deleted ${contribRes.deletedCount} source contributions.`);

    console.log('Database cleanup completed successfully.');

  } catch (err) {
    console.error('Error cleaning up fake discovery data:', err);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected.');
  }
}

run();
