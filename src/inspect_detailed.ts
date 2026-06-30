import mongoose from 'mongoose';
import SourceContribution from './models/SourceContribution';
import AcademicSource from './models/AcademicSource';
import AcademicDocument from './models/AcademicDocument';
import AcademicSection from './models/AcademicSection';
import AcademicChunk from './models/AcademicChunk';

async function run() {
  console.log('--- DETAILED DB INSPECTION ---');

  const contribId = '6a4163ed2c2e567539a6cf1f';
  const sourceId = '6a4164072c2e567539a6cf30';

  const docByContrib = await AcademicDocument.findOne({ previewContributionId: contribId });
  console.log('Doc by previewContributionId:', docByContrib ? docByContrib._id : 'NONE');

  const docBySource = await AcademicDocument.findOne({ sourceId: sourceId });
  console.log('Doc by sourceId:', docBySource ? docBySource._id : 'NONE');

  if (docBySource) {
    const secCount = await AcademicSection.countDocuments({ documentId: docBySource._id });
    const chunkReader = await AcademicChunk.countDocuments({ documentId: docBySource._id, chunkPurpose: 'reader' });
    const chunkRag = await AcademicChunk.countDocuments({ documentId: docBySource._id, chunkPurpose: 'rag' });
    console.log(`For doc: sections=${secCount}, readerChunks=${chunkReader}, ragChunks=${chunkRag}`);
  }

  process.exit(0);
}

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dreamscape')
  .then(() => run())
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
