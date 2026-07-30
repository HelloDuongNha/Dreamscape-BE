import { spawn } from 'child_process';
import path from 'path';
import { CanonicalBlocksOutput, CanonicalBlock, SemanticType } from '../../../types/canonical.types';

export interface RawPdfParserOutput {
  success?: boolean;
  title?: string;
  error?: string;
  warnings?: string[];
  sections?: Array<{
    heading?: string | null;
    sectionType?: string;
    blocks?: Array<Record<string, any>>;
  }>;
}

export function mapRawPdfParserOutput(parsedData: RawPdfParserOutput): CanonicalBlocksOutput {
  const blocks: CanonicalBlock[] = [];
  const warnings: string[] = ['Phân tích tài liệu PDF bằng bộ phân giải PyMuPDF.'];
  let title = parsedData.title || 'Tài liệu PDF';

  if (!parsedData.success) {
    return {
      title,
      parserEngine: 'PdfParser',
      sourceType: 'pdf',
      warnings: [...warnings, `Lỗi Parser PDF: ${parsedData.error || 'Phân tích PDF thất bại.'}`],
      blocks,
      success: false,
      error: parsedData.error || 'Phân tích PDF thất bại.',
    };
  }

  let globalOrder = 0;
  for (const sec of parsedData.sections || []) {
    const secHeading = sec.heading || null;
    for (const block of sec.blocks || []) {
      let blockType = block.blockType || 'paragraph';
      let semanticType: SemanticType = 'paragraph';
      if (blockType === 'heading') semanticType = 'heading';
      else if (blockType === 'list_item') semanticType = 'list';
      else if (blockType === 'reference') semanticType = 'reference';
      else if (blockType === 'figure') semanticType = 'figure';
      else if (blockType === 'table') semanticType = 'table';
      else if (blockType === 'metadata') semanticType = 'metadata';
      else if (blockType === 'page_break') semanticType = 'footnote';

      if (sec.sectionType === 'abstract') {
        semanticType = 'abstract';
      } else if (sec.sectionType === 'metadata') {
        semanticType = 'metadata';
        blockType = 'metadata';
      } else if (sec.sectionType === 'references' || secHeading?.toUpperCase() === 'REFERENCES') {
        semanticType = 'reference';
        blockType = 'reference';
      }

      blocks.push({
        blockType,
        semanticType,
        sectionHeading: secHeading,
        text: block.text,
        html: block.html,
        marker: block.marker || undefined,
        order: globalOrder++,
        pageNumber: block.pageNumber || undefined,
      });
    }
  }

  if (parsedData.warnings) warnings.push(...parsedData.warnings);
  return {
    title,
    parserEngine: 'PdfParser',
    sourceType: 'pdf',
    warnings,
    blocks,
    success: true,
  };
}

export async function parsePdf(filePath: string): Promise<CanonicalBlocksOutput> {
  try {
    const parsedData = await new Promise<RawPdfParserOutput>((resolve, reject) => {
      const pythonBin = process.env.PYTHON_BIN || 'python3';
      const parserScriptPath = path.join(__dirname, 'runtime/smart_reader_parser.py');
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

    return mapRawPdfParserOutput(parsedData);

  } catch (err: any) {
    return {
      title: 'Tài liệu PDF',
      parserEngine: 'PdfParser',
      sourceType: 'pdf',
      warnings: [`Phân tích tài liệu PDF bằng bộ phân giải PyMuPDF.`, `Lỗi Parser PDF: ${err.message}`],
      blocks: [],
      success: false,
      error: err.message
    };
  }
}
