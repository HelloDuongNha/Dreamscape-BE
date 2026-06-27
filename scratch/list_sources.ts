import mongoose from 'mongoose';
import AcademicSource from '../src/models/AcademicSource';
import dbBootstrap from '../src/config/db'; // Wait, let's check how connection is booted, or just use mongoose.connect
import './env_bootstrap'; // we can just import the env

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  await mongoose.connect(uri);
  const sources = await AcademicSource.find({}, '_id title doi sourceOrigin readableInApp pdfUrl url originalFile').lean();
  console.log(JSON.stringify(sources, null, 2));
  await mongoose.disconnect();
}

run().catch(console.error);
