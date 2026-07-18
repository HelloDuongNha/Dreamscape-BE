import { spawn } from 'child_process';
import path from 'path';

export interface PdfTextLayerProbeResult {
  pageCount: number;
  pagesWithText: number;
  totalCharacterCount: number;
  textPageRatio: number;
  averageCharactersPerPage: number;
  hasUsableTextLayer: boolean;
}

export async function probePdfTextLayer(pdfPath: string): Promise<PdfTextLayerProbeResult> {
  const pythonBin = process.env.PYTHON_BIN || 'python3';
  const scriptPath = path.join(__dirname, 'runtime/pdf_text_layer_probe.py');

  return new Promise((resolve, reject) => {
    const processHandle = spawn(pythonBin, [scriptPath, pdfPath]);
    let stdout = '';
    let settled = false;

    const finish = (error?: Error, result?: PdfTextLayerProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result!);
    };

    const timeout = setTimeout(() => {
      processHandle.kill('SIGKILL');
      finish(new Error('Hết thời gian kiểm tra lớp văn bản PDF.'));
    }, 60_000);

    processHandle.stdout.on('data', (chunk) => {
      if (stdout.length < 64 * 1024) stdout += chunk.toString();
    });
    processHandle.on('error', () => finish(new Error('Không thể khởi động bộ kiểm tra PDF.')));
    processHandle.on('close', (code) => {
      if (code !== 0) {
        finish(new Error('Không thể kiểm tra lớp văn bản PDF.'));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        if (!parsed.success) throw new Error('probe failed');
        finish(undefined, {
          pageCount: Number(parsed.pageCount) || 0,
          pagesWithText: Number(parsed.pagesWithText) || 0,
          totalCharacterCount: Number(parsed.totalCharacterCount) || 0,
          textPageRatio: Number(parsed.textPageRatio) || 0,
          averageCharactersPerPage: Number(parsed.averageCharactersPerPage) || 0,
          hasUsableTextLayer: parsed.hasUsableTextLayer === true,
        });
      } catch {
        finish(new Error('Kết quả kiểm tra lớp văn bản PDF không hợp lệ.'));
      }
    });
  });
}
