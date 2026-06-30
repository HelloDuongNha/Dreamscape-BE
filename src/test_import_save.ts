import mongoose from 'mongoose';
import SourceContribution from './models/SourceContribution';

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dreamscape';
  await mongoose.connect(uri);

  const doi = '10.3389/fpsyg.2016.00332';
  
  // Find recent contribution
  const contrib = await SourceContribution.findOne({ doi });
  if (contrib) {
    console.log('Before update, fullTextStatus:', contrib.fullTextStatus);
    contrib.fullTextStatus = 'imported';
    await contrib.save();
    
    const reloaded = await SourceContribution.findById(contrib._id);
    console.log('After update and save, fullTextStatus:', reloaded?.fullTextStatus);
  } else {
    console.log('Contribution not found for DOI:', doi);
  }

  await mongoose.disconnect();
}

run().catch(console.error);
