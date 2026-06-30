import mongoose from 'mongoose';
import { buildResolverReport } from './services/academic/resolverDiagnostics.service';

async function run() {
  const doi = '10.3389/fpsyg.2016.00332';
  console.log(`Running diagnostics for: ${doi}`);
  const report = await buildResolverReport(doi, {});
  console.log('Resolver Report:', JSON.stringify(report, null, 2));
  process.exit(0);
}

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dreamscape')
  .then(() => run())
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
