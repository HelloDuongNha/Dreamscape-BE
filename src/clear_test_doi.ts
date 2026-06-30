import mongoose from 'mongoose';
import SourceContribution from './models/SourceContribution';
import AcademicSource from './models/AcademicSource';
import AcademicDocument from './models/AcademicDocument';
import AcademicSection from './models/AcademicSection';
import AcademicChunk from './models/AcademicChunk';

async function run() {
  const doi = '10.3389/fpsyg.2016.00332';
  const normDoi = doi.trim().toLowerCase();
  
  console.log(`Clearing records for DOI: ${doi}`);

  // Find contributions
  const contributions = await SourceContribution.find({ normalizedDoi: normDoi });
  console.log(`Found ${contributions.length} contributions to delete.`);
  for (const c of contributions) {
    await AcademicDocument.deleteMany({ previewContributionId: c._id });
    await AcademicSection.deleteMany({ previewContributionId: c._id });
    await AcademicChunk.deleteMany({ previewContributionId: c._id });
    await SourceContribution.deleteOne({ _id: c._id });
  }

  // Find sources
  const sources = await AcademicSource.find({ normalizedDoi: normDoi });
  console.log(`Found ${sources.length} sources to delete.`);
  for (const s of sources) {
    await AcademicDocument.deleteMany({ sourceId: s._id });
    await AcademicSection.deleteMany({ sourceId: s._id });
    await AcademicChunk.deleteMany({ sourceId: s._id });
    await AcademicSource.deleteOne({ _id: s._id });
  }

  console.log('Clearing completed.');
  process.exit(0);
}

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dreamscape')
  .then(() => run())
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
