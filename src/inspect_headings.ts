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
  
  const headings = chunks.filter(c => c.blockType === 'heading');
  console.log(`Found ${headings.length} headings:`);
  headings.forEach((h, idx) => {
    console.log(`  [Heading ${idx + 1}]: text="${h.text}"`);
  });

  await mongoose.disconnect();
}

run();
