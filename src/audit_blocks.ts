import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { collectCandidates } from './services/academic/candidateCollector.service';
import { parseSourceFile } from './services/academic/smartReaderParser.service';
import AcademicSource from './models/AcademicSource';

dotenv.config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dreamscape';
  await mongoose.connect(uri);

  const source = await AcademicSource.findById('6a43b6787eb54003c6d2c866');
  if (!source) {
    console.error('Source not found');
    await mongoose.disconnect();
    return;
  }

  const { fetchUrlWithSafeRedirects } = require('../../BE/src/utils/ssrfGuard');
  
  // Find generic html candidate
  const htmlUrl = 'https://doi.org/10.1038/s41398-023-02637-6';
  const downloadRes = await fetchUrlWithSafeRedirects(htmlUrl);
  
  const fs = require('fs');
  const path = require('path');
  const tempPath = path.join(__dirname, 'audit_blocks.html');
  fs.writeFileSync(tempPath, downloadRes.buffer);

  const parseOutput = await parseSourceFile(tempPath, 'html', 'generic_html');
  fs.unlinkSync(tempPath);

  const blocks = parseOutput.blocks;
  console.log(`Parsed blocks count from generic HTML: ${blocks.length}`);

  // 1. Where does "Similar content being viewed by others" enter?
  console.log(`\n--- 1. Widget / Related content audit ---`);
  const widgetBlocks = blocks.filter((b: any) => 
    b.text.toLowerCase().includes('similar content') || 
    b.text.toLowerCase().includes('mediation effects') ||
    b.text.toLowerCase().includes('characterisation of insomnia')
  );
  widgetBlocks.forEach((wb: any) => {
    console.log(`BlockType: ${wb.blockType}, text: "${wb.text.substring(0, 120)}..."`);
  });

  // 2. Figure Fig. 1 blocks audit
  console.log(`\n--- 2. Figures audit ---`);
  const figBlocks = blocks.filter((b: any) => b.blockType === 'figure' || b.text.toLowerCase().includes('fig. 1') || b.text.toLowerCase().includes('full size image'));
  figBlocks.forEach((fb: any, idx: number) => {
    console.log(`Fig block [${idx + 1}]: type=${fb.blockType}, text="${fb.text.substring(0, 150)}..."`);
    console.log(`HTML: "${(fb.html || '').substring(0, 150)}..."\n`);
  });

  // 3. Table endpoints & Full size table audit
  console.log(`\n--- 3. Tables audit ---`);
  const tableBlocks = blocks.filter((b: any) => b.blockType === 'table' || b.text.toLowerCase().includes('table 2') || b.text.toLowerCase().includes('full size table'));
  tableBlocks.forEach((tb: any, idx: number) => {
    console.log(`Table block [${idx + 1}]: type=${tb.blockType}, text="${tb.text.substring(0, 150)}..."`);
    console.log(`HTML: "${(tb.html || '').substring(0, 200)}..."\n`);
  });

  // 4. Pre-reference junk audit
  console.log(`\n--- 4. Pre-reference junk audit ---`);
  const refHeaderIdx = blocks.findIndex((b: any) => b.text.toLowerCase().includes('references') && b.blockType === 'heading');
  console.log(`References heading block index: ${refHeaderIdx}`);
  if (refHeaderIdx !== -1) {
    console.log(`Blocks directly before References heading:`);
    blocks.slice(refHeaderIdx - 15, refHeaderIdx).forEach((b: any, idx: number) => {
      console.log(`  [${refHeaderIdx - 15 + idx}] type=${b.blockType}, text="${b.text.substring(0, 120)}..."`);
    });
    console.log(`Blocks directly after References heading:`);
    blocks.slice(refHeaderIdx, refHeaderIdx + 15).forEach((b: any, idx: number) => {
      console.log(`  [${refHeaderIdx + idx}] type=${b.blockType}, text="${b.text.substring(0, 120)}..."`);
    });
  }

  await mongoose.disconnect();
}

run();
