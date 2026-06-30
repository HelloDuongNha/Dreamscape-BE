import mongoose from 'mongoose';
import AcademicDocument from './models/AcademicDocument';
import AcademicSection from './models/AcademicSection';
import AcademicChunk from './models/AcademicChunk';
import SourceContribution from './models/SourceContribution';
import AcademicSource from './models/AcademicSource';

async function run() {
  const doi = '10.3389/fpsyg.2016.00332';
  const oldContribs = await SourceContribution.find({ doi });
  const oldSources = await AcademicSource.find({ doi });

  for (const c of oldContribs) {
    await AcademicDocument.deleteMany({ previewContributionId: c._id });
    await AcademicSection.deleteMany({ previewContributionId: c._id });
    await AcademicChunk.deleteMany({ previewContributionId: c._id });
  }
  for (const s of oldSources) {
    await AcademicDocument.deleteMany({ sourceId: s._id });
    await AcademicSection.deleteMany({ sourceId: s._id });
    await AcademicChunk.deleteMany({ sourceId: s._id });
  }

  const deletedContrib = await SourceContribution.deleteMany({ doi });
  const deletedSource = await AcademicSource.deleteMany({ doi });
  console.log(`Cleared ${deletedContrib.deletedCount} contributions, ${deletedSource.deletedCount} academic sources, and all their related documents, sections, and chunks.`);

  const email = 'duongnha@dreamscape.io';
  const password = '123456';
  
  const baseUrl = 'http://localhost:5001/api';

  console.log('Logging in...');
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (!loginRes.ok) {
    console.error('Login failed:', await loginRes.text());
    process.exit(1);
  }

  const loginBody = await loginRes.json() as any;
  console.log('Login Body:', JSON.stringify(loginBody, null, 2));
  const token = loginBody.token || loginBody.data?.token || loginBody.data?.accessToken || loginBody.accessToken;
  console.log('Login successful. Token obtained:', token ? 'YES' : 'NO');

  console.log(`Contributing DOI: ${doi}...`);
  const contributeRes = await fetch(`${baseUrl}/sources/contribute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ doi })
  });

  if (!contributeRes.ok) {
    console.error('Contribution failed:', await contributeRes.text());
    process.exit(1);
  }

  const contribPayload = await contributeRes.json() as any;
  const contribution = contribPayload.data;
  const contribId = contribution._id;
  console.log(`Contribution created: ID = ${contribId}`);

  // Retrieve the contribution from DB to check pdfUrl before import
  const contribBeforeImport = await SourceContribution.findById(contribId);
  console.log('--- Proof: contribution.pdfUrl BEFORE import:', contribBeforeImport?.pdfUrl);

  console.log('Triggering Preview Import...');
  const importRes = await fetch(`${baseUrl}/moderation/sources/${contribId}/import-fulltext`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  console.log('Import Response Status:', importRes.status);
  const importPayload = await importRes.json() as any;
  console.log('Import Response metrics:', JSON.stringify(importPayload.report || importPayload, null, 2));

  // Count chunks before approval
  const readerChunksBefore = await AcademicChunk.countDocuments({ previewContributionId: contribId, chunkPurpose: 'reader' });
  const ragChunksBefore = await AcademicChunk.countDocuments({ previewContributionId: contribId, chunkPurpose: 'rag' });
  console.log(`AcademicChunk count BEFORE approval: reader=${readerChunksBefore}, rag=${ragChunksBefore}`);

  // Retrieve the contribution from DB to check pdfUrl after import
  const contribAfterImport = await SourceContribution.findById(contribId);
  console.log('--- Proof: contribution.pdfUrl AFTER import:', contribAfterImport?.pdfUrl);

  console.log('\nCalling Preview API...');
  const previewRes = await fetch(`${baseUrl}/moderation/sources/${contribId}/preview`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!previewRes.ok) {
    console.error('Preview API failed:', await previewRes.text());
    process.exit(1);
  }

  const previewPayload = await previewRes.json() as any;
  const previewSections = previewPayload.data.sections || [];
  console.log(`Count of sections from Preview API: ${previewSections.length}`);
  console.log('First 20 sections/blocks from Preview API:');
  previewSections.slice(0, 20).forEach((s: any, idx: number) => {
    console.log(`Block #${idx}: Type=${s.sectionType}, Text=${(s.text || '').substring(0, 80).replace(/\n/g, ' ')}...`);
  });

  // Assertions for Preview sections/blocks quality
  const first20PreviewText = previewSections.slice(0, 20).map((s: any) => s.text || '');

  // Noise check: MUST NOT include
  const forbiddenNoise = [
    'OPINION article',
    'Article metrics',
    'WZWei Zhang',
    'Front. Psychol.',
    'Volume 7 - 2016',
    'Sec. Consciousness Research'
  ];
  for (const noise of forbiddenNoise) {
    if (first20PreviewText.some((txt: string) => txt.includes(noise))) {
      console.error(`FAILURE: Preview blocks contain forbidden noise string: "${noise}"`);
      process.exit(1);
    }
  }

  // Clean elements check: MUST include
  const hasHeading1 = first20PreviewText.some((txt: string) => txt.includes('Dreaming: A process of self-organization'));
  const hasParagraph1 = first20PreviewText.some((txt: string) => txt.includes('Kahn and Hobson (1993) proposed'));
  
  if (!hasHeading1) {
    console.error('FAILURE: Preview blocks do NOT contain heading "Dreaming: A process of self-organization"');
    process.exit(1);
  }
  if (!hasParagraph1) {
    console.error('FAILURE: Preview blocks do NOT contain paragraph "Kahn and Hobson (1993) proposed"');
    process.exit(1);
  }
  console.log('SUCCESS: Preview blocks passed quality assertions!');

  // Now trigger status approval (promotion)
  console.log('\nApproving Contribution...');
  const approveRes = await fetch(`${baseUrl}/moderation/sources/${contribId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      reviewStatus: 'approved',
      reviewNote: 'Approved automatically by integration test script'
    })
  });

  if (!approveRes.ok) {
    console.error('Approval failed:', await approveRes.text());
    process.exit(1);
  }

  const approvePayload = await approveRes.json() as any;
  console.log('Approval response message:', approvePayload.message);

  // Find the promoted AcademicSource
  const approvedSource = await AcademicSource.findOne({ sourceContributionId: contribId });
  if (!approvedSource) {
    console.error('Promoted AcademicSource not found in database!');
    process.exit(1);
  }

  const sourceId = approvedSource._id;
  console.log(`Promoted AcademicSource ID: ${sourceId}`);
  console.log('readableInApp:', approvedSource.readableInApp);
  console.log('fullTextStatus:', approvedSource.fullTextStatus);
  console.log('chunkBuildStatus:', approvedSource.chunkBuildStatus);
  console.log('chunkCount:', approvedSource.chunkCount);
  console.log('--- Proof: academicSource.pdfUrl AFTER approval:', approvedSource.pdfUrl);

  // Count chunks after approval
  const readerChunksAfter = await AcademicChunk.countDocuments({ sourceId, chunkPurpose: 'reader' });
  const ragChunksAfter = await AcademicChunk.countDocuments({ sourceId, chunkPurpose: 'rag' });
  console.log(`AcademicChunk count AFTER approval: reader=${readerChunksAfter}, rag=${ragChunksAfter}`);

  // Query counts for pre-existing IDs (to ensure preview IDs were cleaned up/unset)
  const readerContribChunksAfter = await AcademicChunk.countDocuments({ previewContributionId: contribId, chunkPurpose: 'reader' });
  console.log(`AcademicChunk count with previewContributionId AFTER approval: reader=${readerContribChunksAfter}`);

  // Call the approved read API
  console.log('\nCalling Approved Read API: GET /api/sources/approved/:id/read (fetching all pages)...');
  const readSections: any[] = [];
  for (let p = 1; p <= 3; p++) {
    const readRes = await fetch(`${baseUrl}/sources/approved/${sourceId}/read?page=${p}&limit=50`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!readRes.ok) {
      console.error(`Approved Read API failed for page ${p}:`, await readRes.text());
      process.exit(1);
    }

    const readPayload = await readRes.json() as any;
    const pageSections = readPayload.data.sections || [];
    if (pageSections.length === 0) break;
    readSections.push(...pageSections);
  }
  console.log(`Count of total sections fetched from Approved Read API: ${readSections.length}`);
  
  console.log('\n--- Proof: First 30 approved read API blocks ---');
  readSections.slice(0, 30).forEach((s: any, idx: number) => {
    console.log(`Block #${idx}: sectionIndex=${s.sectionIndex}, sectionType=${s.sectionType}, text="${(s.text || '').substring(0, 80).replace(/\n/g, ' ')}...", marker="${s.marker || ''}"`);
  });

  console.log('\n--- Proof: List item sample with marker (1), (2), (3) ---');
  const listItems = readSections.filter((s: any) => s.sectionType === 'list_item');
  listItems.slice(0, 5).forEach((s: any, idx: number) => {
    console.log(`List Item #${idx}: marker="${s.marker}", text="${s.text.substring(0, 100)}..."`);
  });

  console.log('\n--- Proof: Reference samples without Pubmed/CrossRef noise but with DOI preserved ---');
  const referenceItems = readSections.filter((s: any) => s.sectionType === 'reference' || s.sectionType === 'reference_item');
  referenceItems.slice(0, 5).forEach((s: any, idx: number) => {
    console.log(`Reference #${idx}: text="${s.text}"`);
  });

  console.log('\n--- Proof: Inline (a), (b), (c) paragraph stays paragraph ---');
  const inlineParagraph = readSections.find((s: any) => s.sectionType === 'paragraph' && s.text.includes('(a)'));
  if (inlineParagraph) {
    console.log(`Inline Paragraph: text="${inlineParagraph.text.substring(0, 150)}..."`);
  } else {
    console.log('No paragraph found containing inline list markers (which is correct if none exist in body).');
  }

  // Assertions for Approved Read sections/blocks quality
  const first30ApprovedText = readSections.slice(0, 30).map((s: any) => s.text || '');

  // Noise check: MUST NOT include
  for (const noise of forbiddenNoise) {
    if (first30ApprovedText.some((txt: string) => txt.includes(noise))) {
      console.error(`FAILURE: Approved Read blocks contain forbidden noise string: "${noise}"`);
      process.exit(1);
    }
  }

  // Clean elements check: MUST include
  const hasHeadingApproved = first30ApprovedText.some((txt: string) => txt.includes('Dreaming: A process of self-organization'));
  const hasParagraphApproved = first30ApprovedText.some((txt: string) => txt.includes('Kahn and Hobson (1993) proposed'));
  
  if (!hasHeadingApproved) {
    console.error('FAILURE: Approved Read blocks do NOT contain heading "Dreaming: A process of self-organization"');
    process.exit(1);
  }
  if (!hasParagraphApproved) {
    console.error('FAILURE: Approved Read blocks do NOT contain paragraph "Kahn and Hobson (1993) proposed"');
    process.exit(1);
  }
  console.log('SUCCESS: Approved Read blocks passed quality assertions!');

  process.exit(0);
}

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dreamscape')
  .then(() => run())
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
