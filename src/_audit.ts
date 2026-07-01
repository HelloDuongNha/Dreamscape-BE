import mongoose from 'mongoose';
import dotenv from 'dotenv';
import AcademicSource from './models/AcademicSource';
import { importSmartReaderForSource } from './services/academic/smartReaderImport.service';
import AcademicDocument from './models/AcademicDocument';
import AcademicChunk from './models/AcademicChunk';

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dreamscape');
  const moderatorId = new mongoose.Types.ObjectId('6a0fc84bd37aacb66092be0e');

  // Reimport Nature
  console.log('=== Reimporting Nature ===');
  const natureSrc = await AcademicSource.findOne({ doi: '10.1038/s41398-023-02637-6' });
  if (natureSrc) {
    const res = await importSmartReaderForSource(natureSrc, moderatorId, true);
    console.log(`success: ${res.success}, message: ${res.message}`);
    const doc = await AcademicDocument.findOne({ sourceId: natureSrc._id });
    if (doc) {
      const chunks = await AcademicChunk.find({ documentId: doc._id, chunkPurpose: 'reader' }).sort({ chunkOrder: 1 }).lean();
      const figs = chunks.filter((c: any) => c.blockType === 'figure');
      const tables = chunks.filter((c: any) => c.blockType === 'table');
      const refs = chunks.filter((c: any) => c.blockType === 'reference');
      console.log(`chunks: ${chunks.length}, figs: ${figs.length}, tables: ${tables.length}, refs: ${refs.length}`);
      if (figs.length > 0) {
        const f = figs[0] as any;
        console.log('Figure html (first 400):', (f.html || '').substring(0, 400));
        console.log('imageUrl:', f.imageUrl);
      }
    }
  }

  await mongoose.disconnect();
}

run();
