const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env ') });

const AcademicFullTextSchema = new mongoose.Schema({}, { strict: false });
const AcademicFullText = mongoose.model('AcademicFullText', AcademicFullTextSchema, 'academic_fulltexts');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  await mongoose.connect(uri);
  
  const e2eId = '6a3dfc2070d817a75983aa74';
  const ft = await AcademicFullText.findOne({ academicSourceId: e2eId }).lean();
  if (!ft) {
    console.log('No full text found for E2E source.');
  } else {
    console.log('--- AcademicFullText metadata ---');
    console.log('sourceType:', ft.sourceType);
    console.log('extractionEngine:', ft.extractionEngine);
    console.log('extractionQuality:', ft.extractionQuality);
    console.log('wordCount:', ft.wordCount);
    console.log('characterCount:', ft.characterCount);
    console.log('sectionCount:', ft.sectionCount);
    console.log('warnings:', ft.warnings);
    console.log('smartReaderSourceType:', ft.smartReaderSourceType);
    console.log('\n--- Reading blocks ---');
    console.log('Blocks count:', ft.readingBlocks ? ft.readingBlocks.length : 0);
    if (ft.readingBlocks) {
      console.log('First 5 blocks:');
      console.log(ft.readingBlocks.slice(0, 5));
      console.log('Last 5 blocks:');
      console.log(ft.readingBlocks.slice(-5));
    }
  }
  
  await mongoose.disconnect();
}

run().catch(console.error);
