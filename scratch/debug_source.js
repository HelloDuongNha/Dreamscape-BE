const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env ') });

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
  
  console.log('modelName:', source.constructor.modelName);
  console.log('originalFile:', source.originalFile);
  console.log('pdfUrl:', source.pdfUrl);
  console.log('sourceOrigin:', source.sourceOrigin);
  console.log('readableInApp:', source.readableInApp);
  console.log('verificationStatus:', source.verificationStatus);
  console.log('allowedUse:', source.allowedUse);
  console.log('copyrightStatus:', source.copyrightStatus);
  console.log('oaStatus:', source.oaStatus);
  console.log('openAccessStatus:', source.openAccessStatus);
  console.log('license:', source.license);
  
  await mongoose.disconnect();
}

run().catch(console.error);
