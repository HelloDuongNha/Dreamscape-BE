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
  if (source) {
    source.readableInApp = true;
    source.verificationStatus = 'manual';
    await source.save();
    console.log('Successfully set readableInApp to true.');
  }
  
  await mongoose.disconnect();
}

run().catch(console.error);
