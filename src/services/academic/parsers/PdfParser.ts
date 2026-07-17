import { spawn } from 'child_process';
import path from 'path';
import { CanonicalBlocksOutput, CanonicalBlock, SemanticType } from '../types';

export async function parsePdf(filePath: string): Promise<CanonicalBlocksOutput> {
  const blocks: CanonicalBlock[] = [];
  const warnings: string[] = ['Phân tích tài liệu PDF bằng bộ phân giải PyMuPDF.'];
  let title = 'Tài liệu PDF';

  try {
    const parsedData: any = await new Promise((resolve, reject) => {
      const pythonBin = process.env.PYTHON_BIN || 'python3';
      const parserScriptPath = path.join(__dirname, '../../../utils/python/smart_reader_parser.py');
      const pyProcess = spawn(pythonBin, [parserScriptPath, filePath]);

      let stdoutData = '';
      let stderrData = '';

      const timeout = setTimeout(() => {
        pyProcess.kill();
        reject(new Error('Hết thời gian phân tích PDF (30s).'));
      }, 30000);

      pyProcess.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
      });

      pyProcess.stderr.on('data', (chunk) => {
        stderrData += chunk.toString();
      });

      pyProcess.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(stderrData.trim() || `Python exited with code ${code}`));
          return;
        }
        try {
          resolve(JSON.parse(stdoutData.trim()));
        } catch (err) {
          reject(new Error('Phản hồi từ Python Parser không đúng định dạng JSON.'));
        }
      });
    });

    if (!parsedData || !parsedData.success) {
      throw new Error(parsedData?.error || 'Phân tích PDF thất bại.');
    }

    if (parsedData.title) {
      title = parsedData.title;
    }

    let globalOrder = 0;
    const sections = parsedData.sections || [];

    for (const sec of sections) {
      const secHeading = sec.heading || null;
      const secBlocks = sec.blocks || [];

      for (const b of secBlocks) {
        let btype = b.blockType || 'paragraph';
        // Map block type to semantic type
        let semType: SemanticType = 'paragraph';
        if (btype === 'heading') {
          semType = 'heading';
        } else if (btype === 'list_item') {
          semType = 'list';
        } else if (btype === 'reference') {
          semType = 'reference';
        } else if (btype === 'figure') {
          semType = 'figure';
        } else if (btype === 'table') {
          semType = 'table';
        } else if (btype === 'metadata') {
          semType = 'metadata';
        } else if (btype === 'page_break') {
          semType = 'footnote'; // default fallback semantic type
        }

        if (sec.sectionType === 'abstract') {
          semType = 'abstract';
        } else if (sec.sectionType === 'metadata') {
          semType = 'metadata';
          btype = 'metadata';
        } else if (sec.sectionType === 'references' || secHeading?.toUpperCase() === 'REFERENCES') {
          semType = 'reference';
          btype = 'reference';
        }

        blocks.push({
          blockType: btype,
          semanticType: semType,
          sectionHeading: secHeading,
          text: b.text,
          html: b.html,
          marker: b.marker || undefined,
          order: globalOrder++,
          pageNumber: b.pageNumber || undefined
        });
      }
    }

    if (parsedData.warnings) {
      warnings.push(...parsedData.warnings);
    }

    return {
      title,
      parserEngine: 'PdfParser',
      sourceType: 'pdf',
      warnings,
      blocks,
      success: true
    };

  } catch (err: any) {
    return {
      title,
      parserEngine: 'PdfParser',
      sourceType: 'pdf',
      warnings: [...warnings, `Lỗi Parser PDF: ${err.message}`],
      blocks,
      success: false,
      error: err.message
    };
  }
}
