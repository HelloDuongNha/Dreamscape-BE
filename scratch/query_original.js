const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env ') });

const AcademicSourceSchema = new mongoose.Schema({}, { strict: false });
const AcademicSource = mongoose.model('AcademicSource', AcademicSourceSchema, 'academic_sources');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  await mongoose.connect(uri);
  
  const plosOneId = '6a3429db114ad00e3c33f0d2';
  const e2eId = '6a3dfc2070d817a75983aa74';
  
  const plosOne = await AcademicSource.findById(plosOneId);
  const e2e = await AcademicSource.findById(e2eId);
  
  console.log('--- PLOS ONE source details ---');
  console.log('doi:', plosOne.doi);
  console.log('pdfUrl:', plosOne.pdfUrl);
  console.log('originalFile:', plosOne.originalFile);
  console.log('readableInApp:', plosOne.readableInApp);
  console.log('sourceOrigin:', plosOne.sourceOrigin);
  
  console.log('\n--- E2E source details ---');
  console.log('doi:', e2e.doi);
  console.log('pdfUrl:', e2e.pdfUrl);
  console.log('originalFile:', e2e.originalFile);
  console.log('readableInApp:', e2e.readableInApp);
  console.log('sourceOrigin:', e2e.sourceOrigin);
  
  await mongoose.disconnect();
}

run().catch(console.error);
