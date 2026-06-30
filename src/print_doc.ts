import mongoose from 'mongoose';
import AcademicDocument from './models/AcademicDocument';

async function run() {
  const doc = await AcademicDocument.findById('6a4163fe2c2e567539a6cf22');
  console.log('Doc details:', JSON.stringify(doc, null, 2));
  process.exit(0);
}

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dreamscape')
  .then(() => run())
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
