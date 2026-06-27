import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import AcademicSource from '../src/models/AcademicSource';
import AcademicDocument from '../src/models/AcademicDocument';
import AcademicSection from '../src/models/AcademicSection';
import AcademicChunk from '../src/models/AcademicChunk';
import KnowledgeRuleCandidate from '../src/models/KnowledgeRuleCandidate';
import KnowledgeRule from '../src/models/KnowledgeRule';
import KnowledgeRuleEvidence from '../src/models/KnowledgeRuleEvidence';

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  console.log('Connecting to MongoDB at:', uri);
  await mongoose.connect(uri);

  const testSuffix = 'test_p234';

  try {
    console.log('--- STEP 1: CLEANING UP ANY MOCK DATA ---');
    await AcademicSource.deleteMany({ title: new RegExp(testSuffix) });
    await AcademicDocument.deleteMany({ parserEngine: testSuffix });
    await AcademicSection.deleteMany({ heading: new RegExp(testSuffix) });
    await AcademicChunk.deleteMany({ text: new RegExp(testSuffix) });
    await KnowledgeRuleCandidate.deleteMany({ label: new RegExp(testSuffix) });
    await KnowledgeRule.deleteMany({ label: new RegExp(testSuffix) });
    await KnowledgeRuleEvidence.deleteMany({ ruleId: new RegExp(testSuffix) });

    console.log('--- STEP 2: CREATING MOCK DATA ---');
    // A. AcademicSource
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

    // B. AcademicDocument
    const doc = new AcademicDocument({
      _id: new mongoose.Types.ObjectId(),
      sourceId: source._id,
      parserVersion: 1,
      parserEngine: testSuffix,
      sectionIds: [],
    });

    // C. AcademicSection
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

    // D. AcademicChunk
    const chunk = new AcademicChunk({
      _id: new mongoose.Types.ObjectId(),
      sourceId: source._id,
      documentId: doc._id,
      sectionId: section._id,
      text: `Incorporating external stimuli into dreams changes brain activity - ${testSuffix}`,
      embedding: new Array(1536).fill(0.01), // dummy embedding vector
      tokenCount: 15,
      sectionOrder: 0,
      chunkOrder: 0,
    });
    await chunk.save();

    // Link chunk to section
    section.chunkIds = [chunk._id];
    await section.save();
    console.log('Created AcademicChunk:', chunk._id);

    // E. KnowledgeRuleCandidate
    const candidate = new KnowledgeRuleCandidate({
      academicSourceId: source._id,
      evidenceChunkIds: [chunk._id],
      proposedRuleId: `${testSuffix}_rule_1`,
      candidateKey: `${testSuffix}_key`,
      label: `Stimulus Incorporation - ${testSuffix}`,
      group: 'dream_psychology',
      category: 'stimulus',
      factor: 'external_stimulus',
      inputSource: 'dreamContent',
      inputRequired: { field: 'content' },
      scientificBasis: `Testing scientific basis for stimulus incorporation - ${testSuffix}`,
      aiInstruction: `Inject stimulus context check - ${testSuffix}`,
      limitations: 'Limited study population.',
      claimStrength: 'possible_contributing_factor',
      confidenceCap: 0.5,
      evidenceRole: 'primary_support',
      evidenceSummary: `Matched evidence summary - ${testSuffix}`,
      status: 'pending',
    });
    await candidate.save();
    console.log('Created KnowledgeRuleCandidate:', candidate._id);

    console.log('--- STEP 3: SIMULATING APPROVAL FLOW (PROMOTING TO RULES & EVIDENCE) ---');
    // We simulate what moderationController does
    // Create live rule
    const liveRule = new KnowledgeRule({
      _id: candidate.proposedRuleId,
      group: candidate.group,
      category: candidate.category,
      factor: candidate.factor,
      label: candidate.label,
      inputSource: candidate.inputSource,
      inputRequired: candidate.inputRequired,
      scientificBasis: candidate.scientificBasis,
      claimStrength: candidate.claimStrength,
      aiInstruction: candidate.aiInstruction,
      confidenceCap: candidate.confidenceCap,
      limitations: candidate.limitations,
      evidenceSummary: candidate.evidenceSummary,
      isActive: true,
      oracleEligible: true,
      origin: 'source_generated',
      ruleVersion: 1,
      scoring: {
        enabled: false,
        scoreImpact: 0,
        scoreType: 'interpretive_framework',
        reason: '',
      },
      embedding: new Array(1536).fill(0.01), // dummy
    });
    await liveRule.save();

    // Create KnowledgeRuleEvidence link
    const quotes = [
      {
        chunkId: chunk._id,
        sectionId: section._id,
        quote: chunk.text,
        relevanceScore: 100,
        quoteType: 'primary',
      },
    ];

    const ruleEvidenceLink = new KnowledgeRuleEvidence({
      ruleId: liveRule._id,
      sourceId: source._id,
      documentId: doc._id,
      evidenceRole: candidate.evidenceRole,
      status: 'active',
      quotes: quotes,
    });
    await ruleEvidenceLink.save();

    console.log('Simulated approval: created KnowledgeRule and KnowledgeRuleEvidence link');

    console.log('--- STEP 4: VERIFYING KNOWLEDGERULEEVIDENCE WRITES & SCHEMA ---');
    const savedLink = await KnowledgeRuleEvidence.findOne({ ruleId: liveRule._id });
    if (!savedLink) {
      throw new Error('FAIL: KnowledgeRuleEvidence link not found in DB!');
    }
    console.log('Saved Link in DB:', JSON.stringify(savedLink, null, 2));

    // Schema checks
    if (!savedLink.quotes || savedLink.quotes.length === 0) {
      throw new Error('FAIL: quotes[] array is missing or empty!');
    }
    const savedQuote = savedLink.quotes[0];
    if (!savedQuote.chunkId || !savedQuote.sectionId || !savedQuote.quote) {
      throw new Error('FAIL: quotes subdocument missing chunkId, sectionId, or quote!');
    }
    if ((savedLink as any).selectedQuotePreview || (savedLink as any).selectedQuote || (savedLink as any).academicChunkIds || (savedLink as any).academicSourceId) {
      throw new Error('FAIL: Legacy fields like selectedQuotePreview/academicChunkIds/academicSourceId still exist on document!');
    }
    console.log('✅ PASS: KnowledgeRuleEvidence has the new quotes[] schema with zero legacy fields.');

    console.log('--- STEP 5: VERIFYING DREAM ANALYSIS READS & CITATION BUILDER (DB-SIDE ONLY) ---');
    
    // Simulate the exact database and formatting pipeline in analyze.service.ts
    const ruleIds = [liveRule._id];
    const rawEvidenceLinks = await KnowledgeRuleEvidence.find({
      ruleId: { $in: ruleIds },
      status: 'active'
    })
    .populate({
      path: 'sourceId',
      select: 'title authors year journal publisher doi allowedUse readableInApp chunkBuildStatus'
    })
    .populate({
      path: 'quotes.chunkId',
      select: 'text sectionId documentId sectionOrder chunkOrder'
    })
    .lean();

    const validEvidenceLinks = rawEvidenceLinks.filter((link: any) => {
      const src = link.sourceId;
      return src && src.readableInApp === true && src.allowedUse === 'open_access_fulltext' && src.chunkBuildStatus === 'completed';
    });

    if (validEvidenceLinks.length === 0) {
      throw new Error('FAIL: No valid evidence links fetched or validated!');
    }

    const firstLink = validEvidenceLinks[0];
    const chunks = ((firstLink.quotes || []).map((q: any) => q.chunkId).filter(Boolean)) as any[];
    
    if (chunks.length === 0) {
      throw new Error('FAIL: Chunks list within populated quotes is empty!');
    }

    console.log('Fetched valid evidence link:', JSON.stringify(firstLink, null, 2));

    // Simulate formatting evidence prompt text
    let ruleText = '';
    const ruleSourcesList: any[] = [];
    const src = firstLink.sourceId;

    chunks.sort((a, b) => (a.chunkOrder || 0) - (b.chunkOrder || 0));
    const chunkIds = chunks.map(c => c._id.toString());
    
    ruleSourcesList.push({
      sourceId: src._id.toString(),
      title: src.title,
      authors: Array.isArray(src.authors) ? src.authors : [src.authors],
      year: src.year,
      journal: src.journal || src.publisher,
      doi: src.doi,
      chunkIds
    });

    for (const chunkItem of chunks) {
      const textSnippet = chunkItem.text || '';
      ruleText += (ruleText ? '\n' : '') + textSnippet;
    }

    const combinedChunkText = chunks.map(c => c.text).join(' [...] ');
    const evidenceLinksAudit = [{
      ruleId: liveRule._id,
      evidenceRole: firstLink.evidenceRole,
      sourceId: src._id,
      sourceTitle: src.title,
      sourceYear: src.year,
      doi: src.doi,
      chunkIds: chunks.map(c => c._id),
      chunkPreview: combinedChunkText.substring(0, 400) + (combinedChunkText.length > 400 ? '...' : '')
    }];

    console.log('Formatted prompt ruleText:', ruleText);
    console.log('Formatted prompt ruleSourcesList:', JSON.stringify(ruleSourcesList, null, 2));
    console.log('Generated Audit Link:', JSON.stringify(evidenceLinksAudit, null, 2));

    if (evidenceLinksAudit[0].academicSourceId || (evidenceLinksAudit[0] as any).chunkPreview.includes('undefined')) {
      throw new Error('FAIL: Legacy field academicSourceId found in formatted audit link or preview contains undefined!');
    }

    console.log('✅ PASS: Database matching, quotes mapping, and citation formatter completed successfully.');

    console.log('--- STEP 6: CLEANING UP ---');
    await AcademicSource.deleteOne({ _id: source._id });
    await AcademicDocument.deleteOne({ _id: doc._id });
    await AcademicSection.deleteOne({ _id: section._id });
    await AcademicChunk.deleteOne({ _id: chunk._id });
    await KnowledgeRuleCandidate.deleteOne({ _id: candidate._id });
    await KnowledgeRule.deleteOne({ _id: liveRule._id });
    await KnowledgeRuleEvidence.deleteOne({ _id: ruleEvidenceLink._id });
    console.log('Cleaned up mock data successfully.');

    console.log('\n======================================');
    console.log('ALL PIPELINE CHECKS: PASSED');
    console.log('======================================');

  } catch (err: any) {
    console.error('❌ PIPELINE CHECKS FAILED:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
