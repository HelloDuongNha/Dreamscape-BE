const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from BE/.env 
dotenv.config({ path: path.resolve(__dirname, '../.env ') });

const AcademicSourceSchema = new mongoose.Schema({}, { strict: false });
const AcademicSource = mongoose.model('AcademicSource', AcademicSourceSchema, 'academic_sources');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  await mongoose.connect(uri);
  const sources = await AcademicSource.find({}, '_id title doi sourceOrigin readableInApp pdfUrl url originalFile').lean();
  console.log(JSON.stringify(sources, null, 2));
  await mongoose.disconnect();
}

run().catch(console.error);
