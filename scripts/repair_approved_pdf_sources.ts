import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';

const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import AcademicSource from '../src/models/AcademicSource';
import SourceContribution from '../src/models/SourceContribution';
import { importFullTextForSource } from '../src/services/fullTextImport.service';

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  console.log('Connecting to MongoDB at:', uri);
  await mongoose.connect(uri);

  const apply = process.argv.includes('--apply');
  const doImport = process.argv.includes('--import');

  console.log('--- UPLOADED PDF SOURCE REPAIR UTILITY ---');
  if (!apply) {
    console.log('Mode: DRY RUN (To apply fixes, run: npm run repair:uploaded-pdf-sources -- --apply)');
  } else {
    console.log('Mode: APPLY ACTIVE REPAIRS');
  }
  if (doImport) {
    console.log('Options: Full-text import will be triggered for repaired sources.');
  } else {
    console.log('Options: Full-text import is disabled (run with --import to enable).');
  }

  try {
    const sources = await AcademicSource.find({});
    console.log(`Found ${sources.length} approved academic sources total.`);
    
    let repairedCount = 0;

    for (const src of sources) {
      if (!src.sourceContributionId) continue;
      const contrib = await SourceContribution.findById(src.sourceContributionId);
      
      if (contrib && contrib.originalFile && contrib.originalFile.cloudinarySecureUrl) {
        const needsRepair = !src.originalFile || 
                            !src.originalFile.cloudinarySecureUrl ||
                            src.allowedUse !== 'open_access_fulltext' ||
                            src.copyrightStatus === 'paywalled' ||
                            !src.readableInApp ||
                            src.fullTextStatus === 'none';

        if (needsRepair) {
          console.log(`\n[REPAIR TARGET] AcademicSource ID: ${src._id}`);
          console.log(`  Title: "${src.title}"`);
          console.log(`  Current allowedUse: ${src.allowedUse}`);
          console.log(`  Current copyrightStatus: ${src.copyrightStatus}`);
          console.log(`  Current readableInApp: ${src.readableInApp}`);
          console.log(`  Missing originalFile on source: ${!src.originalFile}`);

          if (apply) {
            console.log(`  Applying repair changes to AcademicSource ${src._id}...`);
            src.originalFile = contrib.originalFile;
            src.allowedUse = 'open_access_fulltext';
            src.copyrightStatus = 'paywalled';
            src.readableInApp = true;
            src.fullTextStatus = 'available';
            src.fullTextSourceType = 'pdf';
            src.pdfUrl = contrib.originalFile.cloudinarySecureUrl;
            src.fullTextUrl = contrib.originalFile.cloudinarySecureUrl;
            src.sourceOrigin = 'uploaded_pdf';

            await src.save();

            // Mirror on contribution
            contrib.allowedUse = 'open_access_fulltext';
            contrib.readableInApp = true;
            contrib.fullTextStatus = 'available';
            contrib.fullTextSourceType = 'pdf';
            contrib.pdfUrl = contrib.originalFile.cloudinarySecureUrl;
            contrib.fullTextUrl = contrib.originalFile.cloudinarySecureUrl;
            contrib.copyrightStatus = 'paywalled';
            contrib.verificationStatus = 'manual';
            contrib.sourceOrigin = 'uploaded_pdf';
            if (contrib.metadata) {
              contrib.metadata.allowedUse = 'open_access_fulltext';
            }
            await contrib.save();

            console.log(`  Successfully saved repaired metadata!`);
            repairedCount++;

            if (doImport) {
              console.log(`  Starting full-text extraction/import for source ${src._id}...`);
              try {
                const importRes = await importFullTextForSource(src, contrib.reviewedBy || contrib.submittedBy);
                console.log(`  Import complete: success=${importRes.success}, message=${importRes.message || ''}`);
              } catch (importErr: any) {
                console.error(`  Import error: ${importErr.message || importErr}`);
              }
            } else {
              console.log(`  [Note] Run with --import flag or run reimport from UI after repair to rebuild smart reader sections.`);
            }
          } else {
            console.log(`  [Dry Run] Would repair metadata for AcademicSource ${src._id}.`);
          }
        }
      }
    }

    console.log(`\nUtility execution complete. Repaired count: ${repairedCount}`);
  } catch (err) {
    console.error('Error executing repair utility:', err);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected.');
  }
}

run();
