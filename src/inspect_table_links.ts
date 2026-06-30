import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { parseSourceFile } from './services/academic/smartReaderParser.service';
import AcademicSource from './models/AcademicSource';

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dreamscape');
  
  const { fetchUrlWithSafeRedirects } = require('./utils/ssrfGuard');
  const htmlUrl = 'https://doi.org/10.1038/s41398-023-02637-6';
  const downloadRes = await fetchUrlWithSafeRedirects(htmlUrl);
  
  const fs = require('fs');
  const path = require('path');
  const tempPath = path.join(__dirname, 'inspect_table_links.html');
  fs.writeFileSync(tempPath, downloadRes.buffer);

  const parseOutput = await parseSourceFile(tempPath, 'html', 'generic_html');
  fs.unlinkSync(tempPath);

  const tables = parseOutput.blocks.filter((b: any) => b.blockType === 'table');
  console.log(`Found ${tables.length} tables in parsed output:`);
  tables.forEach((t: any, idx: number) => {
    console.log(`Table #${idx + 1}:`);
    console.log(`  Text: "${t.text.substring(0, 100)}..."`);
    console.log(`  tableLink: "${t.tableLink || ''}"`);
    console.log(`  HTML length: ${t.html ? t.html.length : 0}`);
  });

  await mongoose.disconnect();
}

run();
