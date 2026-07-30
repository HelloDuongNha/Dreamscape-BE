import '../src/config/env';
import mongoose from 'mongoose';
import connectDB from '../src/config/db';
import AcademicDocument from '../src/modules/academic/models/AcademicDocument';
import AcademicSource from '../src/modules/academic/models/AcademicSource';
import SourceContribution from '../src/modules/academic/models/SourceContribution';
import {
  hasStoredOriginalPdf,
  originalPdfAssetExists,
} from '../src/modules/academic/services/storage/originalPdfStorage.service';

interface RepairReport {
  mode: 'dry-run' | 'apply';
  inspected: number;
  repairable: number;
  repaired: number;
  alreadyConsistent: number;
  missingApprovedSource: number;
  missingStoredObject: number;
  failures: Array<{ contributionId: string; reason: string }>;
}

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await connectDB();

  const report: RepairReport = {
    mode: apply ? 'apply' : 'dry-run',
    inspected: 0,
    repairable: 0,
    repaired: 0,
    alreadyConsistent: 0,
    missingApprovedSource: 0,
    missingStoredObject: 0,
    failures: [],
  };

  const contributions = await SourceContribution.find({
    reviewStatus: 'approved',
    sourceOrigin: 'uploaded_pdf',
  }).select('_id originalFile').lean();

  for (const contribution of contributions) {
    report.inspected += 1;
    await inspectContribution(contribution, apply, report);
  }

  console.log(JSON.stringify(report, null, 2));
}

async function inspectContribution(
  contribution: any,
  apply: boolean,
  report: RepairReport,
): Promise<void> {
  const contributionId = String(contribution._id);
  try {
    if (!hasStoredOriginalPdf(contribution.originalFile)
      || !await originalPdfAssetExists(contribution.originalFile)) {
      report.missingStoredObject += 1;
      report.failures.push({ contributionId, reason: 'firebase_original_missing' });
      return;
    }

    const source = await AcademicSource.findOne({ sourceContributionId: contribution._id });
    if (!source) {
      report.missingApprovedSource += 1;
      report.failures.push({ contributionId, reason: 'approved_source_missing' });
      return;
    }

    const hasReader = Boolean(await AcademicDocument.exists({ sourceId: source._id }));
    const sourceHasOriginal = hasStoredOriginalPdf(source.originalFile);
    const consistent = sourceHasOriginal
      && source.sourceOrigin === 'uploaded_pdf'
      && source.allowedUse === 'open_access_fulltext'
      && source.fullTextSourceType === 'pdf'
      && source.fullTextStatus === (hasReader ? 'imported' : 'available')
      && source.readableInApp === hasReader;
    if (consistent) {
      report.alreadyConsistent += 1;
      return;
    }

    report.repairable += 1;
    if (!apply) return;

    source.originalFile = contribution.originalFile;
    source.sourceOrigin = 'uploaded_pdf';
    source.allowedUse = 'open_access_fulltext';
    source.fullTextSourceType = 'pdf';
    source.fullTextStatus = hasReader ? 'imported' : 'available';
    source.readableInApp = hasReader;
    await source.save();
    report.repaired += 1;
  } catch (error) {
    report.failures.push({
      contributionId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

run()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
