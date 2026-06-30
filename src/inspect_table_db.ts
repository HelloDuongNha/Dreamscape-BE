import mongoose from 'mongoose';
import dotenv from 'dotenv';
import AcademicSource from './models/AcademicSource';
import AcademicDocument from './models/AcademicDocument';
import AcademicChunk from './models/AcademicChunk';

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dreamscape');
  
  const source = await AcademicSource.findOne({ doi: '10.1038/s41398-023-02637-6' });
  if (!source) {
    console.error('Source not found');
    await mongoose.disconnect();
    return;
  }

  const doc = await AcademicDocument.findOne({ sourceId: source._id });
  if (!doc) {
    console.error('Document not found');
    await mongoose.disconnect();
    return;
  }

  const chunks = await AcademicChunk.find({ documentId: doc._id }).sort({ chunkOrder: 1 });
  
  const tables = chunks.filter(c => c.blockType === 'table');
  console.log(`Found ${tables.length} table chunks:`);
  tables.forEach((t, idx) => {
    console.log(`Table #${idx + 1}:`);
    console.log(`  Text: "${t.text.substring(0, 100)}..."`);
    console.log(`  HTML length: ${t.html ? t.html.length : 0}`);
    if (t.html) {
      console.log(`  HTML prefix: "${t.html.substring(0, 300)}..."`);
      console.log(`  HTML suffix: "...${t.html.substring(t.html.length - 200)}"`);
    }
  });

  await mongoose.disconnect();
}

run();
