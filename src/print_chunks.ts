import mongoose from 'mongoose';
import AcademicChunk from './models/AcademicChunk';

async function run() {
  const docId = '6a4163fe2c2e567539a6cf22';
  const chunks = await AcademicChunk.find({ documentId: docId }).sort({ chunkOrder: 1 });
  console.log(`Found ${chunks.length} chunks:`);
  for (const c of chunks) {
    console.log(`- Type: ${c.blockType}, Purpose: ${c.chunkPurpose}, Text: ${c.text.substring(0, 100)}...`);
  }
  process.exit(0);
}

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dreamscape')
  .then(() => run())
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
