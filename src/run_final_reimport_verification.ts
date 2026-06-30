import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { importSmartReaderForSource } from './services/academic/smartReaderImport.service';
import AcademicSource from './models/AcademicSource';
import AcademicDocument from './models/AcademicDocument';
import AcademicChunk from './models/AcademicChunk';

dotenv.config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dreamscape';
  await mongoose.connect(uri);

  const moderatorId = new mongoose.Types.ObjectId('6a0fc84bd37aacb66092be0e');

  const testCases = [
    {
      name: 'Nightmares share genetic risk factors with sleep and psychiatric traits',
      doi: '10.1038/s41398-023-02637-6'
    },
    {
      name: 'A Supplement to Self-Organization Theory of Dreaming',
      doi: '10.3389/fpsyg.2016.00332'
    }
  ];

  for (const tc of testCases) {
    console.log(`\n========================================`);
    console.log(`REIMPORTING Source: ${tc.name}`);
    console.log(`DOI: ${tc.doi}`);

    const source = await AcademicSource.findOne({ doi: tc.doi });
    if (!source) {
      console.error(`Source not found in db for DOI: ${tc.doi}`);
      continue;
    }

    const docBefore = await AcademicDocument.findOne({ sourceId: source._id });
    if (docBefore) {
      await AcademicChunk.deleteMany({ documentId: docBefore._id });
    }

    const result = await importSmartReaderForSource(source, moderatorId, true);
    console.log(`Reimport Success: ${result.success}`);
    console.log(`Message: ${result.message}`);
    if (!result.success) {
      console.log(`Error: ${result.error}`);
      continue;
    }

    const docAfter = await AcademicDocument.findOne({ sourceId: source._id });
    const chunks = docAfter ? await AcademicChunk.find({ documentId: docAfter._id }).sort({ chunkOrder: 1 }) : [];
    console.log(`Total chunks after reimport: ${chunks.length}`);

    const headings = chunks.filter(c => c.blockType === 'heading');
    const tables = chunks.filter(c => c.blockType === 'table');
    const figures = chunks.filter(c => c.blockType === 'figure');
    const references = chunks.filter(c => c.blockType === 'reference');

    console.log(`Heading count: ${headings.length}`);
    console.log(`Table count: ${tables.length}`);
    console.log(`Figure count: ${figures.length}`);
    console.log(`Reference count: ${references.length}`);

    // Print figures
    console.log(`\nActive Figure blocks:`);
    figures.forEach((f, idx) => {
      console.log(`  Fig [${idx + 1}]: text="${f.text.substring(0, 100)}..."`);
      console.log(`  HTML length: ${f.html ? f.html.length : 0}`);
      console.log(`  HTML content: "${f.html}"\n`);
    });

    // Print tables
    console.log(`\nActive Table blocks:`);
    tables.forEach((t, idx) => {
      console.log(`  Table [${idx + 1}]: text="${t.text.substring(0, 100)}..."`);
      console.log(`  HTML length: ${t.html ? t.html.length : 0}`);
      console.log(`  HTML content: "${t.html ? t.html.substring(0, 500) + '...' : ''}"\n`);
    });

    // Print last 5 blocks before References
    const refIdx = chunks.findIndex(c => c.blockType === 'heading' && c.text.toLowerCase().includes('reference'));
    if (refIdx !== -1) {
      console.log(`\nLast 5 blocks before References:`);
      chunks.slice(Math.max(0, refIdx - 5), refIdx).forEach((c, idx) => {
        console.log(`  [-${5 - idx}]: type=${c.blockType}, text="${c.text.substring(0, 120)}..."`);
      });
      console.log(`  [REFERENCES heading]: type=${chunks[refIdx].blockType}, text="${chunks[refIdx].text}"`);
    }
  }

  await mongoose.disconnect();
}

run();
