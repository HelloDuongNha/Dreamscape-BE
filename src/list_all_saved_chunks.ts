import dotenv from 'dotenv';
import mongoose from 'mongoose';
import AcademicSource from './models/AcademicSource';
import AcademicDocument from './models/AcademicDocument';
import AcademicChunk from './models/AcademicChunk';

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dreamscape');
  
  const doi = '10.3389/fpsyg.2013.00408';
  const source = await AcademicSource.findOne({ doi });
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
  console.log(`Saved chunks total: ${chunks.length}`);
  
  chunks.forEach((c, idx) => {
    if (c.text.toLowerCase().includes('figure 3') || c.text.toLowerCase().includes('figure 4') || c.blockType === 'figure') {
      console.log(`[Chunk ${idx}]: type=${c.blockType}, text="${c.text.substring(0, 150)}..."`);
    }
  });

  await mongoose.disconnect();
}

run();
