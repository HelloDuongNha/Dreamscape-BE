import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import https from 'https';

import AcademicSource from '../src/models/AcademicSource';

dotenv.config();

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/dreamscape';

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode && (response.statusCode >= 300 && response.statusCode < 400) && response.headers.location) {
        let redirectUrl = response.headers.location;
        if (redirectUrl.startsWith('/')) {
          const parsedOriginal = new URL(url);
          redirectUrl = `${parsedOriginal.protocol}//${parsedOriginal.host}${redirectUrl}`;
        }
        // Handle redirect once
        https.get(redirectUrl, (redirectResp) => {
          redirectResp.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }).on('error', (err) => {
          fs.unlinkSync(dest);
          reject(err);
        });
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }
    }).on('error', (err) => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function main() {
  console.log('Connecting to database:', mongoUri);
  await mongoose.connect(mongoUri);
  console.log('Database connected.');

  const source = await AcademicSource.findOne({
    allowedUse: 'open_access_fulltext',
    fullTextUrl: { $exists: true, $ne: '' }
  });

  if (!source) {
    console.log('No eligible open access source found in database.');
    await mongoose.disconnect();
    return;
  }

  console.log('Found source:', source.title);
  console.log('PDF URL:', source.fullTextUrl);

  const scratchDir = path.join(__dirname, '../scratch');
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }
  const tempPdfPath = path.join(scratchDir, 'test_sample.pdf');

  console.log('Downloading PDF...');
  await downloadFile(source.fullTextUrl || '', tempPdfPath);
  console.log('PDF downloaded to:', tempPdfPath);

  const pythonBin = process.env.PYTHON_BIN || 'python3';
  const parserScriptPath = path.join(__dirname, '../src/utils/academic_pdf_parser.py');

  console.log(`Spawning parser: ${pythonBin} ${parserScriptPath} ${tempPdfPath}`);
  
  const pyProcess = spawn(pythonBin, [parserScriptPath, tempPdfPath]);
  
  let stdoutData = '';
  let stderrData = '';

  pyProcess.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });

  pyProcess.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  pyProcess.on('close', async (code) => {
    console.log('Parser exited with code:', code);
    if (stderrData) {
      console.log('Stderr logs:\n', stderrData);
    }

    if (code !== 0) {
      console.error('Parser script execution failed.');
    } else {
      try {
        const parsed = JSON.parse(stdoutData.trim());
        console.log('Parser output verification:');
        console.log('Success:', parsed.success);
        console.log('Engine:', parsed.engine);
        console.log('Quality:', parsed.quality);
        console.log('Structure Version:', parsed.structureVersion);
        console.log('Has Structured References:', parsed.hasStructuredReferences);
        console.log('Has Detected Sections:', parsed.hasDetectedSections);
        console.log('Total Word Count:', parsed.wordCount);
        console.log('Total Character Count:', parsed.characterCount);
        console.log('Sections Count:', parsed.sections?.length);
        
        if (parsed.sections && parsed.sections.length > 0) {
          console.log('\nSample Section Blocks:');
          const sample = parsed.sections.slice(0, 10);
          sample.forEach((s: any) => {
            console.log(`[Index ${s.sectionIndex}] [Type: ${s.sectionType}] (Page ${s.pageStart}) - ${s.text.substring(0, 80)}...`);
          });
        }
      } catch (err) {
        console.error('Failed to parse stdout output as JSON:', err);
        console.log('Raw Stdout:\n', stdoutData);
      }
    }

    // Clean up
    if (fs.existsSync(tempPdfPath)) {
      fs.unlinkSync(tempPdfPath);
    }
    await mongoose.disconnect();
  });
}

main().catch(err => {
  console.error('Test script failed:', err);
  mongoose.disconnect();
});
