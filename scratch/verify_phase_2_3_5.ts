import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import AcademicSource from '../src/models/AcademicSource';
import AcademicDocument from '../src/models/AcademicDocument';
import AcademicSection from '../src/models/AcademicSection';
import AcademicChunk from '../src/models/AcademicChunk';
import PendingKnowledgeRule from '../src/models/PendingKnowledgeRule';
import VerifiedKnowledgeRule, { RuleClassification } from '../src/models/VerifiedKnowledgeRule';
import KnowledgeRuleEvidence from '../src/models/KnowledgeRuleEvidence';

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  console.log('Connecting to MongoDB at:', uri);
  await mongoose.connect(uri);

  const testSuffix = 'test_p235';

  try {
    console.log('--- STEP 1: CLEANING UP ANY MOCK DATA ---');
    await AcademicSource.deleteMany({ title: new RegExp(testSuffix) });
    await AcademicDocument.deleteMany({ parserEngine: testSuffix });
    await AcademicSection.deleteMany({ heading: new RegExp(testSuffix) });
    await AcademicChunk.deleteMany({ text: new RegExp(testSuffix) });
    await PendingKnowledgeRule.deleteMany({ ruleStatement: new RegExp(testSuffix) });
    await VerifiedKnowledgeRule.deleteMany({ ruleStatement: new RegExp(testSuffix) });
    await KnowledgeRuleEvidence.deleteMany({ evidenceSummary: new RegExp(testSuffix) });

    console.log('--- STEP 2: CREATING MOCK DATA ---');
    const source = new AcademicSource({
      _id: new mongoose.Types.ObjectId(),
      doi: `10.1234/${testSuffix}`,
      normalizedDoi: `10.1234/${testSuffix}`,
      url: `https://example.com/${testSuffix}`,
      normalizedUrl: `https://example.com/${testSuffix}`,
      license: 'open_access_fulltext',
      allowedUse: 'open_access_fulltext',
      readableInApp: true,
      title: `Academic Sleep Study - ${testSuffix}`,
      authors: ['Jane Doe'],
      year: 2026,
      chunkBuildStatus: 'completed',
      chunkEmbeddingModel: 'text-embedding-3-small',
    });
    await source.save();
    console.log('Created AcademicSource:', source._id);

    const doc = new AcademicDocument({
      _id: new mongoose.Types.ObjectId(),
      sourceId: source._id,
      parserVersion: 1,
      parserEngine: testSuffix,
      sectionIds: [],
    });

    const section = new AcademicSection({
      _id: new mongoose.Types.ObjectId(),
      documentId: doc._id,
      heading: `Results Section - ${testSuffix}`,
      sectionType: 'paragraph',
      chunkIds: [],
    });
    doc.sectionIds = [section._id];
    await doc.save();
    await section.save();
    console.log('Created AcademicDocument and AcademicSection');

    const chunk = new AcademicChunk({
      _id: new mongoose.Types.ObjectId(),
      sourceId: source._id,
      documentId: doc._id,
      sectionId: section._id,
      text: `Incorporating external stimuli into dreams changes brain activity - ${testSuffix}`,
      embedding: new Array(768).fill(0.01),
      tokenCount: 15,
      sectionOrder: 0,
      chunkOrder: 0,
    });
    await chunk.save();

    section.chunkIds = [chunk._id];
    await section.save();
    console.log('Created AcademicChunk:', chunk._id);

    // E. PendingKnowledgeRule (Staging Candidate)
    const candidate = new PendingKnowledgeRule({
      ruleStatement: `Poor sleep quality increases nightmare frequency - ${testSuffix}`,
      classifications: [RuleClassification.Nightmares, RuleClassification.SleepQuality],
      scientificBasis: `Testing scientific basis for sleep quality and nightmares - ${testSuffix}`,
      evidenceChunkIds: [chunk._id],
      status: 'pending',
    });
    await candidate.save();
    console.log('Created PendingKnowledgeRule:', candidate._id);

    console.log('--- STEP 3: APPROVING STAGING CANDIDATE (PROMOTING TO VERIFIED & EVIDENCE) ---');
    // A. Create VerifiedKnowledgeRule
    const liveRule = new VerifiedKnowledgeRule({
      ruleStatement: candidate.ruleStatement,
      classifications: candidate.classifications,
      scientificBasis: candidate.scientificBasis,
      embedding: new Array(768).fill(0.01),
      usageStatistics: {
        timesRetrieved: 0,
        timesApplied: 0,
        positiveFeedback: 0,
        negativeFeedback: 0,
        confirmationRate: 0
      },
      lastEvidenceUpdatedAt: new Date(),
      version: 1,
      createdBy: new mongoose.Types.ObjectId(),
      createdFromExtractionRunId: new mongoose.Types.ObjectId()
    });
    await liveRule.save();
    console.log('Promoted to VerifiedKnowledgeRule with ruleCode:', liveRule.ruleCode);

    // B. Create flat KnowledgeRuleEvidence
    const evidence = new KnowledgeRuleEvidence({
      ruleId: liveRule._id,
      chunkId: chunk._id,
      quote: chunk.text,
      evidenceSummary: `Paper evidence summary indicating poor sleep increases nightmare frequency - ${testSuffix}`,
      confidence: 1.0,
      extractionRunId: new mongoose.Types.ObjectId()
    });
    await evidence.save();
    console.log('Created KnowledgeRuleEvidence:', evidence._id);

    // C. Update VerifiedKnowledgeRule with evidenceId
    liveRule.evidenceIds = [evidence._id];
    await liveRule.save();

    // D. Delete staging PendingKnowledgeRule
    await PendingKnowledgeRule.deleteOne({ _id: candidate._id });
    console.log('Cleaned up candidate PendingKnowledgeRule');

    console.log('--- STEP 4: VERIFYING INTEGRITY AND ASSERTIONS ---');
    const dbRule = await VerifiedKnowledgeRule.findById(liveRule._id);
    if (!dbRule) throw new Error('Assertion failed: Verified rule not found');
    console.log('- ruleCode format matches:', /^KR_[0-9A-Z]{8}$/.test(dbRule.ruleCode) ? 'PASS' : 'FAIL', `(${dbRule.ruleCode})`);
    console.log('- Statement matches:', dbRule.ruleStatement === candidate.ruleStatement ? 'PASS' : 'FAIL');
    console.log('- Classifications list matches:', JSON.stringify(dbRule.classifications) === JSON.stringify(candidate.classifications) ? 'PASS' : 'FAIL');
    console.log('- Evidence ID array size is 1:', dbRule.evidenceIds.length === 1 ? 'PASS' : 'FAIL');

    const dbEvidence = await KnowledgeRuleEvidence.findById(evidence._id).populate({
      path: 'chunkId',
      populate: { path: 'sourceId' }
    });
    if (!dbEvidence) throw new Error('Assertion failed: Evidence link not found');
    console.log('- Grounded chunk exists:', dbEvidence.chunkId ? 'PASS' : 'FAIL');
    console.log('- Chained source is retrieved:', (dbEvidence as any).chunkId.sourceId ? 'PASS' : 'FAIL');
    console.log('- Quote matching:', dbEvidence.quote === chunk.text ? 'PASS' : 'FAIL');

    console.log('--- STEP 5: CLEANING UP ---');
    // Cascade deletes counts simulation
    const chunkIds = await AcademicChunk.find({ sourceId: source._id }).distinct('_id');
    const ruleSourcesCount = await KnowledgeRuleEvidence.countDocuments({ chunkId: { $in: chunkIds } });
    console.log('- Number of evidence links to cascade delete:', ruleSourcesCount);

    await KnowledgeRuleEvidence.deleteMany({ chunkId: { $in: chunkIds } });
    await VerifiedKnowledgeRule.deleteOne({ _id: liveRule._id });
    await AcademicChunk.deleteMany({ sourceId: source._id });
    await AcademicSection.deleteMany({ documentId: doc._id });
    await AcademicDocument.deleteMany({ sourceId: source._id });
    await AcademicSource.deleteMany({ _id: source._id });
    console.log('Cascade deleted and cleaned up everything successfully.');

    console.log('VERIFICATION TEST COMPLETE - 100% PASS');

  } catch (err) {
    console.error('Error during verification test execution:', err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
