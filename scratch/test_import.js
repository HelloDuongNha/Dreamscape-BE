const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env ') });

const { importFullTextForSource } = require('../src/services/fullTextImport.service');
const AcademicSource = require('../src/models/AcademicSource').default;

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  await mongoose.connect(uri);
  
  const e2eId = '6a3dfc2070d817a75983aa74';
  const source = await AcademicSource.findById(e2eId);
  if (!source) {
    console.error('Source not found');
    await mongoose.disconnect();
    return;
  }
  
  console.log('Running importFullTextForSource...');
  const result = await importFullTextForSource(source, source.originalFile?.uploadedBy || mongoose.Types.ObjectId());
  console.log('Result:', JSON.stringify(result, null, 2));
  
  await mongoose.disconnect();
}

run().catch(console.error);
